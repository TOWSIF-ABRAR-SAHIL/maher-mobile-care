import path from "node:path";

/**
 * Single source of truth for the local database file.
 *
 * Order:
 *   1. MAHER_DB_PATH — temporary test databases and explicit shop overrides.
 *   2. DATABASE_URL — the Prisma CLI configuration in `.env`.
 *   3. ./prisma/dev.db — the historical default.
 *
 * Runtime and tooling must both use this helper; otherwise the app and
 * migrations/scripts can silently point at different databases.
 */
function rawDatabaseLocation(): string {
  const direct = process.env.MAHER_DB_PATH?.trim();
  if (direct) return direct;
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) return configured;
  return "file:./prisma/dev.db";
}

export function resolveDatabaseFile(): string {
  let location = rawDatabaseLocation().replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(location)) location = location.slice(5);
  location = location.trim();
  if (path.isAbsolute(location)) return path.normalize(location);
  return path.resolve(process.cwd(), location);
}

export function databaseUrl(): string {
  return `file:${resolveDatabaseFile()}`;
}

/**
 * Single source of truth for the snapshot directory.
 *
 * MAHER_BACKUP_DIR lets the automated test harness use a throwaway folder so
 * live shop snapshots are never pruned by test backup calls.
 */
export function resolveBackupDir(): string {
  const configured = process.env.MAHER_BACKUP_DIR?.trim();
  if (!configured) return path.join(process.cwd(), "backups");
  if (path.isAbsolute(configured)) return path.normalize(configured);
  return path.resolve(process.cwd(), configured);
}
