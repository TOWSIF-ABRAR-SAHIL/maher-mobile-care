import { NextRequest, NextResponse } from "next/server";
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import {
  dbLocationStatus,
  defaultDatabaseFile,
  resolveDatabaseFile,
  writeDbLocationConfig,
} from "@/lib/db-path";

export const dynamic = "force-dynamic";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");

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

function failure(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * SQLite in WAL mode creates `-wal`/`-shm` sidecars when a copy is opened for
 * verification. They are never part of the final database, so remove every
 * temporary artefact once the main file has been renamed into place.
 */
function removeTempArtifacts(file: string) {
  if (!file) return;
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    try {
      const candidate = `${file}${suffix}`;
      if (existsSync(candidate)) unlinkSync(candidate);
    } catch {
      /* best-effort cleanup */
    }
  }
}

/** Prisma returns SQLite integers as BigInt; JSON.stringify cannot serialize them. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonSafe(item)])
    );
  }
  return value;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
    d.getHours()
  )}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(
    d.getMilliseconds()
  ).padStart(3, "0")}`;
}

function inspected(file: string) {
  const db = new Database(file, { readonly: true });
  try {
    const quickCheck = String(db.pragma("quick_check", { simple: true })).trim();
    const tables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((row) => row.name)
    );
    const count = (table: string) =>
      Number(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as {
            n: number;
          }
        ).n
      );
    return {
      quickCheck,
      serviceRows: tables.has("Service") ? count("Service") : null,
      productRows: tables.has("Product") ? count("Product") : null,
      hasTechnician: tables.has("Technician"),
      bytes: statSync(file).size,
    };
  } finally {
    db.close();
  }
}

/**
 * The dashboard may send either a folder (`D:\MAHER_DATA`) or a complete file
 * path (`D:\MAHER_DATA\shop.db`). Both resolve to exactly one destination file;
 * the active database filename is appended when only a folder was supplied.
 */
