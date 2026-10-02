import { NextResponse } from "next/server";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const BACKUP_DIR = join(process.cwd(), "backups");
const NAME_RE = /^(maher-\d{8}-\d{6}(-\d{3})?|safety-\d{8}-\d{6}(-\d{3})?)\.db$/;

export interface SnapshotInfo {
  file: string;
  kind: "manual" | "safety";
  sizeKB: number;
  mtime: string;
}

/** List available snapshots, newest first (manual + pre-restore safety). */
export async function GET() {
  try {
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
