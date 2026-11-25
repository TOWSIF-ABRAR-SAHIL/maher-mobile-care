import { NextRequest, NextResponse } from "next/server";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { prisma } from "@/lib/prisma";
import { resolveBackupDir } from "@/lib/db-path";
import { dhakaDateKey } from "@/lib/dhaka";
import { buildBackupWorkbook } from "@/lib/backup-workbook";
import { partsCostByService } from "@/lib/parts-data";
import { PLATFORM_BRAND } from "@/lib/shop";
import { getShopSettings } from "@/lib/shop-settings";

export const dynamic = "force-dynamic";

const KEEP_SNAPSHOTS = 30;
const UTF8_BOM = "\uFEFF";

/** Internal exports carry the live shop name; MSS is the clean-slate fallback. */
async function exportBrand(): Promise<string> {
  const settings = await getShopSettings();
  return settings.shopName.trim() || PLATFORM_BRAND.name;
}

/**
 * Public backup model names mapped to the tables that actually exist in this
 * schema. `CustomerPayment` and `SupplierExpense` are the Phase 2 aliases used
 * by the restore contract; `AuditLog` is reserved — the raw audit rows live in
 * the Service/parts sheets of the workbook.
 */
const BACKUP_MODELS = [
  { name: "Service", table: "Service" },
  { name: "Product", table: "Product" },
  { name: "CustomerPayment", table: "Payment" },
  { name: "SupplierExpense", table: "Purchase" },
  { name: "Technician", table: "Technician" },
  { name: "AuditLog", table: null },
] as const;

/**
 * Flush WAL frames into the database file before any export. Without this, a
 * downloaded `.db` can miss the newest jobs even though the running app sees
 * them. Best effort: an unusual journal mode must never block a backup.
 */
async function checkpointActiveWal(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.warn("WAL checkpoint before export skipped:", err);
  }
}

async function backupModelCounts(): Promise<Record<string, number>> {
  const [services, products, payments, purchases, technicians] =
    await Promise.all([
      prisma.service.count(),
      prisma.product.count(),
      prisma.payment.count(),
      prisma.purchase.count(),
      prisma.technician.count(),
    ]);
  return {
    Service: services,
    Product: products,
    CustomerPayment: payments,
    SupplierExpense: purchases,
    Technician: technicians,
    AuditLog: services,
  };
}

const modelHeader = (counts: Record<string, number>): string =>
  `# BACKUP_MODELS: ${BACKUP_MODELS.map((m) => m.name).join(",")}` +
  `\n# MODEL_COUNTS: ${BACKUP_MODELS.map((m) => `${m.name}=${counts[m.name] ?? 0}`).join(",")}`;

const pad = (n: number) => String(n).padStart(2, "0");

