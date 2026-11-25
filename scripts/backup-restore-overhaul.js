/* Multi-format backup export + offline restore safety contract.
 *
 * Runs only on the disposable database provisioned by scripts/run-tests.js.
 * It verifies the four export formats, the new Dashboard modal workflow, and
 * the upload restore pipeline (magic-byte validation, schema validation,
 * safety snapshot, ShopSettings preservation, context refresh, exact toast).
 */
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const DB_FILE = process.env.MAHER_DB_PATH;
const BACKUP_DIR = process.env.MAHER_BACKUP_DIR;

if (!DB_FILE || path.basename(DB_FILE) !== process.env.MAHER_TEST_DB_FILE) {
  throw new Error("backup-restore-overhaul must run only on the suite throwaway DB");
}
if (!BACKUP_DIR) throw new Error("MAHER_BACKUP_DIR is required");

const WARNING =
  "সতর্কতা: ব্যাকআপ ফাইলটি রিস্টোর করলে বর্তমানের অসংরক্ষিত ডাটা প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?";
const SUCCESS = "ডাটা সফলভাবে রিস্টোর করা হয়েছে!";
const NEW_WARNING =
  "সতর্কতা: ব্যাকআপ রিস্টোর করলে বর্তমান ডাটাবেজ প্রতিস্থাপিত হবে। নিশ্চিত করুন?";
const NEW_SUCCESS = "ডাটাবেজ সফলভাবে রিস্টোর করা হয়েছে!";
const LOADING = "ডাটাবেজ রিস্টোর করা হচ্ছে... অনুগ্রহ করে অপেক্ষা করুন।";
const CORRUPT = "ব্যাকআপ ফাইলটি নষ্ট বা ক্ষতিগ্রস্ত (Corrupted SQLite file)";
const SUBTEXTS = [
  "পিসি পরিবর্তন বা ডাটা পুনরুদ্ধারের মূল ব্যাকআপ ফাইল। এটি রিস্টোর অপশনে ব্যবহারযোগ্য।",
  "সার্ভিস, প্রোডাক্ট ও হিসাবের বহু-ট্যাব বিশিষ্ট সম্পূর্ণ এক্সেল শিট।",
  "প্রিন্ট ও অফিশিয়াল ডকুমেন্টের জন্য তৈরি করা সারাংশ রিপোর্ট।",
  "অন্য সফটওয়্যারে ব্যবহারের উপযোগী র ডাটা ফাইল।",
];
const EXPORT_IDS = [
  "export-system-backup",
  "export-excel",
  "export-pdf",
  "export-csv",
];

const results = [];
let failed = false;
function check(id, name, ok, extra = "") {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
}

function openDb(file = DB_FILE) {
  const db = new Database(file);
  db.pragma("busy_timeout = 5000");
  return db;
}

async function fetchBytes(page, url, options = {}) {
  return page.evaluate(
    async ({ u, init }) => {
      const res = await fetch(u, init);
      const buf = await res.arrayBuffer();
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        disposition: res.headers.get("content-disposition") ?? "",
        bytes: Array.from(new Uint8Array(buf)),
      };
    },
    { u: url, init: options }
  );
}

async function fetchJson(page, url, options = {}) {
  return page.evaluate(
    async ({ u, init }) => {
      const res = await fetch(u, init);
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body: data };
    },
    { u: url, init: options }
  );
}

async function uploadBytes(page, bytes, filename) {
  return page.evaluate(
    async ({ b64, name }) => {
      const binary = atob(b64);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i);
      const file = new File([arr], name, { type: "application/octet-stream" });
      const form = new FormData();
      form.append("file", file, name);
      const res = await fetch("/api/backup/restore", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, body: data };
    },
    { b64: Buffer.from(bytes).toString("base64"), name: filename }
  );
}

async function setUploadInput(page, bytes, filename) {
  await page.evaluate(
    ({ b64, name }) => {
      const binary = atob(b64);
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) arr[i] = binary.charCodeAt(i);
      const file = new File([arr], name, { type: "application/octet-stream" });
      const input = document.querySelector(
        '[data-testid="restore-file-input"]'
      );
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("restore-file-input missing");
      }
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { b64: Buffer.from(bytes).toString("base64"), name: filename }
  );
}

