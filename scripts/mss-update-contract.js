/* MSS in-place update contract.
 *
 * Pins the promise made to a client who already has MSS installed: running a
 * newer MSS-Setup is an UPDATE, never a fresh install. The NSIS upgrade keeps
 * AppData, the data root is stable, first-run applies only pending migrations
 * to the existing database, and every update takes a safety snapshot first.
 *
 * Static checks are pure source/config reads. The runtime probe uses a private
 * throwaway directory and a fake future migration; it never touches dev.db or
 * the real shop database.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

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
const checkAsync = async (id, name, fn) => {
  try {
    await fn();
    record(true, id, name);
  } catch (error) {
    record(false, id, name, error?.message ?? String(error));
  }
};

const config = JSON.parse(read("packaging/electron-builder.json"));

check("UC-01", "NSIS schema pins AppData retention for updates and uninstalls", () => {
  // electron-builder 26 has no `deleteAppDataOnUpdate` option: an update never
  // touches AppData by design. The only relevant switch is the uninstall flag;
  // pinning it false also protects shop.db if a client ever removes the app.
  assert.strictEqual(
    config.nsis.deleteAppDataOnUninstall,
    false,
    "deleteAppDataOnUninstall must be pinned false so shop.db survives uninstall"
  );
  assert.ok(
    !Object.prototype.hasOwnProperty.call(config.nsis, "deleteAppDataOnUpdate"),
    "deleteAppDataOnUpdate is not in the electron-builder 26 schema"
  );
});

check("UC-02", "installer identity and versioned filename stay stable across updates", () => {
  // Keep the original appId: changing it makes an existing install look new and
  // suppresses the Update / Cancel prompt. It is a private wire identity only.
  assert.strictEqual(config.appId, "com.maher.mobilecare.desktop");
  assert.strictEqual(config.productName, "MSS");
  assert.strictEqual(config.artifactName, "MSS-Setup-${version}.${ext}");
  assert.strictEqual(config.nsis.oneClick, false);
  assert.strictEqual(config.nsis.perMachine, false);
  assert.strictEqual(config.nsis.allowToChangeInstallationDirectory, true);
  assert.strictEqual(config.nsis.include, "packaging/mss-installer.nsh");
});

check("UC-03", "production upgrades keep the installer-chosen non-C data root", () => {
  const main = read("electron/main.cjs");
  assert.ok(main.includes("resolveDataRoot("), "main must read the installer data pointer");
  assert.ok(main.includes("migrateLegacyData("), "an old AppData DB must be carried forward");
  assert.ok(!main.includes("autoUpdater"), "the offline app must not phone home for updates");
  const firstRun = read("scripts/first-run.mjs");
  assert.ok(firstRun.includes('path.join(path.resolve(userDataRoot), "data", "shop.db")'));
});

check("UC-04", "shipped docs explain that reinstalling a newer installer is an update", () => {
  const readme = read("README.md");
  const windows = read("PREPARE-WINDOWS.md");
  assert.ok(readme.includes("In-place updates."), "README must pin the update promise");
  assert.ok(
    readme.includes("deleteAppDataOnUninstall"),
    "README must name the schema-valid NSIS flag that protects shop data"
  );
  assert.ok(readme.includes("Update / Cancel"), "README must pin the new update prompt");
  assert.ok(windows.includes("## Update by installer"), "operator guide needs an installer-update section");
  assert.ok(windows.includes("shop.db"), "operator guide must name the preserved database");
  assert.ok(windows.includes("D:\\MSS-Data"), "operator guide must name the non-C data default");
});

check("UC-05", "first-run applies only pending migrations and snapshots before changing a DB", () => {
  const src = read("scripts/first-run.mjs");
  assert.ok(src.includes(".filter((name) => !applied.has(name))"));
  assert.ok(src.includes("VACUUM INTO"));
  assert.ok(src.includes("database already up to date"));
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mss-update-"));
  const migrations = path.join(tmp, "prisma", "migrations");
  fs.mkdirSync(migrations, { recursive: true });
  const realMigrations = path.join(ROOT, "prisma", "migrations");
  for (const name of fs.readdirSync(realMigrations)) {
    const sql = path.join(realMigrations, name, "migration.sql");
    if (!fs.existsSync(sql)) continue;
    fs.mkdirSync(path.join(migrations, name), { recursive: true });
    fs.copyFileSync(sql, path.join(migrations, name, "migration.sql"));
  }

  const dbFile = path.join(tmp, "data", "shop.db");
  const backupDir = path.join(tmp, "data", "backups");
  const previousBackupDir = process.env.MAHER_BACKUP_DIR;
  process.env.MAHER_BACKUP_DIR = backupDir;
  let db;

  try {
    const { applyMigrations } = await import(
      pathToFileURL(path.join(ROOT, "scripts", "first-run.mjs")).href
    );

    // v1: a normal install with the migrations shipped today.
    applyMigrations({ cwd: tmp, dbFile });
    db = new Database(dbFile);
    db.prepare(
      "INSERT INTO Technician (name, isActive, createdAt) VALUES (?, 1, ?)"
    ).run("UPDATE PROBE", "2026-01-01T00:00:00.000Z");
    db.close();
    db = null;

    // v2: a future release adds one migration and reinstalls over the same DB.
    const probeName = "29990101000000_update_contract_probe";
    fs.mkdirSync(path.join(migrations, probeName), { recursive: true });
    fs.writeFileSync(
      path.join(migrations, probeName, "migration.sql"),
      'ALTER TABLE "Service" ADD COLUMN "updateProbe" TEXT;\n'
    );

    let applied = [];
    await checkAsync("UC-06", "a newer build migrates the existing database in place", async () => {
      applied = applyMigrations({ cwd: tmp, dbFile });
      assert.deepStrictEqual(applied, [probeName]);
    });

    await checkAsync("UC-07", "shop rows survive the update and the new column is live", async () => {
      db = new Database(dbFile);
      const tech = db
        .prepare("SELECT name FROM Technician WHERE name = ?")
        .get("UPDATE PROBE");
      const columns = db.prepare("PRAGMA table_info(Service)").all().map((row) => row.name);
      assert.strictEqual(tech?.name, "UPDATE PROBE");
      assert.ok(columns.includes("updateProbe"));
      db.close();
      db = null;
    });

    await checkAsync("UC-08", "the update takes a safety snapshot before migrating", async () => {
      const snapshots = fs.existsSync(backupDir)
        ? fs.readdirSync(backupDir).filter((name) => name.startsWith("safety-") && name.endsWith(".db"))
        : [];
      assert.ok(snapshots.length >= 1, "no safety-*.db was created");
    });

    await checkAsync("UC-09", "running the same build again is an idempotent no-op", async () => {
      const again = applyMigrations({ cwd: tmp, dbFile });
      assert.deepStrictEqual(again, []);
      db = new Database(dbFile);
      const tech = db.prepare("SELECT name FROM Technician WHERE name = ?").get("UPDATE PROBE");
      assert.strictEqual(tech?.name, "UPDATE PROBE");
      db.close();
      db = null;
    });
  } finally {
    if (db) db.close();
    if (previousBackupDir === undefined) delete process.env.MAHER_BACKUP_DIR;
    else process.env.MAHER_BACKUP_DIR = previousBackupDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(results.join("\n"));
  console.log(`MSS update contract: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error("MSS UPDATE CONTRACT CRASH:", error.stack || error);
  process.exitCode = 1;
});
