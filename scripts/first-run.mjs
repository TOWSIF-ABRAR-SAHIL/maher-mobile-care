/**
 * Portable first-run database initialiser.
 *
 * Why this exists instead of `prisma migrate deploy`:
 *
 * The Prisma CLI needs a platform-specific `schema-engine` binary. The Windows
 * package ships without it (the client must not install a compiler, and
 * `prisma` is a devDependency that is not in `.next/standalone`). Prisma 7 uses
 * a driver adapter for every query, so the runtime itself never needs an engine
 * binary — only migrations do.
 *
 * So this script applies the committed migration SQL files from
 * `prisma/migrations/` with better-sqlite3, which IS bundled, and records each
 * one in `_prisma_migrations` using Prisma's exact bookkeeping format. The
 * checksum is sha256 of the SQL file, matching Prisma, so if the Prisma CLI is
 * ever run against the same database it treats these migrations as already
 * applied instead of re-running them.
 *
 * It is idempotent: running it again applies nothing.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Lockstep copy of lib/db-path.ts so the portable package (which does not run
// the TypeScript source) resolves the database file exactly like the app does.
// Keep both resolvers in sync: a divergence would migrate one DB while the app
// reads another. This includes the verified custom-location pointer, otherwise
// first-run would apply migrations to the old C: database after a D: move.
const DB_LOCATION_FILENAME = "maher-db-location.json";
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");

function rawDatabaseLocation() {
  const direct = process.env.MAHER_DB_PATH?.trim();
  if (direct) return direct;
  const userDataRoot = process.env.MAHER_USER_DATA_DIR?.trim();
  if (userDataRoot) {
    return path.join(path.resolve(userDataRoot), "data", "shop.db");
  }
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  return "file:./prisma/dev.db";
}

function normalizeLocation(location, cwd) {
  let value = location.replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(value)) value = value.slice(5);
  value = value.trim();
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(cwd, value);
}

function hasSqliteHeader(file) {
  try {
    const fd = fs.openSync(file, "r");
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    try {
      fs.readSync(fd, header, 0, header.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    return header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  }
}

function verifiedCustomFile(configured, defaultFile) {
  let value = configured.replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(value)) value = value.slice(5);
  value = value.trim();
  if (!path.isAbsolute(value)) return null;
  const looksLikeFile = /\.db$/i.test(value);
  const dir = path.normalize(looksLikeFile ? path.dirname(value) : value);
  const file = path.normalize(
    looksLikeFile ? value : path.join(dir, path.basename(defaultFile))
  );
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.statSync(file).isFile() || !hasSqliteHeader(file)) return null;
  } catch {
    return null;
  }
  return file;
}

export function resolveDatabaseFile(cwd = process.cwd()) {
  const defaultFile = normalizeLocation(rawDatabaseLocation(), cwd);
  const configFile = path.join(path.dirname(defaultFile), DB_LOCATION_FILENAME);
  try {
    if (fs.existsSync(configFile)) {
      const parsed = JSON.parse(fs.readFileSync(configFile, "utf8"));
      const raw = parsed?.customDbPath;
      if (typeof raw === "string" && raw.trim()) {
        const verified = verifiedCustomFile(normalizeLocation(raw, cwd), defaultFile);
        if (verified) return verified;
      }
    }
  } catch {
    // A damaged pointer must never stop first-run; the default DB is the fallback.
  }
  return defaultFile;
}

/** Mirrors lib/db-path.ts so the portable launcher finds the same folder. */
export function resolveBackupDir(cwd = process.cwd()) {
  const configured = process.env.MAHER_BACKUP_DIR?.trim();
  if (configured) {
    if (path.isAbsolute(configured)) return path.normalize(configured);
    return path.resolve(cwd, configured);
  }
  const userDataRoot = process.env.MAHER_USER_DATA_DIR?.trim();
  if (userDataRoot) {
    return path.join(path.resolve(userDataRoot), "data", "backups");
  }
  return path.join(cwd, "backups");
}

const pad2 = (n) => String(n).padStart(2, "0");

