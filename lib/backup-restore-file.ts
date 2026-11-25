/**
 * Shared upload handling for the backup restore/inspect routes.
 *
 * The uploaded file is ALWAYS materialised as a uniquely named temporary SQLite
 * file, validated read-only, and removed (including its WAL/SHM sidecars) when
 * the request finishes. The live database pointer in `maher-db-location.json`
 * is never read or written here — a restore must not break custom drive
 * routing.
 */
import {
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { resolveBackupDir } from "@/lib/db-path";

export const CORRUPTED_BACKUP_ERROR =
  "ব্যাকআপ ফাইলটি নষ্ট বা ক্ষতিগ্রস্ত (Corrupted SQLite file)";

// Accept .db, .sqlite, .sql and .maherbackup uploads.
export const UPLOAD_NAME_RE = /\.(db|sqlite|sql|maherbackup)$/i;

/** Public model name → physical table in this schema (aliases documented). */
export const BACKUP_MODELS = [
  { name: "Service", table: "Service" },
  { name: "Product", table: "Product" },
  { name: "CustomerPayment", table: "Payment" },
  { name: "SupplierExpense", table: "Purchase" },
  { name: "Technician", table: "Technician" },
  // AuditLog is reserved: the audit trail is the raw Service export.
  { name: "AuditLog", table: null },
] as const;

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

function hasSqliteMagic(bytes: Buffer): boolean {
  return (
    bytes.length >= SQLITE_MAGIC.length &&
    bytes.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
  );
}

/**
 * A `.sql` / `.maherbackup` upload may be a plain SQLite dump. It is accepted
 * only when it clearly creates the Service table and contains no statement
 * that could reach outside the temporary import database.
 */
function looksLikeSqlDump(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  const text = bytes.toString("utf8");
  if (!/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'[`]?Service\b/i.test(text)) {
    return false;
  }
  if (/\b(ATTACH|DETACH|VACUUM|LOAD_EXTENSION)\b/i.test(text)) return false;
  const pragmas = text.match(/\bPRAGMA\b[^;]*;/gi) ?? [];
  return !pragmas.some(
    (p) => !/^PRAGMA\s+foreign_keys\s*=\s*(OFF|ON)\s*;?$/i.test(p.trim())
  );
}

/** Allocate a fresh `temp-restore-${Date.now()}.db` inside the backup dir. */
export function allocateRestoreTempFile(): string {
  const dir = resolveBackupDir();
  mkdirSync(dir, { recursive: true });
  const base = `temp-restore-${Date.now()}`;
  let abs = join(dir, `${base}.db`);
  let suffix = 1;
  while (existsSync(abs)) {
    abs = join(dir, `${base}-${suffix}.db`);
    suffix += 1;
  }
  return abs;
}

/**
 * Write the upload to the temporary SQLite file. SQL dumps are executed into a
 * fresh database; binary snapshots are copied byte-for-byte.
 */
export function materializeUpload(
  bytes: Buffer,
  name: string,
  destination: string
): boolean {
  if (!UPLOAD_NAME_RE.test(name)) return false;
  if (hasSqliteMagic(bytes)) {
    writeFileSync(destination, bytes);
    return true;
  }
  if (!looksLikeSqlDump(bytes)) return false;
  try {
    if (existsSync(destination)) unlinkSync(destination);
    const db = new Database(destination);
    try {
      db.exec(bytes.toString("utf8"));
    } finally {
      db.close();
    }
    return true;
  } catch {
    cleanupRestoreTemp(destination);
    return false;
  }
}

/** Remove the temp DB and any stale -wal/-shm sidecars it left behind. */
export function cleanupRestoreTemp(abs: string): void {
  for (const file of [abs, `${abs}-wal`, `${abs}-shm`]) {
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      /* best effort — never fail a restore over temp cleanup */
    }
  }
}

export interface BackupInspection {
  ok: boolean;
  error?: string;
  quickCheck: string;
  tables: string[];
  counts: Record<string, number>;
  essential: Record<string, boolean>;
  missingEssential: string[];
  servicesCount: number;
  productsCount: number;
}

/**
 * Read-only safety inspection. `PRAGMA quick_check` is the first gate: a file
 * that merely carries the SQLite magic but has damaged pages is rejected with
 * the exact shop-facing corruption message before any swap is attempted.
 *
 * Missing `Product` / `CustomerPayment` / `Technician` tables are reported as
 * metadata, not as a hard failure: snapshots older than the inventory/payment
 * migrations must still restore.
 */
export function inspectBackupFile(abs: string): BackupInspection {
  let db: InstanceType<typeof Database> | null = null;
  try {
    db = new Database(abs, { readonly: true, fileMustExist: true });
    const raw = db.pragma("quick_check", { simple: true }) as unknown;
    const first = Array.isArray(raw) ? raw[0] : raw;
    const quickCheck =
      first && typeof first === "object" && "quick_check" in first
        ? String((first as { quick_check: unknown }).quick_check)
        : String(first ?? "");
    if (quickCheck.trim().toLowerCase() !== "ok") {
      return {
        ok: false,
        error: CORRUPTED_BACKUP_ERROR,
        quickCheck,
        tables: [],
        counts: {},
        essential: {},
        missingEssential: [],
        servicesCount: 0,
        productsCount: 0,
      };
    }

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    const tableSet = new Set(tables);
    const counts: Record<string, number> = {};
    for (const model of BACKUP_MODELS) {
      const table = model.table;
      if (!table || !tableSet.has(table)) continue;
      const row = db
        .prepare(`SELECT COUNT(*) AS n FROM "${table}"`)
        .get() as { n: number };
      counts[model.name] = Number(row.n);
    }
    const required = ["Service", "Product", "CustomerPayment", "Technician"];
    const essential: Record<string, boolean> = {};
    for (const label of required) {
      const physical = BACKUP_MODELS.find((m) => m.name === label)?.table;
      essential[label] = !!physical && tableSet.has(physical);
    }
    const missingEssential = required.filter((label) => !essential[label]);
    return {
      ok: true,
      quickCheck,
      tables,
      counts,
      essential,
      missingEssential,
      servicesCount: counts.Service ?? 0,
      productsCount: counts.Product ?? 0,
    };
  } catch {
    return {
      ok: false,
      error: CORRUPTED_BACKUP_ERROR,
      quickCheck: "error",
      tables: [],
      counts: {},
      essential: {},
      missingEssential: [],
      servicesCount: 0,
      productsCount: 0,
    };
  } finally {
    try {
      db?.close();
    } catch {
      /* read-only handle — nothing to flush */
    }
  }
}
