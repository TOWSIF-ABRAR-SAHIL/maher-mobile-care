import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { resolveBackupDir } from "@/lib/db-path";

export const dynamic = "force-dynamic";

// Only our own generated filenames — no paths, no traversal.
const NAME_RE = /^(maher-\d{8}-\d{6}(-\d{3})?|safety-\d{8}-\d{6}(-\d{3})?)\.db$/;

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;
}

const REQUIRED_COLS = [
  "id", "customerName", "phone", "model", "technician", "problem",
  "totalBill", "advance", "due", "status", "shopExpense", "expenseAmount",
  "serviceDate", "archived", "createdAt", "updatedAt",
];
// Columns added after the original backup format. A v1.0.3 snapshot must
// still restore, so a missing optional column is skipped rather than rejecting
// the whole file. Nullable columns then default to NULL; refundAmount and
// damageLoss use their schema DEFAULT 0.
const OPTIONAL_COLS = [
  "partsShop",
  "returnedAt",
  "refundAmount",
  "refundNote",
  "damageLoss",
  "damageNote",
];

/**
 * POST /api/backup/restore { file }
 * Replaces live data with a snapshot. A pre-restore safety copy is taken
 * first, so a wrong restore is itself restorable. Single-user local app —
 * sequential statements on one connection are safe enough.
 */
export async function POST(req: NextRequest) {
  let attached = false;
  try {
    const body = await req.json().catch(() => ({}));
    const file = String(body?.file ?? "");
    if (!NAME_RE.test(file)) {
      return NextResponse.json({ error: "ভুল ব্যাকআপ ফাইল" }, { status: 400 });
    }
    const BACKUP_DIR = resolveBackupDir();
    mkdirSync(BACKUP_DIR, { recursive: true });
    const abs = resolve(BACKUP_DIR, file);
    if (!abs.startsWith(resolve(BACKUP_DIR)) || !existsSync(abs)) {
      return NextResponse.json(
        { error: "ব্যাকআপ ফাইল পাওয়া যায়নি" },
        { status: 404 }
      );
    }

    // 1) Inspect the snapshot (read-only): table, columns, row count.
    //    The column check is the important one — an old snapshot (e.g. taken
    //    before a migration added a column) passes the table check, and would
    //    otherwise be swapped in after DELETE, failing the INSERT and leaving
    //    live data empty.
    let incoming = 0;
    let missingCols: string[] = [];
    let snapshotCols = new Set<string>();
    try {
      const snap = new Database(abs, { readonly: true });
      try {
        const hasTable = snap
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='Service'"
          )
          .get();
        if (!hasTable) throw new Error("not a service backup");
        const snapCols = new Set(
          (
            snap.prepare("PRAGMA table_info(Service)").all() as {
              name: string;
            }[]
          ).map((c) => c.name)
        );
        snapshotCols = snapCols;
        missingCols = REQUIRED_COLS.filter((c) => !snapCols.has(c));
        incoming = (
          snap.prepare("SELECT COUNT(*) AS n FROM Service").get() as {
            n: number;
          }
        ).n;
      } finally {
        snap.close();
      }
    } catch {
      return NextResponse.json(
        { error: "ব্যাকআপ ফাইল নষ্ট" },
        { status: 400 }
      );
    }
    if (missingCols.length > 0) {
      return NextResponse.json(
        {
          error: `পুরোনো বা অসম্পূর্ণ ব্যাকআপ — ফিরিয়ে আনা যাবে না (${missingCols.join(
            ", "
          )} কলাম নেই)`,
        },
        { status: 400 }
      );
    }

    // New snapshots carry optional columns; old ones omit them. Skipping a
    // nullable column leaves NULL; skipping refundAmount/damageLoss applies
    // their DEFAULT 0, which is exactly the pre-v1.1.2 behaviour.
    const insertCols = [
      ...REQUIRED_COLS,
      ...OPTIONAL_COLS.filter((c) => snapshotCols.has(c)),
    ];
    const insertColList = insertCols.join(", ");

    // 2) Safety copy of CURRENT data before touching anything.
    const safety = `safety-${stamp()}.db`;
    const safetyAbs = join(BACKUP_DIR, safety);
    // Windows paths (C:\..., spaces) are normalized to forward slashes —
    // SQLite accepts them, backslashes do not survive quoting reliably.
    const q = (s: string) => s.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${q(safetyAbs)}'`);

    // 3) Swap live table contents with the snapshot's — atomically.
    //    ATTACH must run outside a transaction (SQLite rule). From there,
    //    BEGIN IMMEDIATE … COMMIT means any failure (or a power cut) rolls
    //    back the DELETE too: live data can never be left empty by a
    //    half-finished restore.
    await prisma.$executeRawUnsafe(`ATTACH DATABASE '${q(abs)}' AS snap`);
    attached = true;
    await prisma.$executeRawUnsafe("BEGIN IMMEDIATE");
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM Service`);
      const inserted = await prisma.$executeRawUnsafe(
        `INSERT INTO Service (${insertColList}) SELECT ${insertColList} FROM snap.Service`
      );
      // Row-count sanity check before committing; mismatch → rollback.
      if (inserted !== incoming) {
        throw new Error(`restored ${inserted} rows, expected ${incoming}`);
      }
      await prisma.$executeRawUnsafe("COMMIT");
    } catch (err) {
      try {
        await prisma.$executeRawUnsafe("ROLLBACK");
      } catch {
        /* transaction already gone — nothing left to roll back */
      }
      throw err;
    }

    const live = await prisma.service.count();
    return NextResponse.json({
      ok: true,
      restored: live,
      incoming,
      safety,
    });
  } catch (err) {
    console.error("POST /api/backup/restore failed:", err);
    return NextResponse.json(
      { error: "ফিরিয়ে আনা যায়নি" },
      { status: 500 }
    );
  } finally {
    if (attached) {
      try {
        await prisma.$executeRawUnsafe(`DETACH DATABASE snap`);
      } catch {
        /* connection will reset on next restart */
      }
    }
  }
}
