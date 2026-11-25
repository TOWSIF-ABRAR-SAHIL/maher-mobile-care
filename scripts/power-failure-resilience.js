/* Power-failure resilience on a disposable throwaway database.
 *
 * Covers the two layers introduced for frequent Windows power cuts:
 *   1. SQLite connection hardening (WAL, NORMAL sync, busy timeout, quick_check)
 *      as reported by the real app connection through /api/health.
 *   2. ServiceForm localStorage crash draft: debounced save, exact recovery
 *      banner, explicit restore, discard, success cleanup and edit isolation.
 *
 * Run only through `npm test`; scripts/run-tests.js supplies an isolated DB,
 * backup folder, server port and live-database guard variables.
 */
const path = require("node:path");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const DB_FILE = process.env.MAHER_DB_PATH;
const DRAFT_KEY = "maher_service_entry_draft_v1";
const SESSION_KEY = "maher:new-entry-draft";
const EXACT_PREFIX = "⚡ অসম্পূর্ণ ড্রাফট উদ্ধার করা হয়েছে —";

if (!DB_FILE || path.basename(DB_FILE) !== process.env.MAHER_TEST_DB_FILE) {
  throw new Error("power-failure-resilience must run only on the suite throwaway database");
}

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newDevice(key = 0, overrides = {}) {
  return {
    key,
    model: "",
    problem: "",
    totalBill: "",
    deliveryDate: "",
    imei: "",
    warranty: "",
    parts: [],
    ...overrides,
  };
}

function emptyForm(overrides = {}) {
  return {
    customerName: "",
    phone: "",
    model: "",
    technician: "",
    problem: "",
    totalBill: "",
    advance: "",
    status: "In-Progress",
    shopExpense: "",
    partsShop: "",
    condition: "",
    deliveryDate: "",
    serviceDate: "",
    imei: "",
    customerAddress: "",
    warranty: "",
    ...overrides,
  };
}

function makeDraft(overrides = {}) {
  return {
    f: emptyForm(overrides.f),
    devices: [newDevice(0, overrides.device)],
    products: [],
    mode: "device",
    visitTotalBill: "",
    extrasOpen: true,
    internalOpen: false,
    ...overrides.rest,
  };
}

async function getHealth() {
  const response = await fetch(`${BASE}/api/health`, { cache: "no-store" });
  return response.json().catch(() => ({}));
}

async function getDraft(page) {
  return page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }, DRAFT_KEY);
}

async function draftExists(page) {
  return page.evaluate((key) => localStorage.getItem(key) !== null, DRAFT_KEY);
}

async function setCrashDraft(page, draft) {
  await page.evaluate(
    ({ key, sessionKey, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.removeItem(sessionKey);
    },
    { key: DRAFT_KEY, sessionKey: SESSION_KEY, value: draft }
  );
}

async function clearAllDrafts(page) {
  await page.evaluate(
    ({ key, sessionKey }) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(sessionKey);
    },
    { key: DRAFT_KEY, sessionKey: SESSION_KEY }
  );
}

async function bannerState(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="draft-recovery-banner"]');
    const name = document.querySelector("#svc-name");
    return {
      text: (el?.textContent || "").replace(/\s+/g, " ").trim(),
      restore: !!el?.querySelector('[data-testid="draft-restore"]'),
      discard: !!el?.querySelector('[data-testid="draft-discard"]'),
      inForm: !!el?.closest("form"),
      beforeFields:
        !!el &&
        !!name &&
        (el.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    };
  });
}

async function formValues(page) {
  return page.evaluate(() => ({
    name: document.querySelector("#svc-name")?.value ?? "",
    phone: document.querySelector("#svc-phone")?.value ?? "",
    address: document.querySelector("#svc-address")?.value ?? "",
    model: document.querySelector("#svc-model")?.value ?? "",
    problem: document.querySelector("#svc-problem")?.value ?? "",
    imei: document.querySelector("#svc-imei")?.value ?? "",
    bill: document.querySelector("#svc-bill")?.value ?? "",
    advance: document.querySelector("#svc-adv")?.value ?? "",
    bannerGone: !document.querySelector('[data-testid="draft-recovery-banner"]'),
  }));
}

