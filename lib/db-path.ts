import {
  accessSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/**
 * Single source of truth for the local database file.
 *
 * Order:
 *   1. A verified custom location from `maher-db-location.json`, when present.
 *   2. MAHER_DB_PATH — temporary test databases and explicit shop overrides.
 *   3. MAHER_USER_DATA_DIR — desktop root chosen by MSS-Setup (default
 *      D:\MSS-Data, never C:); unpacked dev launches still use %AppData%\MSS.
 *   4. DATABASE_URL — the Prisma CLI configuration in `.env`.
 *   5. ./prisma/dev.db — the historical default.
 *
 * The custom pointer is a *local file*, not a ShopSettings row: the row can only
 * be read after the database is open, which is exactly the chicken-and-egg this
 * resolver has to solve. It also survives a restore that replaces the DB file.
 * A poisoned/unavailable custom location falls back to the default path with a
 * reason, so a disconnected D: drive never takes the shop offline.
 */

const DB_LOCATION_FILENAME = "maher-db-location.json";
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");

export type DbLocationSource = "default" | "custom" | "fallback";

export interface DbLocationStatus {
  /** Path every API route and better-sqlite3 handle is actually using. */
  activePath: string;
  /** Path the launcher/env would use with no custom location. */
  defaultPath: string;
  /** Raw pointer read from the local config, if any. */
  configuredPath: string | null;
  configFile: string;
  source: DbLocationSource;
  fallbackReason: string | null;
}

function rawDatabaseLocation(): string {
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

function normalizeLocation(location: string, cwd = process.cwd()): string {
  let value = location.replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(value)) value = value.slice(5);
  value = value.trim();
  if (path.isAbsolute(value)) return path.normalize(value);
  return path.resolve(cwd, value);
}

/** The launcher/default path, ignoring any custom pointer. */
export function defaultDatabaseFile(): string {
  return normalizeLocation(rawDatabaseLocation());
}

/** The pointer always stays beside the ORIGINAL database, on the C: side. */
export function dbLocationConfigFile(): string {
  return path.join(path.dirname(defaultDatabaseFile()), DB_LOCATION_FILENAME);
}

function hasSqliteHeader(file: string): boolean {
  try {
    const fd = openSync(file, "r");
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    try {
      readSync(fd, header, 0, header.length, 0);
    } finally {
      closeSync(fd);
    }
    return header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  }
}

function readConfiguredPath(configFile: string): string | null {
  try {
    if (!existsSync(configFile)) return null;
    const parsed = JSON.parse(readFileSync(configFile, "utf8")) as {
      customDbPath?: unknown;
    };
    const raw = parsed?.customDbPath;
    if (typeof raw !== "string" || !raw.trim()) return null;
    return normalizeLocation(raw);
  } catch {
    return null;
  }
}

/**
 * A custom pointer is honoured only when the drive/folder is reachable AND the
 * target file is a real SQLite database. Anything else is a fallback, never a
 * blank new file (which would look like "all records vanished").
 */
function verifiedCustomFile(
  configured: string,
  defaultFile: string
): string | null {
  let value = configured.replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(value)) value = value.slice(5);
  value = value.trim();
  if (!path.isAbsolute(value)) return null;
  const looksLikeFile = /\.db$/i.test(value);
  const dir = path.normalize(
    looksLikeFile ? path.dirname(value) : value
  );
  const file = path.normalize(
    looksLikeFile ? value : path.join(dir, path.basename(defaultFile))
  );
  try {
    if (!statSync(dir).isDirectory()) return null;
    accessSync(dir, fsConstants.R_OK | fsConstants.W_OK);
    if (!statSync(file).isFile() || !hasSqliteHeader(file)) return null;
  } catch {
    return null;
  }
  return file;
}

let lastStatus: DbLocationStatus | null = null;

/** Last resolution result — read-only copy for /api/db-location and /api/health. */
export function dbLocationStatus(): DbLocationStatus {
  if (!lastStatus) resolveDatabaseFile();
  return { ...lastStatus! };
}

export function resolveDatabaseFile(): string {
  const defaultFile = defaultDatabaseFile();
  const configFile = dbLocationConfigFile();
  const configured = readConfiguredPath(configFile);
  let activePath = defaultFile;
  let source: DbLocationSource = "default";
  let fallbackReason: string | null = null;

  if (configured) {
    const verified = verifiedCustomFile(configured, defaultFile);
    if (verified) {
      activePath = verified;
      source = "custom";
    } else {
      source = "fallback";
      fallbackReason =
        "কাস্টম ডাটাবেজ লোকেশন পাওয়া যায়নি — আগের নিরাপদ লোকেশনে ফিরে এসেছি।";
    }
  }

  lastStatus = {
    activePath,
    defaultPath: defaultFile,
    configuredPath: configured,
    configFile,
    source,
    fallbackReason,
  };
  return activePath;
}

export function databaseUrl(): string {
  return `file:${resolveDatabaseFile()}`;
}

/**
 * Commit a verified target path. Atomic rename means the app can never read a
 * half-written pointer. The resolver re-evaluates on the next access, which is
 * what lets the live Prisma proxy reconnect without a server restart.
 */
export function writeDbLocationConfig(targetFile: string): DbLocationStatus {
  const configFile = dbLocationConfigFile();
  mkdirSync(path.dirname(configFile), { recursive: true });
  const temp = `${configFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(
    temp,
    JSON.stringify({ customDbPath: path.normalize(targetFile) }, null, 2),
    "utf8"
  );
  renameSync(temp, configFile);
  resolveDatabaseFile();
  return dbLocationStatus();
}

/**
 * Single source of truth for the snapshot directory.
 *
 * MAHER_BACKUP_DIR lets the automated test harness use a throwaway folder so
 * live shop snapshots are never pruned by test backup calls. In Electron, the
 * same root as MAHER_USER_DATA_DIR keeps snapshots beside the AppData database.
 */
export function resolveBackupDir(): string {
  const configured = process.env.MAHER_BACKUP_DIR?.trim();
  if (configured) {
    if (path.isAbsolute(configured)) return path.normalize(configured);
    return path.resolve(process.cwd(), configured);
  }
  const userDataRoot = process.env.MAHER_USER_DATA_DIR?.trim();
  if (userDataRoot) {
    return path.join(path.resolve(userDataRoot), "data", "backups");
  }
  return path.join(process.cwd(), "backups");
}
