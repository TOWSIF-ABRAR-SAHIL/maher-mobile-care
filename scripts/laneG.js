/* Lane G: optional IMEI on the New Job form, plus the API/DB privacy rules.
 *
 * Runs only on the throwaway DB supplied by run-tests.js. Covers:
 *   1. both optional fields empty  · 2. IMEI only  · 3. lock fields posted by
 *   an API client are ignored  · 4. IMEI + a posted lock together
 *   5. multi-device independence  · 6. existing create/edit/backup paths
 * plus: no IMEI in the list or receipt, and no lock value ever reaching the
 * database.
 *
 * The form no longer has a Device Lock field at all (it was removed because
 * the shop never used it); G8, G9, G11 and G16 pin that down so it cannot
 * quietly come back.
 */
const fs = require("node:fs");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const DB_PATH = process.env.MAHER_DB_PATH;

const IMEI_A = "356789012345678";
const IMEI_B = "352099001761481";
const LOCK_A = "PinSecret-8842";
const LOCK_B = "Passw0rd-77";

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dbRows(sql, params = []) {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function dbHasText(needle) {
  return fs.readFileSync(DB_PATH).includes(Buffer.from(needle, "utf8"));
}

async function addRoster(page) {
  const roster = (await api(page, "/api/technicians")).body;
  if (!roster.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) {
      throw new Error("NURUL setup failed: " + JSON.stringify(added.body));
    }
  }
}