async function modalIsOpen(page) {
  return page.evaluate(() => !!document.querySelector('[data-testid="export-system-backup"]'));
}

/** Radix keeps the closing dialog mounted for its exit animation. */
async function waitExportClosed(page) {
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="export-system-backup"]'),
    { polling: 100, timeout: 5000 }
  );
}

async function openExportModal(page) {
  if (await modalIsOpen(page)) return;
  // Every successful export calls onExported -> loadOverview(), which can
  // replace the trigger node while its exit animation is still finishing.
  // A single hit-test/click can therefore be lost; retry on the settled DOM.
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForSelector('[data-testid="dashboard-backup"]', {
        visible: true,
        timeout: 10000,
      });
      await page.click('[data-testid="dashboard-backup"]');
      await page.waitForSelector('[data-testid="export-system-backup"]', {
        visible: true,
        timeout: 4000,
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error("export modal did not open");
}

async function exportViaModal(page, testId, extension) {
  await openExportModal(page);
  const before = await page.evaluate(() => window.__exportDownloads.length);
  await page.click(`[data-testid="${testId}"]`);
  await page.waitForFunction(
    (count, ext) =>
      window.__exportDownloads.length > count &&
      String(window.__exportDownloads[window.__exportDownloads.length - 1]).endsWith(ext),
    { polling: 200, timeout: 20000 },
    before,
    extension
  );
  const download = await page.evaluate(
    () => window.__exportDownloads[window.__exportDownloads.length - 1]
  );
  await waitExportClosed(page);
  return download;
}

async function createService(page, customerName, bill = 100) {
  const res = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName,
      phone: "01000000999",
      model: "TEST-M",
      technician: "NURUL",
      problem: "P",
      totalBill: bill,
      advance: 0,
      status: "Pending",
      serviceDate: dhakaToday(),
    }),
  });
  return res;
}

