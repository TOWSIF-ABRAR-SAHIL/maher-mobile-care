/* Electron AppData path resolver contract.
 *
 * Pure logic only: no server, no database engine, no network. The test only
 * changes environment variables around synchronous resolver calls, so it can
 * never open prisma/dev.db or any shop database.
 *
 * Why this exists: the portable build used a database inside the package
 * folder, which is lost when the EXE is reinstalled. Electron points production
 * at %AppData%\MAHER-MOBILE-CARE, but MAHER_DB_PATH must stay the top override
 * so the test runner and throwaway databases keep working.
 */
const assert = require("node:assert");
const path = require("node:path");

require("tsx/cjs");

const dbPath = require("../lib/db-path.ts");
const firstRun = require("./first-run.mjs");

const results = [];
const check = (id, name, fn) => {
  try {
    fn();
    results.push(`PASS [${id}] ${name}`);
  } catch (error) {
    results.push(`FAIL [${id}] ${name} — ${error?.message ?? error}`);
    process.exitCode = 1;
  }
};

const ENV_KEYS = [
  "MAHER_DB_PATH",
  "DATABASE_URL",
  "MAHER_BACKUP_DIR",
  "MAHER_USER_DATA_DIR",
];

function withEnv(overrides, fn) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const USER_ROOT = path.join(path.parse(process.cwd()).root, "maher-ud-test-root");
const EXPECTED_DB = path.join(USER_ROOT, "data", "shop.db");
const EXPECTED_BACKUPS = path.join(USER_ROOT, "data", "backups");

// --- app resolver (lib/db-path.ts) -----------------------------------------

check("UD-01", "MAHER_USER_DATA_DIR resolves the database under data/shop.db", () => {
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT }, () => {
    assert.strictEqual(dbPath.resolveDatabaseFile(), EXPECTED_DB);
  });
});

check("UD-02", "MAHER_USER_DATA_DIR resolves backups under data/backups", () => {
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT }, () => {
    assert.strictEqual(dbPath.resolveBackupDir(), EXPECTED_BACKUPS);
  });
});

check("UD-03", "MAHER_DB_PATH still beats MAHER_USER_DATA_DIR", () => {
  const explicit = path.join(USER_ROOT, "override", "throwaway.db");
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT, MAHER_DB_PATH: explicit }, () => {
    assert.strictEqual(dbPath.resolveDatabaseFile(), path.normalize(explicit));
  });
});

check("UD-04", "MAHER_BACKUP_DIR still beats MAHER_USER_DATA_DIR", () => {
  const explicit = path.join(USER_ROOT, "other-backups");
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT, MAHER_BACKUP_DIR: explicit }, () => {
    assert.strictEqual(dbPath.resolveBackupDir(), path.normalize(explicit));
  });
});

check("UD-05", "DATABASE_URL still works when no user-data root is set", () => {
  const configured = path.join(USER_ROOT, "cli", "configured.db");
  withEnv({ DATABASE_URL: `file:${configured}` }, () => {
    assert.strictEqual(dbPath.resolveDatabaseFile(), path.normalize(configured));
  });
});

// --- first-run resolver must match exactly ---------------------------------

check("UD-10", "first-run resolves the same database under MAHER_USER_DATA_DIR", () => {
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT }, () => {
    assert.strictEqual(firstRun.resolveDatabaseFile(USER_ROOT), EXPECTED_DB);
  });
});

check("UD-11", "first-run exposes the backup resolver for lockstep verification", () => {
  assert.strictEqual(typeof firstRun.resolveBackupDir, "function");
});

check("UD-12", "first-run resolves the same backups under MAHER_USER_DATA_DIR", () => {
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT }, () => {
    assert.strictEqual(firstRun.resolveBackupDir(USER_ROOT), EXPECTED_BACKUPS);
  });
});

check("UD-13", "first-run also keeps MAHER_DB_PATH as the top override", () => {
  const explicit = path.join(USER_ROOT, "override", "migration.db");
  withEnv({ MAHER_USER_DATA_DIR: USER_ROOT, MAHER_DB_PATH: explicit }, () => {
    assert.strictEqual(firstRun.resolveDatabaseFile(USER_ROOT), path.normalize(explicit));
  });
});

for (const line of results) console.log(line);
console.log(`UserData path resolver: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
