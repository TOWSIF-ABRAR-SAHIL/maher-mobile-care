import { NextResponse } from "next/server";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { resolveBackupDir } from "@/lib/db-path";

export const dynamic = "force-dynamic";

const NAME_RE = /^(maher-\d{8}-\d{6}(-\d{3})?|safety-\d{8}-\d{6}(-\d{3})?)\.db$/;

export interface SnapshotInfo {
  file: string;
  kind: "manual" | "safety";
  sizeKB: number;
  mtime: string;
  rowCount: number | null;
}

/** Read-only row total shown before a snapshot is selected for restore. */
function snapshotRowCount(abs: string): number | null {
  let db: { prepare(sql: string): { get(): unknown }; close(): void } | undefined;
  try {
    db = new Database(abs, { readonly: true });
    const hasTable = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='Service'")
      .get();
    if (!hasTable) return null;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM Service")
      .get() as { n: unknown } | undefined;
    const count = Number(row?.n);
    return Number.isInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* best effort */
    }
  }
}

/** List available snapshots, newest first (manual + pre-restore safety). */
export async function GET() {
  try {
    const BACKUP_DIR = resolveBackupDir();
    if (!existsSync(BACKUP_DIR)) {
      return NextResponse.json({ snapshots: [] });
    }
    const snapshots: SnapshotInfo[] = [];
    for (const f of readdirSync(BACKUP_DIR)) {
      if (!NAME_RE.test(f)) continue;
      try {
        const st = statSync(join(BACKUP_DIR, f));
        snapshots.push({
          file: f,
          kind: f.startsWith("safety-") ? "safety" : "manual",
          sizeKB: Math.max(1, Math.round(st.size / 1024)),
          mtime: st.mtime.toISOString(),
          rowCount: snapshotRowCount(join(BACKUP_DIR, f)),
        });
      } catch {
        /* unreadable file — skip */
      }
    }
    snapshots.sort((a, b) => (a.file < b.file ? 1 : -1));
    return NextResponse.json({ snapshots });
  } catch (err) {
    console.error("GET /api/backup/list failed:", err);
    return NextResponse.json(
      { error: "Failed to list backups" },
      { status: 500 }
    );
  }
}