async function createService(page, payload) {
  return api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function dayServices(page) {
  const res = await api(page, `/api/services?date=${TODAY}`);
  if (!res.ok) throw new Error(`services failed: ${JSON.stringify(res.body)}`);
  return res.body.services;
}

function basePayload(name, model) {
  return {
    customerName: name,
    phone: "01700000950",
    technician: "NURUL",
    model,
    problem: "IMEI test",
    totalBill: "500",
    advance: "0",
    status: "In-Progress",
    serviceDate: TODAY,
  };
}

async function submitForm(page, expectedToast) {
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll("form button[type='submit']"),
    ].find((b) => b.textContent.includes("সেভ করুন"));
    if (!button) throw new Error("save button missing");
    button.click();
  });
  await waitToast(page, expectedToast);
}

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  const errors = trackErrors(page);
  const requestBodies = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/services") && req.postData()) {
      requestBodies.push(req.postData() || "");
    }
  });

  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await addRoster(page);

  /* ------------------------------------------------------------------ */
  /* 1–4: API accepts every combination and keeps IMEI as text            */
  /* ------------------------------------------------------------------ */
  const EMPTY = uniqueName("ImeiEmpty");
  const emptyJob = await createService(page, basePayload(EMPTY, "Empty Model"));
  check(
    "G1",
    "job saves with no IMEI and no lock (both optional)",
    emptyJob.ok && emptyJob.body.imei === null,
    JSON.stringify({ status: emptyJob.status, imei: emptyJob.body.imei })
  );

  const IMEI_ONLY = uniqueName("ImeiOnly");
  const imeiJob = await createService(page, {
    ...basePayload(IMEI_ONLY, "Imei Model"),
    imei: IMEI_A,
  });
  check(
    "G2",
    "job saves with only an IMEI (stored as the same string)",
    imeiJob.ok && imeiJob.body.imei === IMEI_A,
    JSON.stringify({ status: imeiJob.status, imei: imeiJob.body.imei })
  );

  const LOCK_ONLY = uniqueName("LockOnly");
  const lockJob = await createService(page, {
    ...basePayload(LOCK_ONLY, "Lock Model"),
    // Lock fields must never be required or persisted; sending them is ignored.
    lockType: "PIN",
    lockValue: LOCK_A,
  });
  check(
    "G3",
    "job saves with lock information only; credential is discarded",
    lockJob.ok &&
      lockJob.body.imei === null &&
      !("lockType" in lockJob.body) &&
      !("lockValue" in lockJob.body) &&
      !dbHasText(LOCK_A),
    JSON.stringify({
      status: lockJob.status,
      keys: Object.keys(lockJob.body).filter((k) => k.startsWith("lock")),
      inDb: dbHasText(LOCK_A),
    })
  );

  const BOTH = uniqueName("ImeiLock");
  const bothJob = await createService(page, {
    ...basePayload(BOTH, "Both Model"),
    imei: IMEI_B,
    lockType: "Password",
    lockValue: LOCK_B,
  });
  check(
    "G4",
    "job saves with both fields; IMEI stored, credential not stored",
    bothJob.ok &&
      bothJob.body.imei === IMEI_B &&
      !dbHasText(LOCK_B),
    JSON.stringify({ status: bothJob.status, imei: bothJob.body.imei })
  );

  /* ------------------------------------------------------------------ */
  /* 5: each device in one visit keeps its own IMEI                      */
  /* ------------------------------------------------------------------ */
  const MULTI = uniqueName("ImeiMulti");
  const multiOne = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: MULTI,
      phone: "01700000951",
      technician: "NURUL",
      serviceDate: TODAY,
      devices: [
        {
          model: "Multi A",
          problem: "প্রথম",
          totalBill: "100",
          imei: IMEI_A,
          lockType: "PIN",
          lockValue: LOCK_A,
        },
        { model: "Multi B", problem: "দ্বিতীয়", totalBill: "200" },
      ],
    }),
  });
  const multiOneRows = multiOne.body.services || [];
  const multiTwo = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: MULTI,
      phone: "01700000951",
      technician: "NURUL",
      serviceDate: TODAY,
      devices: [
        { model: "Multi C", problem: "তৃতীয়", totalBill: "300" },
        { model: "Multi D", problem: "চতুর্থ", totalBill: "400", imei: IMEI_B },
      ],
    }),
  });
  const multiTwoRows = multiTwo.body.services || [];
  check(
    "G5",
    "multi-device rows keep independent IMEIs (blank stays NULL)",
    multiOne.ok &&
      multiTwo.ok &&
      multiOneRows[0]?.imei === IMEI_A &&
      multiOneRows[1]?.imei === null &&
      multiTwoRows[0]?.imei === null &&
      multiTwoRows[1]?.imei === IMEI_B,
    JSON.stringify({
      first: multiOneRows.map((r) => r.imei),
      second: multiTwoRows.map((r) => r.imei),
    })
  );

  /* ------------------------------------------------------------------ */
  /* 6: edit updates/clears the IMEI without touching other columns      */
  /* ------------------------------------------------------------------ */
  const edited = await api(page, `/api/services/${imeiJob.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imei: IMEI_B }),
  });
  const untouched = await api(page, `/api/services/${imeiJob.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "Imei Model v2" }),
  });
  const cleared = await api(page, `/api/services/${imeiJob.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imei: "" }),
  });
  check(
    "G6",
    "edit sets, leaves or clears the IMEI (blank → NULL)",
    edited.ok &&
      edited.body.imei === IMEI_B &&
      untouched.ok &&
      untouched.body.imei === IMEI_B &&
      untouched.body.model === "Imei Model v2" &&
      cleared.ok &&
      cleared.body.imei === null,
    JSON.stringify({
      set: edited.body.imei,
      kept: untouched.body.imei,
      cleared: cleared.body.imei,
    })
  );

  /* ------------------------------------------------------------------ */
  /* 7: CSV backup carries the IMEI (and still keeps existing columns)   */
  /* ------------------------------------------------------------------ */
  const csv = await page.evaluate(async () => {
    const res = await fetch("/api/backup");
    return await res.text();
  });
  const csvHeader = csv.split(/\r?\n/)[0] || "";
  const imeiRow = csv.split(/\r?\n/).find((line) => line.includes(BOTH)) || "";
  check(
    "G7",
    "CSV backup includes an imei column with the stored value",
    csvHeader.includes("imei") &&
      imeiRow.includes(IMEI_B) &&
      csvHeader.includes("groupId") &&
      csvHeader.includes("damageLoss"),
    JSON.stringify({ header: csvHeader.slice(0, 200), row: imeiRow.slice(0, 260) })
  );

  /* ------------------------------------------------------------------ */
  /* UI: the fields exist, are optional and per device                   */
  /* ------------------------------------------------------------------ */
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector("#svc-tech")?.textContent?.includes("NURUL"),
    { polling: 200, timeout: 20000 }
  );
  // Only UI-originated request bodies matter for the privacy checks below.
  requestBodies.length = 0;

  const uiFields = await page.evaluate(() => ({
    imeiPlaceholder:
      document.querySelector('[data-testid="device-imei-0"]')?.placeholder || "",
    imeiLabel:
      document.querySelector('label[for="svc-imei"]')?.textContent?.trim() || "",
    imeiNotRequired:
      !document.querySelector('[data-testid="device-imei-0"]')?.required,
    lockTestIds: [
      "device-lock-0",
      "device-lock-0-type",
      "device-lock-0-value",
      "svc-lock",
      "svc-lock-type",
      "svc-lock-value",
    ].filter((id) => !!document.querySelector(`[data-testid="${id}"]`)),
    lockLabelText: (document.body.textContent || "").includes(
      "Device Lock (PIN / Pattern / Password)"
    ),
  }));
  check(
    "G8",
    "form shows the optional IMEI and no device lock field",
    uiFields.imeiPlaceholder === "Enter IMEI number (optional)" &&
      uiFields.imeiLabel === "IMEI Number" &&
      uiFields.imeiNotRequired &&
      uiFields.lockTestIds.length === 0 &&
      !uiFields.lockLabelText,
    JSON.stringify(uiFields)
  );

  /* ------------------------------------------------------------------ */
  /* The lock field is gone, so nothing in the form takes a credential  */
  /* ------------------------------------------------------------------ */
  const maskedInputs = await page.evaluate(() =>
    [...document.querySelectorAll('form input[type="password"]')].map(
      (input) => input.dataset.testid || input.id || input.name
    )
  );
  check(
    "G9",
    "the new job form has no masked credential input",
    maskedInputs.length === 0,
    JSON.stringify(maskedInputs)
  );

  /* ------------------------------------------------------------------ */
  /* UI create with an IMEI; no lock field to fill                       */
  /* ------------------------------------------------------------------ */
  const UI_BOTH = uniqueName("UiImei");
  await typeInto(page, "svc-name", UI_BOTH);
  await typeInto(page, "svc-phone", "01700000952");
  await typeInto(page, "svc-model", "UI Imei Model");
  await typeInto(page, "svc-problem", "শুধু IMEI");
  await typeInto(page, "svc-bill", "700");
  await typeInto(page, "svc-imei", IMEI_A);

  await submitForm(page, "সেভ হয়েছে");
  const uiRows = (await dayServices(page)).filter(
    (s) => s.customerName === UI_BOTH
  );
  const uiBodies = requestBodies.join("\n");
  check(
    "G10",
    "UI save stores the IMEI and posts no lock field at all",
    uiRows.length === 1 &&
      uiRows[0].imei === IMEI_A &&
      !uiBodies.includes("lockType") &&
      !uiBodies.includes("lockValue") &&
      !dbHasText(LOCK_A),
    JSON.stringify({
      rows: uiRows.length,
      imei: uiRows[0]?.imei,
      lockKeys: /"lock(Type|Value)"/.test(uiBodies),
      dbLeak: dbHasText(LOCK_A),
    })
  );

  await sleep(300);
  const formReset = await page.evaluate(() => ({
    imei: document.querySelector('[data-testid="device-imei-0"]')?.value ?? null,
    lockFields: ["device-lock-0", "svc-lock"].filter(
      (id) => !!document.querySelector(`[data-testid="${id}"]`)
    ),
  }));
  check(
    "G11",
    "temporary IMEI state clears after a save and no lock field appears",
    formReset.imei === "" && formReset.lockFields.length === 0,
    JSON.stringify(formReset)
  );

  /* ------------------------------------------------------------------ */
  /* UI blank save (no IMEI, no lock) stays normal                       */
  /* ------------------------------------------------------------------ */
  const UI_BLANK = uniqueName("UiImeiBlank");
  await typeInto(page, "svc-name", UI_BLANK);
  await typeInto(page, "svc-phone", "01700000953");
  await typeInto(page, "svc-model", "UI Blank Model");
  await typeInto(page, "svc-problem", "কিছুই না");
  await typeInto(page, "svc-bill", "300");
  await submitForm(page, "সেভ হয়েছে");
  const blankRow = (await dayServices(page)).find(
    (s) => s.customerName === UI_BLANK
  );
  check(
    "G12",
    "UI saves normally with both optional fields empty",
    !!blankRow && blankRow.imei === null,
    JSON.stringify({ id: blankRow?.id, imei: blankRow?.imei })
  );

  /* ------------------------------------------------------------------ */
  /* UI multi-device: per-device inputs do not leak into each other      */
  /* ------------------------------------------------------------------ */
  const UI_MULTI = uniqueName("UiImeiMulti");
  await typeInto(page, "svc-name", UI_MULTI);
  await typeInto(page, "svc-phone", "01700000954");
  await typeInto(page, "svc-model", "Ui Multi A");
  await typeInto(page, "svc-problem", "প্রথম");
  await typeInto(page, "svc-bill", "200");
  await typeInto(page, "svc-imei", IMEI_A);
  await page.$eval('[data-testid="add-device"]', (el) =>
    el.scrollIntoView({ block: "center" })
  );
  await page.click('[data-testid="add-device"]');
  await page.waitForSelector("#svc-device-1-model", { timeout: 5000 });
  await typeInto(page, "svc-device-1-model", "Ui Multi B");
  await typeInto(page, "svc-device-1-problem", "দ্বিতীয়");
  await typeInto(page, "svc-device-1-bill", "400");
  await typeInto(page, "svc-device-1-imei", IMEI_B);
  const beforeSave = await page.evaluate(() => ({
    d1: document.querySelector('[data-testid="device-imei-0"]')?.value,
    d2: document.querySelector('[data-testid="device-imei-1"]')?.value,
    lockFields: ["device-lock-0", "device-lock-1"].filter(
      (id) => !!document.querySelector(`[data-testid="${id}"]`)
    ),
  }));
  await submitForm(page, "2টি ডিভাইস একসাথে সেভ হয়েছে");
  const multiRows = (await dayServices(page))
    .filter((s) => s.customerName === UI_MULTI)
    .sort((a, b) => a.id - b.id);
  const multiBodies = requestBodies.join("\n");
  check(
    "G13",
    "each device card keeps its own IMEI and offers no lock field",
    beforeSave.d1 === IMEI_A &&
      beforeSave.d2 === IMEI_B &&
      beforeSave.lockFields.length === 0 &&
      multiRows.length === 2 &&
      multiRows[0].imei === IMEI_A &&
      multiRows[1].imei === IMEI_B &&
      !multiBodies.includes("lockType") &&
      !multiBodies.includes("lockValue"),
    JSON.stringify({
      beforeSave,
      imeis: multiRows.map((r) => r.imei),
      lockKeys: /"lock(Type|Value)"/.test(multiBodies),
    })
  );

  /* ------------------------------------------------------------------ */
  /* Privacy: list + receipt never show the IMEI                         */
  /* ------------------------------------------------------------------ */
  await waitDailyRow(page, UI_BOTH, true);
  await sleep(400);
  const listText = await page.evaluate((name) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const row = [...section.querySelectorAll("tbody tr")].find(
      (tr) =>
        tr.getAttribute("data-customer") === name ||
        (tr.textContent || "").includes(name)
    );
    return row?.textContent || "";
  }, UI_BOTH);
  check(
    "G14",
    "service list row never renders the IMEI",
    listText.includes(UI_BOTH) && !listText.includes(IMEI_A),
    JSON.stringify({ hasCustomer: listText.includes(UI_BOTH), imei: listText.includes(IMEI_A) })
  );

  const receiptOpened = await page.evaluate((name) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const row = [...section.querySelectorAll("tbody tr")].find(
      (tr) =>
        tr.getAttribute("data-customer") === name ||
        (tr.textContent || "").includes(name)
    );
    const button = row?.querySelector("button[title='বিল প্রিন্ট']");
    if (!button) return false;
    button.click();
    return true;
  }, UI_BOTH);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(400);
  const receiptText = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return dialog?.textContent || "";
  });
  check(
    "G15",
    "receipt dialog never renders the IMEI",
    receiptOpened &&
      receiptText.includes(UI_BOTH) &&
      !receiptText.includes(IMEI_A),
    JSON.stringify({
      opened: receiptOpened,
      hasCustomer: receiptText.includes(UI_BOTH),
      imei: receiptText.includes(IMEI_A),
    })
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { polling: 200, timeout: 8000 }
  );

  /* ------------------------------------------------------------------ */
  /* Editing an existing job loads the stored IMEI; no lock field        */
  /* ------------------------------------------------------------------ */
  const editOpened = await page.evaluate((name) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const row = [...section.querySelectorAll("tbody tr")].find(
      (tr) =>
        tr.getAttribute("data-customer") === name ||
        (tr.textContent || "").includes(name)
    );
    const button = row?.querySelector("button[title='এডিট']");
    if (!button) return false;
    button.click();
    return true;
  }, BOTH);
  await page.waitForSelector("#svc-imei", { timeout: 10000 });
  await sleep(400);
  const editState = await page.evaluate(() => ({
    imei: document.querySelector("#svc-imei")?.value ?? null,
    lockTestIds: ["svc-lock", "svc-lock-type", "svc-lock-value"].filter(
      (id) => !!document.querySelector(`[data-testid="${id}"]`)
    ),
    lockLabelText: (document.body.textContent || "").includes(
      "Device Lock (PIN / Pattern / Password)"
    ),
  }));
  check(
    "G16",
    "editing pre-fills the saved IMEI and offers no lock field",
    editOpened &&
      editState.imei === IMEI_B &&
      editState.lockTestIds.length === 0 &&
      !editState.lockLabelText,
    JSON.stringify({ editOpened, editState })
  );

  /* ------------------------------------------------------------------ */
  /* Database shape: one nullable TEXT column, no credential column      */
  /* ------------------------------------------------------------------ */
  const cols = dbRows("PRAGMA table_info(Service)").map((c) => c.name);
  const imeiCol = dbRows("PRAGMA table_info(Service)").find(
    (c) => c.name === "imei"
  );
  const stored = dbRows("SELECT imei FROM Service WHERE id = ?", [
    bothJob.body.id,
  ]);
  check(
    "G17",
    "schema has an optional imei TEXT column and no lock credential column",
    cols.includes("imei") &&
      imeiCol?.type === "TEXT" &&
      imeiCol?.notnull === 0 &&
      !cols.some((c) => /lock|pin|password|pattern/i.test(c)) &&
      stored[0]?.imei === IMEI_B,
    JSON.stringify({
      type: imeiCol?.type,
      notnull: imeiCol?.notnull,
      lockCols: cols.filter((c) => /lock|pin|password|pattern/i.test(c)),
    })
  );

  check(
    "Z",
    "zero JS errors",
    errors.length === 0,
    errors.slice(0, 3).join(" | ")
  );

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-G CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