/** `safety-YYYYMMDD-HHMMSS-mmm.db`, compatible with the restore name check. */
function fileStamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-` +
    `${String(d.getMilliseconds()).padStart(3, "0")}`
  );
}

/** Prisma's own migration ledger, copied verbatim so the CLI stays compatible. */
const LEDGER_DDL = `CREATE TABLE "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

function findMigrationsDir(cwd) {
  const candidates = [
    process.env.MAHER_MIGRATIONS_DIR?.trim(),
    // Repo layout (development and the test harness).
    path.join(cwd, "prisma", "migrations"),
    path.join(cwd, "..", "prisma", "migrations"),
    // Portable layout: the launcher runs from the MAHER root while the
    // migrations ship inside the app folder.
    path.join(cwd, "app", "prisma", "migrations"),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return path.resolve(dir);
  }
  throw new Error(
    `Could not find prisma/migrations. Looked in:\n  ${candidates.join("\n  ")}\n` +
      `Set MAHER_MIGRATIONS_DIR to point at it.`
  );
}

/**
 * Applies any migration whose name is not yet in the ledger.
 * Returns the names it applied, in order.
 */
export function applyMigrations({ cwd = process.cwd(), dbFile, log = () => {} } = {}) {
  const databaseFile = dbFile ?? resolveDatabaseFile(cwd);
  const migrationsDir = findMigrationsDir(cwd);

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });

  const Database = require("better-sqlite3");
  const db = new Database(databaseFile);

  try {
    // WAL keeps the app responsive if two windows open the shop at once, and
    // survives a power cut mid-write better than the default rollback journal.
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const hasLedger = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get("_prisma_migrations");

    if (!hasLedger) {
      db.exec(LEDGER_DDL);
      log("created _prisma_migrations ledger");
    }

    const applied = new Set(
      db
        .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
        .all()
        .map((row) => row.migration_name)
    );

    const pending = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(migrationsDir, name, "migration.sql")))
      .sort() // lexicographic == chronological for Prisma's timestamped names
      .filter((name) => !applied.has(name));

    if (pending.length === 0) {
      // Verified before returning: an up-to-date ledger is the normal case, and
      // also the one where a table can be missing without it looking wrong.
      verifySchema(db, path.basename(dbFile));
      normalizeExpenseRows(db, log);
      reconcileStockLedger(db, log);
      log(`database already up to date (${applied.size} migration(s) applied)`);
      return [];
    }

    // A shipped migration can add columns/backfill money-adjacent data. Take a
    // safety snapshot FIRST (never pruned) so the shop can always go back.
    const hasService = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Service'")
      .get();
    if (hasService) {
      const backupDir = resolveBackupDir(cwd);
      fs.mkdirSync(backupDir, { recursive: true });
      const safety = path.join(backupDir, `safety-${fileStamp()}.db`);
      db.exec(`VACUUM INTO '${safety.replace(/\\/g, "/").replace(/'/g, "''")}'`);
      log(`safety backup: ${safety}`);
    }

    const record = db.prepare(
      `INSERT INTO _prisma_migrations
         (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`
    );

    const done = [];
    for (const name of pending) {
      const sqlFile = path.join(migrationsDir, name, "migration.sql");
      const sql = fs.readFileSync(sqlFile);
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      const startedAt = Date.now();

      // One transaction per migration, matching Prisma's behaviour: a failure
      // rolls back that migration only and leaves the ledger consistent.
      const run = db.transaction(() => {
        db.exec(sql.toString("utf8"));
        record.run(crypto.randomUUID(), checksum, startedAt, name, startedAt);
      });

      try {
        run();
      } catch (error) {
        throw new Error(
          `Migration "${name}" failed, database left unchanged:\n  ${error?.message ?? error}`
        );
      }

      log(`applied migration ${name}`);
      done.push(name);
    }

    verifySchema(db, path.basename(dbFile));
    normalizeExpenseRows(db, log);
    reconcileStockLedger(db, log);

    return done;
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------------ */
/* Expense-code upgrade (v1.1.3)                                       */
/* ------------------------------------------------------------------ */

