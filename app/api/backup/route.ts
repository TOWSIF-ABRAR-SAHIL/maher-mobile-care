import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveBackupDir } from "@/lib/db-path";

export const dynamic = "force-dynamic";

const KEEP_SNAPSHOTS = 30;

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(): string {
  const d = new Date();
  // Milliseconds included — two backups in the same second (double-click,
  // auto-backup + manual, two tabs) must never collide: VACUUM INTO refuses
  // to overwrite an existing file.
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* GET /api/backup → full data as CSV download (Excel-safe, BOM)       */
/* ------------------------------------------------------------------ */

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  // Prevent spreadsheet formula execution for values such as "=CMD()", "+1",
  // "-2", or "@user", including after leading whitespace. A leading apostrophe
  // forces spreadsheet apps to treat the cell as text.
  const guard = /^\s*[=+\-@]/.test(s) ? "'" : "";
  return `"${guard}${s.replace(/"/g, '""')}"`;
};

export async function GET(_req: NextRequest) {
  try {
    const rows = await prisma.service.findMany({ orderBy: { id: "asc" } });
    const header = [
      "id", "date", "customer", "phone", "model", "technician",
      "problem", "status", "bill", "advance", "due",
      "expense", "archived", "created", "updated",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          new Date(r.serviceDate).toISOString().slice(0, 10),
          csvCell(r.customerName),
          csvCell(r.phone),
          csvCell(r.model),
          r.technician,
          csvCell(r.problem),
          r.status,
          r.totalBill,
          r.advance,
          r.due,
          csvCell(r.shopExpense ?? ""),
          r.archived ? "YES" : "",
          new Date(r.createdAt).toISOString(),
          new Date(r.updatedAt).toISOString(),
        ].join(",")
      );
    }
    // BOM so Excel renders Bengali text correctly.
    const body = "﻿" + lines.join("\n");
    const day = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="maher-backup-${day}.csv"`,
      },
    });
  } catch (err) {
    console.error("GET /api/backup failed:", err);
    return NextResponse.json(
      { error: "Failed to export backup" },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/backup → timestamped snapshot of dev.db in ./backups      */
/* Uses VACUUM INTO so the copy is consistent while the app is open.   */
/* ------------------------------------------------------------------ */

export async function POST(_req: NextRequest) {
  try {
    const BACKUP_DIR = resolveBackupDir();
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file = `maher-${stamp()}.db`;
    const abs = join(BACKUP_DIR, file);
    // Filename is generated server-side — no user input reaches the SQL.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${abs.replace(/'/g, "''")}'`);

    // Prune old snapshots, keep the newest KEEP_SNAPSHOTS.
    // Pre-restore safety copies are kept separately (newest 5).
    const kept: string[] = [];
    try {
      const files = readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith("maher-") && f.endsWith(".db"))
        .sort();
      for (const f of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
        try {
          unlinkSync(join(BACKUP_DIR, f));
        } catch {
          /* keep going */
        }
      }
      kept.push(...files.slice(-KEEP_SNAPSHOTS));
      const safetyFiles = readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith("safety-") && f.endsWith(".db"))
        .sort();
      for (const f of safetyFiles.slice(
        0,
        Math.max(0, safetyFiles.length - 5)
      )) {
        try {
          unlinkSync(join(BACKUP_DIR, f));
        } catch {
          /* keep going */
        }
      }
    } catch {
      /* listing is best-effort */
    }

    const count = await prisma.service.count();
    return NextResponse.json({ ok: true, file, services: count, kept: kept.length });
  } catch (err) {
    console.error("POST /api/backup failed:", err);
    return NextResponse.json(
      { error: "Failed to snapshot database" },
      { status: 500 }
    );
  }
}
