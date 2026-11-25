/* Custom database location engine on a disposable throwaway database.
 *
 * Covers:
 *   1. /api/db-location diagnostics (default path before any pointer).
 *   2. Dashboard UI: path display, exact Bengali strings, testids, modal.
 *   3. Invalid target rejection without touching the pointer/original.
 *   4. Atomic migration: WAL checkpoint + copy + quick_check + pointer commit,
 *      with the original database deliberately kept as an emergency fallback.
 *   5. Live Prisma switchover: the very next write lands in the new file.
 *   6. Fail-safe fallback: a poisoned/unavailable pointer reports an alert
 *      instead of crashing or pointing at a blank new database.
 *
 * Run only through `npm test`; scripts/run-tests.js supplies an isolated DB,
 * backup folder, server port and a live-database guard.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const DB_FILE = process.env.MAHER_DB_PATH;
const CONFIG_FILE = path.join(path.dirname(DB_FILE), "maher-db-location.json");
const FALLBACK_REASON =
  "কাস্টম ডাটাবেজ লোকেশন পাওয়া যায়নি — আগের নিরাপদ লোকেশনে ফিরে এসেছি।";
const WARNING =
  "সতর্কতা: ডাটাবেজটি নতুন লোকেশনে স্থানান্তর করা হবে। নিশ্চিত করুন?";
const LOADING = "ডাটাবেজ স্থানান্তর করা হচ্ছে...";
const SUCCESS = "ডাটাবেজ লোকেশন সফলভাবে পরিবর্তিত হয়েছে!";

if (!DB_FILE || path.basename(DB_FILE) !== process.env.MAHER_TEST_DB_FILE) {
  throw new Error("custom-db-path must run only on the suite throwaway database");
}

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Bengali precomposed vs decomposed letters must not make an exact label fail.
const nfc = (value) => (value ?? "").normalize("NFC");

function countRows(file, table) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n);
  } finally {
    db.close();
  }
}

async function getLocation() {
  const response = await fetch(`${BASE}/api/db-location`, { cache: "no-store" });
  return response.json().catch(() => ({}));
}

let browser = null;

(async () => {
  // Start from a clean pointer so this suite is independent of any other.
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);

  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);

  /* ---------- CDP1: default path, no pointer ---------- */
  const initial = await getLocation();
  check(
    "CDP1",
    "with no custom pointer the resolver reports the throwaway default path",
    initial.location?.source === "default" &&
      path.normalize(initial.location?.activePath ?? "") === path.normalize(DB_FILE) &&
      initial.location?.fallbackReason === null,
    JSON.stringify(initial.location)
  );

  await page.goto(`${BASE}/`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-data-safety"]', {
    polling: 500,
    timeout: 30000,
  });
  const card = await page.evaluate(() => ({
    path: document.querySelector('[data-testid="dashboard-db-path"]')?.textContent ?? "",
    button: !!document.querySelector('[data-testid="btn-change-db-path"]'),
    buttonText:
      document.querySelector('[data-testid="btn-change-db-path"]')?.textContent ?? "",
    badge:
      document.querySelector('[data-testid="db-path-active-badge"]')?.textContent ?? "",
  }));
  check(
    "CDP2",
    "dashboard shows the active path, the green active badge and the change-location button",
    card.path.includes(path.normalize(DB_FILE)) &&
      card.button &&
      card.buttonText.includes("ডাটাবেজ লোকেশন পরিবর্তন করুন") &&
      nfc(card.badge).includes("সক্রিয়"),
    JSON.stringify(card)
  );

  /* ---------- CDP3: modal strings ---------- */
  await page.click('[data-testid="btn-change-db-path"]');
  await page.waitForSelector('[data-testid="db-path-target-input"]', { timeout: 8000 });
  const modal = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="db-path-target-input"]');
    return {
      warning:
        document.querySelector('[data-testid="db-path-warning"]')?.textContent?.trim() ?? "",
      input: !!input,
      confirm: !!document.querySelector('[data-testid="db-path-confirm"]'),
      browse: !!document.querySelector('[data-testid="btn-browse-db-folder"]'),
      browseText:
        document.querySelector('[data-testid="btn-browse-db-folder"]')?.textContent ?? "",
      label: document.querySelector('label[for="db-path-target"]')?.textContent ?? "",
      placeholder: input?.getAttribute("placeholder") ?? "",
      preview:
        document.querySelector('[data-testid="db-path-target-preview"]')?.textContent ?? "",
      presets: ["d", "e", "c"].map((drive) => {
        const el = document.querySelector(`[data-testid="preset-${drive}-drive"]`);
        return { drive, exists: !!el, text: el?.textContent ?? "" };
      }),
    };
  });

  // A preset must fill the input and drive the live preview to the real file.
  await page.click('[data-testid="preset-d-drive"]');
  await page.waitForFunction(
    (value) =>
      document.querySelector('[data-testid="db-path-target-input"]')?.value === value,
    { polling: 100, timeout: 5000 },
    "D:\\MAHER_DATA"
  );
  const presetState = await page.evaluate(() => ({
    value: document.querySelector('[data-testid="db-path-target-input"]')?.value ?? "",
    preview:
      document.querySelector('[data-testid="db-path-target-preview"]')?.textContent ?? "",
  }));
  const presetExpected = path.join("D:\\MAHER_DATA", path.basename(DB_FILE));
  await page.$eval('[data-testid="db-path-target-input"]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  check(
    "CDP3",
    "modal exposes the browse button, drive presets, exact warning and live file preview",
    nfc(modal.warning) === nfc(WARNING) &&
      modal.input &&
      modal.confirm &&
      modal.browse &&
      modal.browseText.includes("ফোল্ডার নির্বাচন করুন") &&
      nfc(modal.label).includes("টার্গেট ফোল্ডার বা সম্পূর্ণ পাথ") &&
      modal.placeholder.includes("D:\\MAHER_DATA") &&
      modal.preview.includes("👉") &&
      modal.presets.every(
        (preset) =>
          preset.exists &&
          preset.text.includes(`${preset.drive.toUpperCase()}:\\MAHER_DATA`)
      ) &&
      presetState.value === "D:\\MAHER_DATA" &&
      presetState.preview.includes(presetExpected),
    JSON.stringify({ modal, presetState, presetExpected })
  );

  /* ---------- CDP4: invalid path rejected; missing folder auto-created ---------- */
  const beforeInvalid = await getLocation();
  // Use Node fetch (not the page) so the expected 400 never becomes a browser
  // console error that would pollute the CDP9 error check.
  const invalidResponse = await fetch(`${BASE}/api/backup/change-db-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPath: "relative-folder" }),
  });
  const invalid = {
    ok: invalidResponse.ok,
    body: await invalidResponse.json().catch(() => ({})),
  };
  const afterInvalid = await getLocation();

  // A chosen drive may not have the folder yet: the API must build the whole
  // chain, write a marker to prove it is writable, migrate and clean up.
  const autoParent = fs.mkdtempSync(path.join(os.tmpdir(), "maher-auto-"));
  const autoDir = path.join(autoParent, "nested", "MAHER_DATA");
  const autoFile = path.join(autoDir, path.basename(DB_FILE));
  const autoResponse = await fetch(`${BASE}/api/backup/change-db-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetPath: autoDir }),
  });
  const auto = {
    ok: autoResponse.ok,
    body: await autoResponse.json().catch(() => ({})),
  };
  const autoLocation = await getLocation();
  const leftovers = fs.existsSync(autoDir)
    ? fs.readdirSync(autoDir).filter((name) => name.startsWith(".maher-"))
    : ["<dir-missing>"];
  // Snapshot before the folder is removed below — the check must describe the
  // state right after migration, not after cleanup.
  const autoFileExists = fs.existsSync(autoFile);

  // Reset to the launcher default so the fixture checks below stay on DB_FILE.
  await fetch(`${BASE}/api/backup/change-db-path`, { method: "DELETE" });
  await api(page, "/api/technicians"); // touch Prisma so a moved handle disconnects
  const resetLocation = await getLocation();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(autoParent, { recursive: true, force: true });
      break;
    } catch {
      await sleep(250);
    }
  }

  check(
    "CDP4",
    "a relative path is rejected while a missing target folder is created, migrated and reset",
    !invalid.ok &&
      afterInvalid.location?.activePath === beforeInvalid.location?.activePath &&
      auto.ok &&
      auto.body.ok === true &&
      typeof auto.body.recordCount === "number" &&
      auto.body.sizeBytes > 0 &&
      path.normalize(auto.body.activePath ?? "") === path.normalize(autoFile) &&
      autoLocation.location?.source === "custom" &&
      autoFileExists &&
      leftovers.length === 0 &&
      resetLocation.location?.source === "default" &&
      path.normalize(resetLocation.location?.activePath ?? "") === path.normalize(DB_FILE),
    JSON.stringify({
      invalid: invalid.body,
      auto: auto.body,
      autoFileExists,
      leftovers,
      reset: resetLocation.location?.source,
    })
  );

  /* ---------- CDP5: seed one row before the move ---------- */
  const roster = await api(page, "/api/technicians");
  if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) throw new Error("NURUL roster setup failed");
  }
  const beforeName = uniqueName("BeforeMove");
  const seeded = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: beforeName,
      phone: "01711000001",
      model: "Before Move",
      technician: "NURUL",
      problem: "Seed row",
      totalBill: 1000,
      advance: 200,
      status: "In-Progress",
      serviceDate: TODAY,
    }),
  });
  if (!seeded.ok) throw new Error(`seed service failed: ${JSON.stringify(seeded.body)}`);
  check(
    "CDP5",
    "the pre-migration fixture row is stored in the original throwaway DB",
    seeded.ok && seeded.body.customerName === beforeName && countRows(DB_FILE, "Service") >= 1,
    JSON.stringify({ id: seeded.body.id, rows: countRows(DB_FILE, "Service") })
  );

  /* ---------- CDP6: successful migration through the UI ---------- */
  const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "maher-custom-db-"));
  const targetFile = path.join(targetDir, path.basename(DB_FILE));
  const originalRows = countRows(DB_FILE, "Service");

  // Delay the POST so the loading state can be observed before it completes.
  await page.setRequestInterception(true);
  const onRequest = (req) => {
    if (req.url().includes("/api/backup/change-db-path") && req.method() === "POST") {
      setTimeout(() => req.continue().catch(() => {}), 2000);
    } else {
      req.continue().catch(() => {});
    }
  };
  page.on("request", onRequest);

  await page.$eval(
    '[data-testid="db-path-target-input"]',
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    targetDir
  );
  await page.click('[data-testid="db-path-confirm"]');

  let loadingSeen = false;
  try {
    await page.waitForFunction(
      (text) => document.body.textContent.includes(text),
      { polling: 100, timeout: 1800 },
      LOADING
    );
    loadingSeen = true;
  } catch {
    loadingSeen = false;
  }
  await page.off("request", onRequest);
  await page.setRequestInterception(false);

  let successToast = false;
  let toastText = "";
  try {
    const handle = await page.waitForFunction(
      (text) => {
        const body = document.body.textContent ?? "";
        return body.includes(text) ? body : false;
      },
      { polling: 200, timeout: 15000 },
      SUCCESS
    );
    toastText = (await handle.jsonValue()) ?? "";
    successToast = toastText.includes(SUCCESS);
  } catch {
    successToast = false;
  }
  const countMatch = toastText.match(/\((\d+)টি রেকর্ড স্থানান্তরিত\)/);
  const toastCount = countMatch ? Number(countMatch[1]) : null;
  const afterMove = await getLocation();
  const targetQuickCheck = (() => {
    const db = new Database(targetFile, { readonly: true, fileMustExist: true });
    try {
      return String(db.pragma("quick_check", { simple: true })).trim();
    } finally {
      db.close();
    }
  })();
  const targetRows = countRows(targetFile, "Service");
  const uiPath = await page.evaluate(
    () => document.querySelector('[data-testid="dashboard-db-path"]')?.textContent ?? ""
  );
  check(
    "CDP6",
    "migration shows loading/success-with-count, verifies, syncs the badge instantly and keeps the original",
    loadingSeen &&
      successToast &&
      toastCount === targetRows &&
      path.normalize(uiPath) === path.normalize(targetFile) &&
      fs.existsSync(targetFile) &&
      fs.existsSync(DB_FILE) &&
      fs.existsSync(CONFIG_FILE) &&
      afterMove.location?.source === "custom" &&
      path.normalize(afterMove.location?.activePath ?? "") === path.normalize(targetFile) &&
      targetQuickCheck.toLowerCase() === "ok" &&
      targetRows === originalRows,
    JSON.stringify({
      loadingSeen,
      successToast,
      toastCount,
      uiPath,
      source: afterMove.location?.source,
      activePath: afterMove.location?.activePath,
      quickCheck: targetQuickCheck,
      targetRows,
      originalRows,
    })
  );

  /* ---------- CDP7: live hot switchover ---------- */
  const afterName = uniqueName("AfterMove");
  const post = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: afterName,
      phone: "01711000002",
      model: "After Move",
      technician: "NURUL",
      problem: "Hot switchover",
      totalBill: 2500,
      advance: 500,
      status: "In-Progress",
      serviceDate: TODAY,
    }),
  });
  const targetRowsAfter = countRows(targetFile, "Service");
  const originalRowsAfter = countRows(DB_FILE, "Service");
  check(
    "CDP7",
    "the next write after migration lands in the new DB, not the kept original",
    post.ok &&
      targetRowsAfter === originalRows + 1 &&
      originalRowsAfter === originalRows,
    JSON.stringify({ post: post.body, targetRowsAfter, originalRowsAfter, originalRows })
  );

  /* ---------- CDP8: fail-safe fallback on an inaccessible pointer ---------- */
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ customDbPath: path.join(os.tmpdir(), `maher-gone-${Date.now()}`, "shop.db") }),
    "utf8"
  );
  const fallback = await getLocation();
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-data-safety"]', { timeout: 30000 });
  const alert = await page.evaluate(() => ({
    text:
      document.querySelector('[data-testid="dashboard-db-path-fallback"]')?.textContent ?? "",
    role: document.querySelector('[data-testid="dashboard-db-path-fallback"]')?.getAttribute("role"),
    badge: !!document.querySelector('[data-testid="db-path-active-badge"]'),
  }));
  check(
    "CDP8",
    "an unavailable custom drive falls back to the default DB with the exact alert and no active badge",
    fallback.location?.source === "fallback" &&
      path.normalize(fallback.location?.activePath ?? "") === path.normalize(DB_FILE) &&
      fallback.location?.fallbackReason === FALLBACK_REASON &&
      alert.text.includes(FALLBACK_REASON) &&
      alert.role === "alert" &&
      alert.badge === false,
    JSON.stringify({ location: fallback.location, alert })
  );

  check(
    "CDP9",
    "no unexpected browser errors during custom-location flows",
    errors.length === 0,
    errors.join(" | ")
  );

  console.log(results.join("\n"));
  if (failed) {
    console.error("custom-db-path: checks failed");
    process.exitCode = 1;
  } else {
    console.log("custom-db-path: all checks passed");
  }
})()
  .catch((err) => {
    console.error("CUSTOM-DB-PATH CRASH:", err.stack || err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeBrowser(browser);
  });