const MAX_SHOP_EXPENSE = 999_999_999;
const BN_DIGITS = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};
const CODE_DIGITS = {
  "*": "1", "+": "0", "#": "00",
  A: "2", B: "2", C: "2",
  D: "3", E: "3", F: "3",
  G: "4", H: "4", I: "4",
  J: "5", K: "5", L: "5",
  M: "6", N: "6", O: "6",
  P: "7", Q: "7", R: "7", S: "7",
  T: "8", U: "8", V: "8",
  W: "9", X: "9", Y: "9", Z: "9",
};
const ENCODE_DIGITS = {
  "0": "+", "1": "*", "2": "A", "3": "D", "4": "G",
  "5": "J", "6": "M", "7": "P", "8": "T", "9": "W",
};

function encodeShopExpenseAmount(amount) {
  const digits = String(amount);
  let code = "";
  for (let i = digits.length - 1; i >= 0; ) {
    if (i >= 1 && digits[i] === "0" && digits[i - 1] === "0") {
      code = "#" + code;
      i -= 2;
    } else {
      code = ENCODE_DIGITS[digits[i]] + code;
      i -= 1;
    }
  }
  return code;
}

function normalizeExpenseInput(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return { kind: "empty", stored: null, amount: 0 };

  const numericText = input
    .split("")
    .map((ch) => BN_DIGITS[ch] ?? ch)
    .join("")
    .replace(/[,\s৳]/g, "");
  if (/^\d+$/.test(numericText)) {
    const amount = Number(numericText);
    if (!Number.isSafeInteger(amount) || amount > MAX_SHOP_EXPENSE) {
      return { kind: "invalid", stored: null, amount: null };
    }
    return {
      kind: "number",
      stored: encodeShopExpenseAmount(amount),
      amount,
    };
  }

  const compact = input
    .split("")
    .map((ch) => BN_DIGITS[ch] ?? ch)
    .join("")
    .replace(/[,\s৳]/g, "");
  if (!/^[0-9*+#A-Za-z]+$/.test(compact)) {
    return { kind: "invalid", stored: null, amount: null };
  }
  let digits = "";
  for (const ch of compact) {
    const upper = ch.toUpperCase();
    digits += CODE_DIGITS[upper] ?? ch;
  }
  const amount = parseInt(digits, 10);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(amount) || amount > MAX_SHOP_EXPENSE) {
    return { kind: "invalid", stored: null, amount: null };
  }
  return { kind: "code", stored: input, amount };
}

/**
 * Converts pre-v1.1.3 numeric shopExpense rows into canonical codes and
 * repairs expenseAmount for valid codes. Runs on every start; a no-op when all
 * rows are already canonical. Exported so the portable first-run test can
 * exercise it against a throwaway database.
 */
export function normalizeExpenseRows(db, log = () => {}) {
  const rows = db
    .prepare("SELECT id, shopExpense, expenseAmount FROM Service")
    .all();
  const update = db.prepare(
    "UPDATE Service SET shopExpense = ?, expenseAmount = ? WHERE id = ?"
  );
  const run = db.transaction(() => {
    let changed = 0;
    let invalid = 0;
    for (const row of rows) {
      let normalized = normalizeExpenseInput(row.shopExpense);
      if (normalized.kind === "invalid") {
        invalid += 1;
        continue;
      }
      // An empty raw value with a non-zero decoded amount is a ledger value
      // without its display code. Re-create the code instead of wiping money
      // out of the profit calculation. Negative / oversized amounts are left
      // for the audit rather than silently zeroed.
      if (normalized.kind === "empty") {
        if (
          !Number.isSafeInteger(row.expenseAmount) ||
          row.expenseAmount < 0 ||
          row.expenseAmount > MAX_SHOP_EXPENSE
        ) {
          invalid += 1;
          continue;
        }
        if (row.expenseAmount > 0) {
          normalized = {
            kind: "number",
            stored: encodeShopExpenseAmount(row.expenseAmount),
            amount: row.expenseAmount,
          };
        }
      }
      if (
        normalized.stored !== (row.shopExpense ?? null) ||
        normalized.amount !== row.expenseAmount
      ) {
        update.run(normalized.stored, normalized.amount, row.id);
        changed += 1;
      }
    }
    return { changed, invalid };
  });
  const result = run();
  if (result.changed > 0) {
    log(`normalized ${result.changed} expense row(s) to keypad codes`);
  }
  if (result.invalid > 0) {
    log(`warning: ${result.invalid} expense row(s) have an invalid code and were left unchanged`);
  }
  return result;
}