function readSettingName() {
  const db = openDb();
  try {
    const row = db.prepare("SELECT shopName FROM ShopSettings WHERE id = 1").get();
    return row?.shopName ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

function readServiceNames(fragment) {
  const db = openDb();
  try {
    return db
      .prepare("SELECT customerName FROM Service WHERE customerName LIKE ?")
      .all(`%${fragment}%`)
      .map((r) => r.customerName);
  } finally {
    db.close();
  }
}

let browser = null;

function source(file) {
  return fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
}

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);

  await page.goto(`${BASE}/dashboard`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });

  // ------------------------------------------------------------ H1–H3 (source)
  const restoreSrc = source("app/api/backup/restore/route.ts");
  const restoreLibSrc = source("lib/backup-restore-file.ts");
  const exportSrc = source("app/api/backup/route.ts");
  const dialogSrc = source("components/RestoreDialog.tsx");
  const dashSrc = source("components/dashboard/DashboardView.tsx");
  const restoreAllSrc = `${restoreSrc}\n${restoreLibSrc}`;
  const uiSrc = `${dialogSrc}\n${dashSrc}`;
  const restoreNeedles = [
    'export const dynamic = "force-dynamic"',
    "maxDuration = 60",
    "temp-restore-",
    "PRAGMA quick_check",
    CORRUPT,
    'shop.db.pre-restore.bak',
    "-wal",
    "-shm",
    "servicesCount",
    "productsCount",
    "CustomerPayment",
    "SupplierExpense",
    "AuditLog",
    ".sqlite",
  ];
  check(
    "H1",
    "restore route carries the hardened upload/validation/snapshot contract",
    restoreNeedles.every((n) => restoreAllSrc.includes(n)),
    JSON.stringify(restoreNeedles.filter((n) => !restoreAllSrc.includes(n)))
  );
  const exportNeedles = [
    "PRAGMA wal_checkpoint(TRUNCATE)",
    "\\uFEFF",
    "Service",
    "Product",
    "CustomerPayment",
    "SupplierExpense",
    "Technician",
    "AuditLog",
  ];
  check(
    "H2",
    "export route checkpoints WAL and audits every backup model with a BOM",
    exportNeedles.every((n) => exportSrc.includes(n)),
    JSON.stringify(exportNeedles.filter((n) => !exportSrc.includes(n)))
  );
  const uiNeedles = [
    "btn-restore-backup",
    "modal-restore-backup",
    "btn-confirm-restore",
    "restore-meta-name",
    "restore-meta-size",
    "restore-meta-records",
    ".sqlite",
    NEW_WARNING,
    LOADING,
    NEW_SUCCESS,
    "window.location.reload()",
  ];
  check(
    "H3",
    "restore UI ships the modal, metadata, warning, loading and reload contract",
    uiNeedles.every((n) => uiSrc.includes(n)),
    JSON.stringify(uiNeedles.filter((n) => !uiSrc.includes(n)))
  );

  // ---------------------------------------------------------------- E1–E4
  const system = await fetchBytes(page, "/api/backup?format=system");
  const sysFile = path.join(path.dirname(DB_FILE), "export-system-check.db");
  fs.writeFileSync(sysFile, Buffer.from(system.bytes));
  let sysDb = null;
  let sysTables = [];
  try {
    sysDb = new Database(sysFile, { readonly: true });
    sysTables = sysDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
  } catch (err) {
    sysTables = [`error:${err.message}`];
  } finally {
    sysDb?.close();
  }
  check(
    "E1",
    "system export is a downloadable SQLite snapshot excluding ShopSettings",
    system.ok &&
      Buffer.from(system.bytes.slice(0, 16)).toString("latin1") ===
        "SQLite format 3\0" &&
      /MAHER_SYSTEM_BACKUP_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.db/.test(
        system.disposition
      ) &&
      sysTables.includes("Service") &&
      !sysTables.includes("ShopSettings"),
    JSON.stringify({ status: system.status, disposition: system.disposition, sysTables })
  );

  const xlsx = await fetchBytes(page, "/api/backup?format=xlsx");
  check(
    "E2",
    "Excel export returns a multi-tab workbook download",
    xlsx.ok &&
      xlsx.bytes[0] === 0x50 &&
      xlsx.bytes[1] === 0x4b &&
      xlsx.contentType.includes("spreadsheetml") &&
      /\.xlsx/.test(xlsx.disposition),
    JSON.stringify({ status: xlsx.status, contentType: xlsx.contentType, disposition: xlsx.disposition })
  );

  const pdf = await fetchBytes(page, "/api/backup?format=pdf");
  check(
    "E3",
    "PDF export returns a structured business overview download",
    pdf.ok &&
      Buffer.from(pdf.bytes.slice(0, 4)).toString("latin1") === "%PDF" &&
      pdf.contentType.includes("application/pdf") &&
      /\.pdf/.test(pdf.disposition),
    JSON.stringify({ status: pdf.status, contentType: pdf.contentType, disposition: pdf.disposition })
  );

  const csv = await fetchBytes(page, "/api/backup");
  const csvText = Buffer.from(csv.bytes).toString("utf8");
  check(
    "E4",
    "CSV export remains a clean UTF-8 download",
    csv.ok &&
      csvText.charCodeAt(0) === 0xfeff &&
      csvText.includes("customer") &&
      csv.contentType.includes("text/csv") &&
      /\.csv/.test(csv.disposition),
    JSON.stringify({ status: csv.status, contentType: csv.contentType, disposition: csv.disposition })
  );

  // ---------------------------------------------------------------- M1–M6
  await page.evaluate(() => {
    window.__exportDownloads = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (typeof this.download === "string" && this.download) {
        window.__exportDownloads.push(this.download);
        return;
      }
      return originalClick.call(this);
    };
  });

  let modalOk = false;
  try {
    await page.click('[data-testid="dashboard-backup"]');
    await page.waitForSelector('[data-testid="export-system-backup"]', {
      visible: true,
      timeout: 6000,
    });
    modalOk = true;
  } catch {
    modalOk = false;
  }
  const immediateDownloads = await page.evaluate(() => window.__exportDownloads.length);
  check(
    "M1",
    "dashboard-backup opens the export modal without an immediate download",
    modalOk && immediateDownloads === 0,
    `modal=${modalOk}, downloads=${immediateDownloads}`
  );

  const modalContent = modalOk
    ? await page.evaluate((ids, texts) => {
        const allIds = ids.every((id) => !!document.querySelector(`[data-testid="${id}"]`));
        const body = document.body.textContent ?? "";
        const allTexts = texts.every((t) => body.includes(t));
        return { allIds, allTexts };
      }, EXPORT_IDS, SUBTEXTS)
    : { allIds: false, allTexts: false };
  check(
    "M2",
    "modal shows all four format options with exact subtext",
    modalContent.allIds && modalContent.allTexts,
    JSON.stringify(modalContent)
  );

  const backupButtons = await page.evaluate(
    () =>
      [...document.querySelectorAll("button")].filter((b) =>
        b.textContent.includes("এখন ব্যাকআপ নিন")
      ).length
  );
  check("M3", "no redundant one-click backup button remains", backupButtons === 1, `count=${backupButtons}`);

  if (modalOk) {
    if (await modalIsOpen(page)) await page.keyboard.press("Escape");
    const cases = [
      ["M4", "export-system-backup", ".db", "system SQLite snapshot"],
      ["M5", "export-excel", ".xlsx", "Excel workbook"],
      ["M6", "export-pdf", ".pdf", "PDF summary"],
      ["M7", "export-csv", ".csv", "UTF-8 CSV"],
    ];
    for (const [id, testId, ext, label] of cases) {
      try {
        const name = await exportViaModal(page, testId, ext);
        check(id, `${label} option downloads the expected file`, !!name, name);
      } catch (err) {
        check(id, `${label} option downloads the expected file`, false, err.message.slice(0, 160));
      }
    }
  } else {
    for (const id of ["M4", "M5", "M6", "M7"]) {
      check(id, "export option download", false, "modal never opened");
    }
  }

  // ---------------------------------------------------------------- R1–R9
  const marker = `SYS_MARKER_${Date.now()}`;
  const afterMarker = `AFTER_SNAP_${Date.now()}`;
  const created = await createService(page, marker);
  check("R1", "restore fixture service created", created.ok, JSON.stringify(created.body).slice(0, 160));

  const settings = await api(page, "/api/shop-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shopName: "Local Restore Guard", secretCipher: { mode: "keypad" } }),
  });
  check(
    "R2",
    "local ShopSettings singleton seeded with a value that must survive restore",
    settings.ok && readSettingName() === "Local Restore Guard",
    JSON.stringify({ status: settings.status, name: readSettingName() })
  );

  const snapshot = await fetchBytes(page, "/api/backup?format=system");
  const snapshotBytes = Buffer.from(snapshot.bytes);
  await createService(page, afterMarker);
  check("R3", "post-snapshot service added to prove replacement", readServiceNames(afterMarker).length > 0);

  await page.evaluate(() => {
    window.__restorePosts = 0;
    window.__settingsFetches = 0;
    window.__lastRestore = null;
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (url.includes("/api/backup/restore")) window.__restorePosts += 1;
      if (url.includes("/api/shop-settings")) window.__settingsFetches += 1;
      const res = await originalFetch(...args);
      if (url.includes("/api/backup/restore")) {
        try {
          window.__lastRestore = { status: res.status, body: await res.clone().json() };
        } catch {
          window.__lastRestore = { status: res.status, body: null };
        }
      }
      return res;
    };
  });

  let restoreUiOk = false;
  try {
    await waitExportClosed(page);
    await page.click('[data-testid="dashboard-restore"]');
    await page.waitForSelector('[data-testid="modal-restore-backup"]', {
      visible: true,
      timeout: 10000,
    });
    await page.waitForSelector('[data-testid="restore-file-input"]', {
      visible: true,
      timeout: 10000,
    });
    const warningShown = await page.evaluate(
      (text) => document.body.textContent.includes(text),
      WARNING
    );
    check("R4", "restore dialog shows the exact replacement warning", warningShown);
    const newWarningShown = await page.evaluate(
      (text) => document.body.textContent.includes(text),
      NEW_WARNING
    );
    const accept = await page.$eval('[data-testid="restore-file-input"]', (el) => el.accept);
    check(
      "H4",
      "restore modal shows the new high-contrast warning and accepts all backup types",
      newWarningShown && [".db", ".sqlite", ".sql", ".maherbackup"].every((ext) => accept.includes(ext)),
      JSON.stringify({ newWarningShown, accept })
    );
    await setUploadInput(page, snapshotBytes, "MAHER_SYSTEM_BACKUP_test.db");
    await page.click('[data-testid="restore-upload"]');
    await page.waitForSelector('[data-testid="restore-meta-records"]', {
      visible: true,
      timeout: 10000,
    });
    const meta = await page.evaluate(() => ({
      name: document.querySelector('[data-testid="restore-meta-name"]')?.textContent ?? "",
      size: document.querySelector('[data-testid="restore-meta-size"]')?.textContent ?? "",
      records: document.querySelector('[data-testid="restore-meta-records"]')?.textContent ?? "",
      confirm: !!document.querySelector('[data-testid="btn-confirm-restore"]'),
    }));
    check(
      "H5",
      "chosen file shows name, size and detected record count with an armed confirm button",
      meta.name.includes("MAHER_SYSTEM_BACKUP_test.db") &&
        /\d/.test(meta.size) &&
        /\d/.test(meta.records) &&
        meta.confirm,
      JSON.stringify(meta)
    );
    await page.waitForSelector('[data-testid="restore-upload-confirm"]', {
      visible: true,
      timeout: 10000,
    });
    const postsBeforeConfirm = await page.evaluate(() => window.__restorePosts);
    check(
      "R5",
      "upload requires a second confirmation before replacing data",
      postsBeforeConfirm === 0,
      `posts=${postsBeforeConfirm}`
    );

    const settingsBefore = await page.evaluate(() => window.__settingsFetches);
    await page.click('[data-testid="restore-upload-confirm"]');
    await page.waitForFunction(() => window.__lastRestore !== null, {
      polling: 200,
      timeout: 15000,
    });
    await waitToast(page, SUCCESS);
    const settingsAfter = await page.evaluate(() => window.__settingsFetches);
    restoreUiOk = true;
    check(
      "R6",
      "successful upload restore refreshes the global settings context",
      settingsAfter > settingsBefore,
      `before=${settingsBefore}, after=${settingsAfter}`
    );
    const lastRestore = await page.evaluate(() => window.__lastRestore);
    check(
      "H6",
      "restore response exposes servicesCount/productsCount metadata",
      Number.isInteger(lastRestore?.body?.servicesCount) &&
        Number.isInteger(lastRestore?.body?.productsCount),
      JSON.stringify(lastRestore?.body).slice(0, 200)
    );
  } catch (err) {
    restoreUiOk = false;
    check("R4", "restore dialog shows the exact replacement warning", false, err.message.slice(0, 160));
    for (const id of ["H4", "H5", "R5", "R6"]) check(id, "restore UI contract", false, err.message.slice(0, 160));
  }

  if (restoreUiOk) {
    const bodyText = await page.evaluate(() => document.body.textContent);
    check("R7", "exact Bengali success toast shown", bodyText.includes(SUCCESS));
    check("H7", "new Bengali success toast shown", bodyText.includes(NEW_SUCCESS));
  } else {
    check("R7", "exact Bengali success toast shown", false, "UI restore failed");
    check("H7", "new Bengali success toast shown", false, "UI restore failed");
  }

  const emergencySnapshot = path.join(path.dirname(DB_FILE), "shop.db.pre-restore.bak");
  check(
    "H8",
    "emergency pre-restore snapshot written next to the active database",
    fs.existsSync(emergencySnapshot),
    emergencySnapshot
  );
  check(
    "H9",
    "temporary upload files and WAL/SHM sidecars are cleaned up",
    fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith("temp-restore-")).length === 0,
    BACKUP_DIR
  );

  // Verify the persisted effects even when the UI assertions failed, so a
  // backend-only regression is still visible in the report.
  const restoredNames = readServiceNames(marker);
  const afterNames = readServiceNames(afterMarker);
  check(
    "R8",
    "restore replaces ledger rows and keeps ShopSettings id=1 untouched",
    restoredNames.length > 0 && afterNames.length === 0 && readSettingName() === "Local Restore Guard",
    JSON.stringify({ restored: restoredNames.length, after: afterNames.length, shopName: readSettingName() })
  );

  const backupListing = await fetchJson(page, "/api/backup/list");
  const safetyFiles = (backupListing.body?.snapshots ?? []).filter((s) => s.file.startsWith("safety-"));
  check("R9", "temporary safety snapshot created before restore", safetyFiles.length > 0, JSON.stringify(safetyFiles.slice(0, 2)));

  // ------------------------------------------------------------ R10–R14
  const badExtension = await uploadBytes(page, snapshotBytes, "snapshot.txt");
  check("R10", "unsupported file extension rejected", badExtension.status === 400, JSON.stringify(badExtension.body));

  const badMagic = Buffer.from("this is not a sqlite database", "utf8");
  const magicResult = await uploadBytes(page, badMagic, "broken.db");
  check("R11", "invalid magic bytes rejected", magicResult.status === 400, JSON.stringify(magicResult.body));

  const corruptBytes = Buffer.concat([
    Buffer.from("SQLite format 3\0", "latin1"),
    Buffer.from("corrupted-pages-not-a-database".padEnd(512, "x"), "latin1"),
  ]);
  const corruptResult = await uploadBytes(page, corruptBytes, "corrupt.db");
  check(
    "H10",
    "quick_check failure returns the exact Bengali corruption error",
    corruptResult.status === 400 && corruptResult.body?.error === CORRUPT,
    JSON.stringify(corruptResult.body)
  );

  const emptyDbFile = path.join(path.dirname(DB_FILE), "no-schema.db");
  const emptyDb = new Database(emptyDbFile);
  emptyDb.exec('CREATE TABLE "Other" ("id" INTEGER PRIMARY KEY)');
  emptyDb.close();
  const badSchema = await uploadBytes(page, fs.readFileSync(emptyDbFile), "no-schema.db");
  check("R12", "SQLite file without the Service schema rejected", badSchema.status === 400, JSON.stringify(badSchema.body));

  const sqlCols = [
    "id", "customerName", "phone", "model", "technician", "problem",
    "totalBill", "advance", "due", "status", "shopExpense", "expenseAmount",
    "serviceDate", "archived", "createdAt", "updatedAt",
  ];
  const sqlDump = [
    'CREATE TABLE "Service" (',
    '"id" INTEGER PRIMARY KEY, "customerName" TEXT, "phone" TEXT, "model" TEXT,',
    '"technician" TEXT, "problem" TEXT, "totalBill" REAL, "advance" REAL,',
    '"due" REAL, "status" TEXT, "shopExpense" TEXT, "expenseAmount" REAL,',
    '"serviceDate" DATETIME, "archived" INTEGER, "createdAt" DATETIME, "updatedAt" DATETIME',
    ');',
    `INSERT INTO "Service" (${sqlCols.map((c) => `"${c}"`).join(", ")}) VALUES ` +
      `(99001, 'SQL_DUMP_RESTORE', '01000000111', 'M', 'NURUL', 'P', 500, 100, 400, ` +
      `'Pending', NULL, 0, '2026-11-23 12:00:00', 0, '2026-11-23 12:00:00', '2026-11-23 12:00:00');`,
  ].join("\n");
  const sqlResult = await uploadBytes(page, Buffer.from(sqlDump, "utf8"), "dump.sql");
  check(
    "R13",
    "valid .sql snapshot import accepted",
    sqlResult.ok && readServiceNames("SQL_DUMP_RESTORE").length > 0,
    JSON.stringify(sqlResult.body).slice(0, 200)
  );

  const maherResult = await uploadBytes(page, snapshotBytes, "snapshot.maherbackup");
  check("R14", "valid .maherbackup snapshot accepted", maherResult.ok, JSON.stringify(maherResult.body).slice(0, 200));

  const sqliteResult = await uploadBytes(page, snapshotBytes, "snapshot.sqlite");
  check(
    "H11",
    "valid .sqlite snapshot accepted",
    sqliteResult.ok,
    JSON.stringify(sqliteResult.body).slice(0, 200)
  );

  const unexpectedErrors = errors.filter((e) => !e.includes("400 (Bad Request)"));
  check("R15", "no unexpected browser errors", unexpectedErrors.length === 0, unexpectedErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  if (failed) {
    console.error(`backup-restore-overhaul: ${results.filter((r) => r.startsWith("FAIL")).length} failed`);
    process.exitCode = 1;
  } else {
    console.log("backup-restore-overhaul: all checks passed");
  }
})().catch((err) => {
  console.log(results.join("\n"));
  console.error("backup-restore-overhaul crashed:", err);
  process.exitCode = 1;
}).finally(async () => {
  await closeBrowser(browser);
});
