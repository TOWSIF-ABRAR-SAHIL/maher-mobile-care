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

// Copied from lib/db-path.ts so the portable package (which does not run the
// TypeScript source) resolves the database file exactly like the app does.
function rawDatabaseLocation() {
  const direct = process.env.MAHER_DB_PATH?.trim();
  if (direct) return direct;
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  return "file:./prisma/dev.db";
}

export function resolveDatabaseFile(cwd = process.cwd()) {
  let location = rawDatabaseLocation().replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(location)) location = location.slice(5);
  location = location.trim();
  if (path.isAbsolute(location)) return path.normalize(location);
  return path.resolve(cwd, location);
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
      log(`database already up to date (${applied.size} migration(s) applied)`);
      return [];
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

    return done;
  } finally {
    db.close();
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