function stamp(): string {
  const d = new Date();
  // Milliseconds included — two backups in the same second (double-click,
  // auto-backup + manual, two tabs) must never collide: VACUUM INTO refuses
  // to overwrite an existing file.
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Windows paths need forward slashes before they are embedded in SQL. */
const sqlPath = (value: string) => value.replace(/\\/g, "/").replace(/'/g, "''");

/** Dhaka-local `YYYY-MM-DD_HH-mm` used by the system recovery filename. */
function exportStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${dhakaDateKey(date)}_${hour}-${minute}`;
}

/**
 * Consistent SQLite snapshot of the live DB with the local-only ShopSettings
 * singleton removed. VACUUM INTO runs on the live connection; the DROP happens
 * on a separate temporary copy, so no live row or schema is ever touched.
 */
async function buildSystemSnapshot(): Promise<{
  bytes: Buffer;
  filename: string;
}> {
  const tempDir = join(
    tmpdir(),
    `maher-system-export-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(tempDir, { recursive: true });
  const raw = join(tempDir, "snapshot.db");
  try {
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath(raw)}'`);
    const copy = new Database(raw);
    try {
      copy.exec('DROP TABLE IF EXISTS "ShopSettings"');
    } finally {
      copy.close();
    }
    return {
      bytes: readFileSync(raw),
      filename: `MAHER_SYSTEM_BACKUP_${exportStamp()}.db`,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/** ASCII-safe text for the server-side PDF (jsPDF core fonts use WinAnsi). */
const pdfText = (value: unknown, max = 32): string =>
  String(value ?? "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max) || "-";

const BENGALI_PDF_FONT_ID = "NotoBengaliBrand";
const BENGALI_PDF_FONT_FILE = "NotoSansBengali-bengali.ttf";
let bengaliPdfFontBase64: string | null | undefined;

/** Register the self-hosted Bengali font once per server process. */
function bengaliPdfFont(doc: any): string | null {
  if (bengaliPdfFontBase64 === undefined) {
    const fontPath = join(process.cwd(), "app", "fonts", BENGALI_PDF_FONT_FILE);
    bengaliPdfFontBase64 = existsSync(fontPath)
      ? readFileSync(fontPath).toString("base64")
      : null;
  }
  if (!bengaliPdfFontBase64) return null;
  try {
    doc.addFileToVFS(BENGALI_PDF_FONT_FILE, bengaliPdfFontBase64);
    doc.addFont(
      BENGALI_PDF_FONT_FILE,
      BENGALI_PDF_FONT_ID,
      "normal",
      "400",
      "Identity-H"
    );
    return BENGALI_PDF_FONT_ID;
  } catch {
    return null;
  }
}

/** The tenant name may be Bengali, Latin or mixed; draw each run with a font that has it. */
function drawPdfBrand(doc: any, value: unknown, x: number, y: number): void {
  const brand = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || "-";
  let cursor = x;
  for (const chunk of brand.match(/[\u0980-\u09FF]+|[^\u0980-\u09FF]+/g) || []) {
    if (!chunk.trim()) {
      cursor += doc.getTextWidth(chunk);
      continue;
    }
    if (/[\u0980-\u09FF]/.test(chunk)) {
      const font = bengaliPdfFont(doc);
      if (font) {
        doc.setFont(font, "normal");
        doc.text(chunk, cursor, y);
        cursor += doc.getTextWidth(chunk);
        continue;
      }
    }
    const ascii = chunk.replace(/[^\x20-\x7E]/g, "?");
    doc.setFont("helvetica", "bold");
    doc.text(ascii, cursor, y);
    cursor += doc.getTextWidth(ascii);
  }
  doc.setFont("helvetica", "normal");
}

/** Structured, printable business overview. No ledger values are recalculated. */
async function buildBusinessPdf(): Promise<Buffer> {
  const [brand, rows, products] = await Promise.all([
    exportBrand(),
    prisma.service.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        serviceDate: true,
        customerName: true,
        model: true,
        totalBill: true,
        advance: true,
        due: true,
        expenseAmount: true,
        status: true,
        archived: true,
      },
    }),
    prisma.product.findMany({
      select: { stock: true, lowStockThreshold: true, archived: true },
    }),
  ]);

  const active = rows.filter((r) => !r.archived);
  const sum = (pick: (r: (typeof active)[number]) => number) =>
    active.reduce((total, r) => total + pick(r), 0);
  const totals = {
    bills: sum((r) => r.totalBill),
    advance: sum((r) => r.advance),
    due: sum((r) => r.due),
    expense: sum((r) => r.expenseAmount),
  };
  const liveProducts = products.filter((p) => !p.archived);
  const lowStock = liveProducts.filter(
    (p) => p.stock < 5 || p.stock <= p.lowStockThreshold
  ).length;

  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const width = doc.internal.pageSize.getWidth();

  doc.setFillColor(34, 61, 87);
  doc.rect(0, 0, width, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  drawPdfBrand(doc, brand, 14, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Business Overview / Snapshot Report", 14, 21);

  doc.setTextColor(31, 42, 54);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Summary", 14, 40);
  doc.setDrawColor(217, 224, 231);
  doc.line(14, 43, width - 14, 43);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const summary: [string, string][] = [
    ["Total services", String(active.length)],
    ["Total bill", totals.bills.toFixed(2)],
    ["Advance collected", totals.advance.toFixed(2)],
    ["Customer due", totals.due.toFixed(2)],
    ["Shop expense", totals.expense.toFixed(2)],
    ["Products", String(liveProducts.length)],
    ["Low stock items", String(lowStock)],
  ];
  summary.forEach(([label, value], index) => {
    const y = 51 + index * 7;
    doc.text(label, 14, y);
    doc.text(value, width - 14, y, { align: "right" });
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Recent services", 14, 112);
  doc.line(14, 115, width - 14, 115);
  doc.setFontSize(9);
  doc.text("ID", 14, 122);
  doc.text("Date", 30, 122);
  doc.text("Customer", 52, 122);
  doc.text("Model", 104, 122);
  doc.text("Bill", 145, 122, { align: "right" });
  doc.text("Due", width - 14, 122, { align: "right" });

  let y = 130;
  for (const row of active.slice(-12).reverse()) {
    if (y > 275) break;
    doc.setFont("helvetica", "normal");
    doc.text(String(row.id), 14, y);
    doc.text(dhakaDateKey(row.serviceDate), 30, y);
    doc.text(pdfText(row.customerName, 22), 52, y);
    doc.text(pdfText(row.model, 20), 104, y);
    doc.text(row.totalBill.toFixed(2), 145, y, { align: "right" });
    doc.text(row.due.toFixed(2), width - 14, y, { align: "right" });
    y += 7;
  }

  doc.setFontSize(8);
  doc.setTextColor(94, 107, 120);
  doc.text(
    "Generated offline on this PC. Internal expense figures are omitted from shared reports.",
    14,
    287
  );
  return Buffer.from(doc.output("arraybuffer"));
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

export async function GET(req: NextRequest) {
  try {
    await checkpointActiveWal();
    const modelCounts = await backupModelCounts();
    const format = req.nextUrl.searchParams.get("format");
    const modelsHeader = BACKUP_MODELS.map((m) => m.name).join(",");

    if (format === "system") {
      const { bytes, filename } = await buildSystemSnapshot();
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/vnd.sqlite3",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
          "X-Backup-Models": modelsHeader,
        },
      });
    }

    if (format === "pdf") {
      const bytes = await buildBusinessPdf();
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="mss-business-overview-${dhakaDateKey(new Date())}.pdf"`,
          "Cache-Control": "no-store",
          "X-Backup-Models": modelsHeader,
        },
      });
    }

    if (format === "xlsx") {
      const [services, products, parts] = await Promise.all([
        prisma.service.findMany({ orderBy: { id: "asc" } }),
        prisma.product.findMany({
          include: { category: { select: { name: true } } },
          orderBy: { name: "asc" },
        }),
        prisma.servicePart.findMany({ orderBy: { id: "asc" } }),
      ]);
      const partsCosts = await partsCostByService(services.map((s) => s.id));
      const generatedAt = new Date();
      const workbook = await buildBackupWorkbook({
        services: services.map((s) => ({
          ...s,
          partsCost: partsCosts.get(s.id) ?? null,
        })),
        products,
        parts,
        modelCounts,
        shopName: await exportBrand(),
        generatedAt,
      });
      const day = dhakaDateKey(generatedAt);
      return new NextResponse(new Uint8Array(workbook), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="mss-backup-${day}.xlsx"`,
          "Cache-Control": "no-store",
          "X-Backup-Models": modelsHeader,
        },
      });
    }

    const rows = await prisma.service.findMany({ orderBy: { id: "asc" } });
    const partsCosts = await partsCostByService(rows.map((r) => r.id));
    const header = [
      "id", "date", "customer", "phone", "model", "technician",
      "problem", "solution", "condition", "status", "bill", "advance", "due",
      "expense", "expenseAmount", "partsShop",
      "damageLoss", "damageNote", "returnedAt", "refundAmount", "refundNote",
      "inspectionFee", "returnReason",
      "expenseWrittenOff", "groupId", "deliveryDate", "deliveredAt", "imei",
      "customerAddress", "warranty",
      "saleRef", "archived", "created", "updated", "verified", "verifiedAt",
      "partsCost",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          r.id,
          dhakaDateKey(r.serviceDate),
          csvCell(r.customerName),
          csvCell(r.phone),
          csvCell(r.model),
          r.technician,
          csvCell(r.problem),
          csvCell(r.solution ?? ""),
          csvCell(r.condition ?? ""),
          r.status,
          r.totalBill,
          r.advance,
          r.due,
          csvCell(r.shopExpense ?? ""),
          r.expenseAmount,
          csvCell(r.partsShop ?? ""),
          r.damageLoss,
          csvCell(r.damageNote ?? ""),
          r.returnedAt ? new Date(r.returnedAt).toISOString() : "",
          r.refundAmount,
          csvCell(r.refundNote ?? ""),
          r.inspectionFee,
          csvCell(r.returnReason ?? ""),
          r.expenseWrittenOff ? "YES" : "",
          csvCell(r.groupId ?? ""),
          r.deliveryDate ? dhakaDateKey(r.deliveryDate) : "",
          r.deliveredAt ? new Date(r.deliveredAt).toISOString() : "",
          csvCell(r.imei ?? ""),
          csvCell(r.customerAddress ?? ""),
          csvCell(r.warranty ?? ""),
          csvCell(r.saleRef ?? ""),
          r.archived ? "YES" : "",
          new Date(r.createdAt).toISOString(),
          new Date(r.updatedAt).toISOString(),
          r.verified ? "YES" : "",
          r.verifiedAt ? new Date(r.verifiedAt).toISOString() : "",
          partsCosts.get(r.id) ?? 0,
        ].join(",")
      );
    }
    // BOM so Excel renders Bengali text correctly; the trailing audit footer
    // records every exported model and its row count for the recovery contract.
    const body = UTF8_BOM + lines.join("\n") + "\n\n" + modelHeader(modelCounts);
    const day = dhakaDateKey(new Date());
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="mss-backup-${day}.csv"`,
        "Cache-Control": "no-store",
        "X-Backup-Models": modelsHeader,
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
    await checkpointActiveWal();
    const BACKUP_DIR = resolveBackupDir();
    mkdirSync(BACKUP_DIR, { recursive: true });
    const file = `maher-${stamp()}.db`;
    const abs = join(BACKUP_DIR, file);
    // Filename is generated server-side — no user input reaches the SQL.
    // Windows paths use backslashes + drive letters (C:\...) with possible
    // spaces; SQLite accepts forward slashes, so normalize before quoting.
    const sqlitePath = abs.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlitePath}'`);

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