/**
 * Reconciles the append-only stock ledger with each product's on-hand count.
 * A product whose movements do not sum to `stock` (legacy row, manual edit)
 * gets one ADJUSTMENT row so every later sale still explains itself. The
 * operation is idempotent: a reconciled product produces no row.
 */
export function reconcileStockLedger(db, log = () => {}) {
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  if (!tables.has("Product") || !tables.has("StockMovement")) {
    return { changed: 0 };
  }
  const result = db
    .prepare(
      `INSERT INTO "StockMovement"
         ("productId", "movementType", "quantity", "previousStock", "newStock", "reason")
       SELECT
         p."id",
         'ADJUSTMENT',
         p."stock" - COALESCE(SUM(m."quantity"), 0),
         COALESCE(SUM(m."quantity"), 0),
         p."stock",
         'স্টক লেজার মিলন'
       FROM "Product" p
       LEFT JOIN "StockMovement" m ON m."productId" = p."id"
       GROUP BY p."id", p."stock"
       HAVING p."stock" <> COALESCE(SUM(m."quantity"), 0)`
    )
    .run();
  if (result.changes > 0) {
    log(`reconciled ${result.changes} product stock row(s) with the ledger`);
  }
  return { changed: result.changes };
}

/**
 * Confirms the tables the app needs actually exist.
 *
 * The migration ledger is a record of what was run, not proof of what is there.
 * A database copied incompletely, interrupted while being written, or restored
 * from a partial file can list a migration as finished while the table it was
 * meant to create is absent. Trusting the ledger then reports "ready" and the
 * app opens to an empty shop, every list failing with an error the shopkeeper
 * cannot read.
 *
 * Failing loudly here turns that into one clear instruction. The database is
 * never repaired automatically: the migrations use plain CREATE TABLE, so
 * replaying them over a damaged file is not safe, and silently rebuilding a
 * shop's records is exactly the wrong thing to do without asking.
 */
function verifySchema(db, label) {
  const required = [
    "Service",
    "Technician",
    "ProductCategory",
    "Product",
    "SaleItem",
    "StockMovement",
  ];
  const present = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  const missing = required.filter((table) => !present.has(table));

  if (missing.length > 0) {
    throw new Error(
      `${label} is damaged: the table(s) ${missing.join(", ")} are missing even though ` +
        `the migration history says they were created.\n` +
        `  Nothing has been changed, and your backups in data\\backups are untouched.\n` +
        `  To start clean: close MAHER, delete ${label} from the data folder, and open MAHER again.\n` +
        `  To keep an older copy instead: rename ${label} to ${label}.old and open MAHER again.`
    );
  }
}

function main() {
  const dbFile = resolveDatabaseFile();
  const label = path.basename(dbFile);
  console.log(`MAHER first-run: preparing database (${dbFile})`);

  const applied = applyMigrations({ dbFile, log: (m) => console.log(`  ${m}`) });

  console.log(
    applied.length === 0
      ? `MAHER first-run: nothing to do, ${label} is ready.`
      : `MAHER first-run: ${label} ready (${applied.length} migration(s) applied).`
  );
}

// Only run when invoked directly, so the test suite can import applyMigrations.
// fileURLToPath (not import.meta.url) so Windows drive paths resolve correctly.
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`\nMAHER first-run FAILED:\n${error?.message ?? error}`);
    process.exit(1);
  }
}