function splitTarget(raw: string, sourceFile: string) {
  let value = raw.replace(/^["']+|["']+$/g, "");
  if (/^file:/i.test(value)) value = value.slice(5);
  value = value.trim();
  if (!path.isAbsolute(value)) return null;
  value = path.normalize(value);
  const isFile = /\.db$/i.test(value);
  return {
    dir: isFile ? path.dirname(value) : value,
    file: isFile ? path.basename(value) : path.basename(sourceFile),
  };
}

/**
 * Move the active SQLite file to another drive without ever losing the old one.
 *
 * Order is deliberate: create/validate the destination, prove it is writable,
 * checkpoint WAL TRUNCATE (so the main file is complete), copy to a temp file in
 * the target folder, verify that temp in place, atomic rename to the final name,
 * and only then write the pointer config. The original file is intentionally
 * never deleted — it remains the emergency fallback.
 */
export async function POST(req: NextRequest) {
  let targetDir = "";
  let tempFile = "";
  let markerFile = "";
  try {
    const body = (await req.json().catch(() => ({}))) as {
      targetPath?: unknown;
    };
    const raw = body?.targetPath;
    if (typeof raw !== "string" || !raw.trim()) {
      return failure("নতুন ডাটাবেজ লোকেশনের পথ দিন।");
    }

    const sourceFile = resolveDatabaseFile();
    if (!existsSync(sourceFile) || !hasSqliteHeader(sourceFile)) {
      return failure("বর্তমান ডাটাবেজ ফাইল পাওয়া যায়নি।", 500);
    }
    const target = splitTarget(raw, sourceFile);
    if (!target) {
      return failure("সম্পূর্ণ পথ দিন (উদাহরণ: D:\\Maher_Data)।");
    }
    targetDir = target.dir;

    // A chosen drive may not have the folder yet — create the whole chain,
    // then prove the folder is really usable before any bytes are copied.
    try {
      mkdirSync(targetDir, { recursive: true });
      if (!statSync(targetDir).isDirectory()) {
        return failure("নির্বাচিত পথটি ফোল্ডার নয়।");
      }
      accessSync(targetDir, fsConstants.R_OK | fsConstants.W_OK);
    } catch {
      return failure("নির্বাচিত ফোল্ডার তৈরি করা যায়নি বা লেখার অনুমতি নেই।");
    }

    markerFile = path.join(
      targetDir,
      `.maher-write-test-${process.pid}-${Date.now()}`
    );
    try {
      writeFileSync(markerFile, "");
    } catch {
      return failure("নির্বাচিত ফোল্ডারে লেখার অনুমতি নেই।");
    } finally {
      try {
        if (existsSync(markerFile)) unlinkSync(markerFile);
      } catch {
        /* best-effort marker cleanup */
      }
      markerFile = "";
    }

    const targetFile = path.join(targetDir, target.file);
    if (path.normalize(targetDir) === path.normalize(path.dirname(sourceFile))) {
      return failure("ডাটাবেজ আগেই এই লোকেশনে আছে।");
    }
    if (existsSync(targetFile)) {
      return failure("নির্বাচিত ফোল্ডারে একই নামের ডাটাবেজ আগে থেকে আছে।");
    }

    // (a) Checkpoint: fold every WAL frame into the main file before copying.
    let checkpoint: unknown = null;
    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        "PRAGMA wal_checkpoint(TRUNCATE)"
      );
      checkpoint = jsonSafe(rows?.[0] ?? null);
      // busy != 0 means another writer blocked a full checkpoint; copying
      // now could miss WAL frames, so refuse instead of risking the ledger.
      if (Number((checkpoint as { busy?: number } | null)?.busy ?? 0) !== 0) {
        return failure("WAL চেকপয়েন্ট সম্পূর্ণ হয়নি — স্থানান্তর বাতিল।", 500);
      }
    } catch {
      try {
        await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
      } catch {
        return failure("WAL চেকপয়েন্ট করা যায়নি — স্থানান্তর বাতিল।", 500);
      }
    }

    // (b) Atomic copy: write beside the destination, never straight at it.
    tempFile = path.join(
      targetDir,
      `.maher-migrate-temp-${stamp()}-${Math.random().toString(36).slice(2)}.db`
    );
    copyFileSync(sourceFile, tempFile);

    // (c) Integrity: the copy must be a healthy, complete ledger. Both the
    // service ledger and the product catalogue must survive byte-for-byte.
    const source = inspected(sourceFile);
    const targetCheck = inspected(tempFile);
    if (
      targetCheck.quickCheck.toLowerCase() !== "ok" ||
      !targetCheck.hasTechnician ||
      targetCheck.serviceRows === null ||
      targetCheck.productRows === null ||
      targetCheck.serviceRows !== source.serviceRows ||
      targetCheck.productRows !== source.productRows ||
      targetCheck.bytes !== source.bytes
    ) {
      return failure("নতুন কপির অখণ্ডতা যাচাই ব্যর্থ হয়েছে — কিছুই পরিবর্তন করা হয়নি।", 500);
    }

    // (d) Commit: rename the verified copy, then publish the pointer. The old
    // file stays exactly where it was, so a bad drive can be undone by hand.
    const verifiedTemp = tempFile;
    renameSync(tempFile, targetFile);
    tempFile = "";
    // Verification opened the copy in WAL mode; its -wal/-shm sidecars are
    // not part of the final database and must not survive the rename.
    removeTempArtifacts(verifiedTemp);
    const status = writeDbLocationConfig(targetFile);

    return NextResponse.json({
      ok: true,
      activePath: status.activePath,
      recordCount: targetCheck.serviceRows,
      sizeBytes: targetCheck.bytes,
      sourcePath: sourceFile,
      targetPath: targetFile,
      originalKept: true,
      checkpoint,
      quickCheck: targetCheck.quickCheck,
      serviceRows: targetCheck.serviceRows,
      productRows: targetCheck.productRows,
      bytes: targetCheck.bytes,
      location: status,
      defaultPath: defaultDatabaseFile(),
    });
  } catch (err) {
    console.error("POST /api/backup/change-db-path failed:", err);
    return failure(
      err instanceof Error && err.message
        ? err.message
        : "ডাটাবেজ স্থানান্তর করা যায়নি।",
      500
    );
  } finally {
    // Best-effort cleanup of a failed copy and its WAL sidecars. The source
    // database is never touched here.
    removeTempArtifacts(tempFile);
    if (markerFile) {
      try {
        if (existsSync(markerFile)) unlinkSync(markerFile);
      } catch {
        /* best-effort marker cleanup */
      }
    }
  }
}

/** Discard a custom pointer and return to the launcher's default location. */
export async function DELETE() {
  try {
    const status = dbLocationStatus();
    const config = status.configFile;
    if (existsSync(config)) unlinkSync(config);
    return NextResponse.json({ ok: true, location: resolveDatabaseFile() });
  } catch (err) {
    console.error("DELETE /api/backup/change-db-path failed:", err);
    return failure("আগের লোকেশনে ফিরে যাওয়া যায়নি।", 500);
  }
}