async function addRoster(page) {
  const roster = await api(page, "/api/technicians");
  if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) throw new Error("NURUL roster setup failed");
  }
}

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);

  /* ---------- PFR1: real SQLite connection resilience ---------- */
  let health = {};
  for (let attempt = 0; attempt < 30; attempt += 1) {
    health = await getHealth();
    if (health.sqlite?.quickCheck && health.sqlite.quickCheck !== "pending") break;
    await sleep(300);
  }
  const sqlite = health.sqlite || {};
  check(
    "PFR1",
    "SQLite connection starts in WAL with NORMAL sync, 5000ms busy timeout and a clean quick_check",
    sqlite.journalMode === "wal" &&
      Number(sqlite.synchronous) === 1 &&
      Number(sqlite.busyTimeout) === 5000 &&
      sqlite.quickCheck === "ok",
    JSON.stringify(sqlite)
  );

  await page.goto(`${BASE}/service`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="daily-services"]', {
    polling: 500,
    timeout: 30000,
  });
  await addRoster(page);
  await clearAllDrafts(page);
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("#svc-name", { timeout: 10000 });
  await sleep(300);
  const fresh = {
    draft: await draftExists(page),
    banner: (await bannerState(page)).text.length > 0,
  };
  check(
    "PFR2",
    "a clean new-entry form has no crash draft or recovery banner",
    !fresh.draft && !fresh.banner,
    JSON.stringify(fresh)
  );

  /* ---------- PFR3: debounced localStorage persistence ---------- */
  const NAME = uniqueName("PowerDraft");
  const PHONE = "01712345678";
  const ADDRESS = `DraftRoad${Date.now()}`;
  const MODEL = "Power Model";
  const PROBLEM = "Power cut draft";
  const IMEI = "352099001761481";
  const BILL = "1200";
  const ADVANCE = "300";

  await typeInto(page, "svc-name", NAME);
  await typeInto(page, "svc-phone", PHONE);
  await typeInto(page, "svc-address", ADDRESS);
  await typeInto(page, "svc-model", MODEL);
  await typeInto(page, "svc-problem", PROBLEM);
  await typeInto(page, "svc-imei", IMEI);
  await typeInto(page, "svc-bill", BILL);
  await typeInto(page, "svc-adv", ADVANCE);
  await page
    .waitForFunction(
      (key) => localStorage.getItem(key) !== null,
      { polling: 200, timeout: 6000 },
      DRAFT_KEY
    )
    .catch(() => {});
  const saved = await getDraft(page);
  check(
    "PFR3",
    "typing customer, device and billing fields debounce-saves one active draft to localStorage",
    saved?.f?.customerName === NAME &&
      saved?.f?.phone === PHONE &&
      saved?.f?.customerAddress === ADDRESS &&
      saved?.f?.advance === ADVANCE &&
      saved?.devices?.[0]?.model === MODEL &&
      saved?.devices?.[0]?.problem === PROBLEM &&
      saved?.devices?.[0]?.imei === IMEI &&
      saved?.devices?.[0]?.totalBill === BILL,
    JSON.stringify(saved)
  );

  /* ---------- PFR4/PFR5: banner + explicit restore ---------- */
  // The legacy session draft is removed so only the new crash draft can
  // repopulate the form. That proves the Restore button itself does the work.
  await page.evaluate((sessionKey) => sessionStorage.removeItem(sessionKey), SESSION_KEY);
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("#svc-name", { timeout: 10000 });
  await page
    .waitForSelector('[data-testid="draft-recovery-banner"]', {
      polling: 300,
      timeout: 6000,
    })
    .catch(() => {});
  const banner = await bannerState(page);
  check(
    "PFR4",
    "reload shows the exact subtle recovery banner above the form fields",
    banner.text.includes(EXACT_PREFIX) &&
      banner.text.includes("🔄 রিস্টোর করুন") &&
      banner.text.includes("✕ বাতিল") &&
      banner.restore &&
      banner.discard &&
      banner.inForm &&
      banner.beforeFields,
    JSON.stringify(banner)
  );

  const beforeRestore = await formValues(page);
  const clickedRestore = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="draft-restore"]');
    if (!button) return false;
    button.click();
    return true;
  });
  if (clickedRestore) {
    await page
      .waitForFunction(
        (expectedName, expectedModel) =>
          document.querySelector("#svc-name")?.value === expectedName &&
          document.querySelector("#svc-model")?.value === expectedModel,
        { polling: 200, timeout: 6000 },
        NAME,
        MODEL
      )
      .catch(() => {});
  }
  const restored = await formValues(page);
  check(
    "PFR5",
    "Restore populates customer, device and billing fields and dismisses the banner",
    clickedRestore &&
      beforeRestore.name === "" &&
      restored.name === NAME &&
      restored.phone === PHONE &&
      restored.address === ADDRESS &&
      restored.model === MODEL &&
      restored.problem === PROBLEM &&
      restored.imei === IMEI &&
      restored.bill === BILL &&
      restored.advance === ADVANCE &&
      restored.bannerGone,
    JSON.stringify({ beforeRestore, restored, clickedRestore })
  );

  /* ---------- PFR6: successful save clears the draft ---------- */
  // The roster reconciliation effect fills the technician automatically; the
  // form is valid without driving the Radix select in this resilience suite.
  const techText = await page.$eval("#svc-tech", (el) => (el.textContent || "").trim());
  await submitButton(page, "সেভ করুন");
  await waitDailyRow(page, NAME, true).catch(() => {});
  await page
    .waitForFunction(
      (key) => localStorage.getItem(key) === null,
      { polling: 200, timeout: 6000 },
      DRAFT_KEY
    )
    .catch(() => {});
  const search = await api(page, `/api/services/search?q=${encodeURIComponent(NAME)}`);
  const savedRow = search.body.services?.find((s) => s.customerName === NAME);
  check(
    "PFR6",
    "a successful সেভ করুন persists the visit and clears the crash draft",
    techText.length > 0 &&
      savedRow?.totalBill === 1200 &&
      savedRow?.advance === 300 &&
      savedRow?.imei === IMEI &&
      !(await draftExists(page)),
    JSON.stringify({ saved: savedRow, draft: await draftExists(page), techText })
  );

  /* ---------- PFR7: discard clears without saving ---------- */
  const DISCARD_NAME = uniqueName("PowerDiscard");
  await setCrashDraft(
    page,
    makeDraft({
      f: { customerName: DISCARD_NAME, phone: "01799999999" },
    })
  );
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector("#svc-name", { timeout: 10000 });
  await page
    .waitForSelector('[data-testid="draft-discard"]', {
      polling: 300,
      timeout: 6000,
    })
    .catch(() => {});
  const clickedDiscard = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="draft-discard"]');
    if (!button) return false;
    button.click();
    return true;
  });
  if (clickedDiscard) {
    await page
      .waitForFunction(
        (key) =>
          localStorage.getItem(key) === null &&
          !document.querySelector('[data-testid="draft-recovery-banner"]'),
        { polling: 200, timeout: 6000 },
        DRAFT_KEY
      )
      .catch(() => {});
  }
  const discarded = await page.evaluate(
    (key) => ({
      draft: localStorage.getItem(key),
      banner: !!document.querySelector('[data-testid="draft-recovery-banner"]'),
    }),
    DRAFT_KEY
  );
  check(
    "PFR7",
    "বাতিল clears the localStorage draft and hides the banner without saving",
    clickedDiscard && discarded.draft === null && !discarded.banner,
    JSON.stringify({ ...discarded, clickedDiscard })
  );

  /* ---------- PFR8: editing never runs the auto-draft engine ---------- */
  const EDIT_NAME = uniqueName("PowerEdit");
  const editRow = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: EDIT_NAME,
      phone: "01788888888",
      model: "Edit Base",
      technician: "NURUL",
      problem: "Edit isolation",
      totalBill: 500,
      advance: 0,
      status: "In-Progress",
      serviceDate: TODAY,
    }),
  });
  if (!editRow.ok) {
    check(
      "PFR8",
      "editing an existing service keeps auto-draft inactive and never shows the banner",
      false,
      JSON.stringify(editRow.body)
    );
  } else {
    const ghost = makeDraft({ f: { customerName: "Ghost Draft" } });
    const ghostText = JSON.stringify(ghost);
    await setCrashDraft(page, ghost);
    await page.goto(`${BASE}/service?edit=${editRow.body.id}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await page.waitForSelector("#svc-model", { timeout: 10000 });
    await typeInto(page, "svc-model", "Edited While Draft Exists");
    await sleep(900);
    const editState = await page.evaluate(
      ({ key, expected }) => ({
        draft: localStorage.getItem(key),
        banner: !!document.querySelector('[data-testid="draft-recovery-banner"]'),
        model: document.querySelector("#svc-model")?.value,
        unchanged: localStorage.getItem(key) === expected,
      }),
      { key: DRAFT_KEY, expected: ghostText }
    );
    check(
      "PFR8",
      "editing an existing service keeps auto-draft inactive and never shows the banner",
      editState.unchanged &&
        !editState.banner &&
        editState.model === "Edited While Draft Exists",
      JSON.stringify(editState)
    );
  }

  check(
    "PFR9",
    "no unexpected browser errors during power-failure recovery flows",
    errors.length === 0,
    errors.join(" | ")
  );

  console.log(results.join("\n"));
  if (failed) {
    console.error("power-failure-resilience: checks failed");
    process.exitCode = 1;
  } else {
    console.log("power-failure-resilience: all checks passed");
  }
})()
  .catch((err) => {
    console.error("POWER-FAILURE CRASH:", err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser(browser);
  });
