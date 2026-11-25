/* MSS assisted-installer contract.
 *
 * Pins the user-facing install flow: a real wizard with an install-path page,
 * a second page choosing the data folder (default D:\MSS-Data, drive C always
 * rejected), an Update / Cancel prompt over an existing install, and a legacy
 * AppData database that is carried into the new folder on update.
 *
 * Static checks read source/config only. Runtime checks use throwaway folders;
 * they never touch prisma/dev.db, %AppData%\MSS or a real shop database.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
let failed = false;
const record = (ok, id, name, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};
const check = (id, name, fn) => {
  try {
    fn();
    record(true, id, name);
  } catch (error) {
    record(false, id, name, error?.message ?? String(error));
  }
};

const config = JSON.parse(read("packaging/electron-builder.json"));

check("MI-01", "NSIS runs an assisted wizard with a changeable install directory", () => {
  assert.strictEqual(config.nsis.oneClick, false, "one-click must be off");
  assert.strictEqual(
    config.nsis.allowToChangeInstallationDirectory,
    true,
    "the install-path page must be enabled"
  );
  assert.strictEqual(config.nsis.perMachine, false, "per-user install stays the default");
  assert.strictEqual(config.nsis.include, "packaging/mss-installer.nsh");
});

check("MI-02", "custom NSIS hooks cover update prompt, data page and pointer write", () => {
  const nsh = read("packaging/mss-installer.nsh");
  for (const hook of ["!macro customInit", "!macro customPageAfterChangeDir", "!macro customInstall"]) {
    assert.ok(nsh.includes(hook), `missing NSIS hook ${hook}`);
  }
  assert.ok(nsh.includes("PageEx directory"), "data folder needs a real wizard page");
  assert.ok(nsh.includes("DirVar $mssDataRoot"), "the data page must edit the data root");
  assert.ok(nsh.includes("PageCallbacks mssDataPagePre"), "a pre callback skips the page on update");
});

check("MI-03", "installer defaults the data folder to D:\\MSS-Data", () => {
  const nsh = read("packaging/mss-installer.nsh");
  assert.ok(nsh.includes('StrCpy $mssDataRoot "D:\\MSS-Data"'), "default data root is missing");
});

check("MI-04", "installer rejects any C: data path and checks the folder is writable", () => {
  const nsh = read("packaging/mss-installer.nsh");
  assert.ok(nsh.includes('StrCpy $0 $mssDataRoot 2'), "drive prefix must be inspected");
  assert.ok(/StrCmp \$0 "C:"/.test(nsh), "uppercase C: must be rejected");
  assert.ok(/StrCmp \$0 "c:"/.test(nsh), "lowercase c: must be rejected");
  assert.ok(nsh.includes("CreateDirectory \"$mssDataRoot\""), "chosen folder must be created");
  assert.ok(nsh.includes("IfErrors"), "folder creation errors must abort the page");
});

check("MI-05", "an existing install gets an explicit Update / Cancel choice", () => {
  const nsh = read("packaging/mss-installer.nsh");
  assert.ok(nsh.includes("Var mssInstalled"), "detection must use this include's own var");
  assert.ok(nsh.includes('ReadRegStr $mssInstalled HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation'));
  assert.ok(nsh.includes('ReadRegStr $mssInstalled HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation'));
  assert.ok(/MessageBox MB_YESNO/.test(nsh), "Update / Cancel needs a yes/no dialog");
  assert.ok(/Update/i.test(nsh) && /Cancel/i.test(nsh), "dialog must name Update and Cancel");
  assert.ok(nsh.includes("IDNO"), "No must be handled");
  assert.ok(/\bQuit\b/.test(nsh), "Cancel must stop the installer");
});

check("MI-06", "installer writes the data pointer beside MSS.exe and into the registry", () => {
  const nsh = read("packaging/mss-installer.nsh");
  assert.ok(nsh.includes('"$INSTDIR\\mss-data-root.txt"'), "app must find the chosen data root");
  assert.ok(nsh.includes("FileWrite $0 \"$mssDataRoot\""), "pointer file content is missing");
  assert.ok(nsh.includes("MSSDataRoot"), "registry value keeps the root on later updates");
});

check("MI-18", "the appId stays stable so an older install is recognised as an update", () => {
  assert.strictEqual(config.appId, "com.maher.mobilecare.desktop");
  const nsh = read("packaging/mss-installer.nsh");
  assert.ok(nsh.includes('"$mssInstalled\\mss-data-root.txt" r'), "updates must read the old pointer");
  assert.ok(nsh.includes("FileRead $0 $mssStoredRoot"), "registry-less updates keep their data root");
});

check("MI-07", "pure resolver prefers an explicit environment root (dev/tests)", () => {
  const { resolveDataRoot } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-env-"));
  try {
    const root = path.join(tmp, "env-root");
    const result = resolveDataRoot({
      env: { MAHER_USER_DATA_DIR: root },
      exeDir: tmp,
      appData: path.join(tmp, "AppData"),
      isPackaged: false,
    });
    assert.strictEqual(result.root, path.resolve(root));
    assert.strictEqual(result.source, "env");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-16", "a packaged app rejects a C: env override instead of bypassing the wizard", () => {
  const { resolveDataRoot } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-env-c-"));
  try {
    assert.throws(
      () =>
        resolveDataRoot({
          env: { MAHER_USER_DATA_DIR: tmp },
          exeDir: tmp,
          appData: path.join(tmp, "AppData"),
          isPackaged: true,
        }),
      /drive C/i
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-08", "pure resolver consumes the installer-written non-C pointer", () => {
  const { resolveDataRoot, DATA_ROOT_FILENAME } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-pointer-"));
  try {
    fs.writeFileSync(path.join(tmp, DATA_ROOT_FILENAME), "D:\\MSS-Data\n");
    const result = resolveDataRoot({ env: {}, exeDir: tmp, appData: tmp, isPackaged: true });
    assert.strictEqual(result.root, path.resolve("D:\\MSS-Data"));
    assert.strictEqual(result.source, "installer");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-09", "a poisoned C: pointer is rejected instead of silently used", () => {
  const { resolveDataRoot, DATA_ROOT_FILENAME } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-c-"));
  try {
    fs.writeFileSync(path.join(tmp, DATA_ROOT_FILENAME), "c:\\ProgramData\\MSS");
    assert.throws(
      () => resolveDataRoot({ env: {}, exeDir: tmp, appData: tmp, isPackaged: true }),
      /drive C/i
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-10", "a packaged app without a pointer fails instead of writing data to C:", () => {
  const { resolveDataRoot } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-noptr-"));
  try {
    assert.throws(
      () => resolveDataRoot({ env: {}, exeDir: tmp, appData: tmp, isPackaged: true }),
      /re-run MSS-Setup/i
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-11", "unpacked dev launches keep the old AppData fallback", () => {
  const { resolveDataRoot } = require("../electron/data-root.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-dev-"));
  try {
    const result = resolveDataRoot({ env: {}, exeDir: tmp, appData: tmp, isPackaged: false });
    assert.strictEqual(result.root, path.join(tmp, "MSS"));
    assert.strictEqual(result.source, "dev-fallback");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-12", "updating the shipped one-click build copies its legacy database", () => {
  const { migrateLegacyData } = require("../electron/data-migrate.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-migrate-"));
  try {
    const appData = path.join(tmp, "AppData");
    const legacyData = path.join(appData, "MAHER-MOBILE-CARE", "data");
    const legacyDb = path.join(legacyData, "shop.db");
    fs.mkdirSync(legacyData, { recursive: true });
    fs.writeFileSync(legacyDb, Buffer.from("SQLite format 3\0", "ascii"));
    fs.writeFileSync(
      path.join(legacyData, "maher-db-location.json"),
      JSON.stringify({ customDbPath: "C:\\legacy\\shop.db" })
    );
    const targetRoot = path.join(tmp, "MSS-Data");
    const result = migrateLegacyData({ root: targetRoot, appData });
    assert.strictEqual(result.migrated, true);
    assert.ok(fs.existsSync(path.join(targetRoot, "data", "shop.db")));
    assert.ok(
      !fs.existsSync(path.join(targetRoot, "data", "maher-db-location.json")),
      "a legacy C: pointer must never be carried into the new root"
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-17", "an MSS-branded legacy install and its custom DB pointer are also migrated", () => {
  const { migrateLegacyData } = require("../electron/data-migrate.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-mss-migrate-"));
  try {
    const appData = path.join(tmp, "AppData");
    const legacyData = path.join(appData, "MSS", "data");
    const customDb = path.join(tmp, "custom-ledger.db");
    fs.mkdirSync(legacyData, { recursive: true });
    fs.writeFileSync(customDb, Buffer.from("SQLite format 3\0", "ascii"));
    fs.writeFileSync(
      path.join(legacyData, "maher-db-location.json"),
      JSON.stringify({ customDbPath: customDb })
    );
    const targetRoot = path.join(tmp, "MSS-Data");
    const result = migrateLegacyData({ root: targetRoot, appData });
    assert.strictEqual(result.migrated, true);
    assert.strictEqual(
      fs.readFileSync(path.join(targetRoot, "data", "shop.db"), "utf8"),
      "SQLite format 3\0"
    );
    assert.ok(!fs.existsSync(path.join(targetRoot, "data", "maher-db-location.json")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-13", "migration never overwrites an existing shop database", () => {
  const { migrateLegacyData } = require("../electron/data-migrate.cjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-installer-nooverwrite-"));
  try {
    const appData = path.join(tmp, "AppData");
    const legacyDb = path.join(appData, "MSS", "data", "shop.db");
    fs.mkdirSync(path.dirname(legacyDb), { recursive: true });
    fs.writeFileSync(legacyDb, "old");
    const targetRoot = path.join(tmp, "MSS-Data");
    const targetDb = path.join(targetRoot, "data", "shop.db");
    fs.mkdirSync(path.dirname(targetDb), { recursive: true });
    fs.writeFileSync(targetDb, "current");
    const result = migrateLegacyData({ root: targetRoot, appData });
    assert.strictEqual(result.migrated, false);
    assert.strictEqual(fs.readFileSync(targetDb, "utf8"), "current");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

check("MI-14", "production start resolves the pointer and migrates before first-run", () => {
  const main = read("electron/main.cjs");
  assert.ok(main.includes("resolveDataRoot("), "main must use the shared resolver");
  assert.ok(main.includes("migrateLegacyData("), "main must carry an existing DB forward");
  assert.ok(main.includes("!DEV_URL"), "migration must not touch dev roots");
  assert.ok(main.includes("MAHER_USER_DATA_DIR"), "explicit test roots must stay isolated");
  const startAt = main.indexOf("async function start()");
  const firstRunAt = main.indexOf('"first-run migration helper"', startAt);
  const migrateAt = main.indexOf("migrateLegacyData(", startAt);
  assert.ok(startAt >= 0 && firstRunAt > startAt && migrateAt > startAt && migrateAt < firstRunAt);
});

check("MI-15", "operator docs describe the wizard, D: data default and Update / Cancel", () => {
  const readme = read("README.md");
  const windows = read("PREPARE-WINDOWS.md");
  const shipped = read("packaging/README.txt");
  assert.ok(readme.includes("D:\\MSS-Data"), "README must name the data default");
  assert.ok(readme.includes("non-C drive"), "README must pin the no-C rule");
  assert.ok(readme.includes("Update / Cancel"), "README must pin the update prompt");
  assert.ok(windows.includes("D:\\MSS-Data"), "operator guide must name the data default");
  assert.ok(windows.includes("Update / Cancel"), "operator guide must name the update prompt");
  assert.ok(shipped.includes("D:\\MSS-Data"), "shipped guide must name the data default");
});

console.log(results.join("\n"));
console.log(`MSS installer contract: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
if (failed) process.exitCode = 1;
