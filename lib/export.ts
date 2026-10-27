/**
 * Offline report export (CSV + Excel). Everything is built in the browser —
 * no cloud, no server round-trip beyond the row fetch the caller performs.
 *
 * PRIVACY: row blocks never carry `expenseAmount`, `expenseWrittenOff`,
 * `imei`, `damageNote` or `refundNote` (business rules 2 and 8). The shop's
 * cost only ever appears as the report's own aggregate total.
 */
import { dhakaDateKey } from "@/lib/dhaka";
import type { MonthlySummary, ServiceDTO } from "@/lib/types";
// This module is only ever reached through a dynamic import(), so the sheet
// writer stays out of the service page's first-paint chunk.
import * as XLSX from "xlsx";

/** Formula-injection guard, same rule as /api/backup (csvCell). */
export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  const guard = /^\s*[=+\-@]/.test(s) ? "'" : "";
  return `"${guard}${s.replace(/"/g, '""')}"`;
};

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface ReportData {
  from: string;
  to: string;
  summary: MonthlySummary;
  /** Every active row of the window (client-capped by the caller). */
  rows: ServiceDTO[];
}

export interface DailyRow {
  date: string;
  count: number;
  bill: number;
  advance: number;
  due: number;
  expense: number;
}

/**
 * Per-day roll-up shared by CSV, Excel and the PDF sheet. Returned newest day
 * first so the exports read like the multi-date service list.
 */
export function dailyBreakdown(rows: ServiceDTO[]): DailyRow[] {
  const map = new Map<string, DailyRow>();
  for (const r of rows) {
    const key = dhakaDateKey(r.serviceDate);
    const cell =
      map.get(key) ??
      { date: key, count: 0, bill: 0, advance: 0, due: 0, expense: 0 };
    if (r.status !== "Returned") {
      cell.count += 1;
      cell.bill += r.totalBill;
      cell.advance += r.advance;
      cell.due += r.due;
    }
    cell.expense += r.expenseWrittenOff ? 0 : r.expenseAmount;
    map.set(key, cell);
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** Summary rows shared by every format (label, value). */
export function summaryRows(s: MonthlySummary): [string, number][] {
  return [
    ["মোট কাজ", s.count],
    ["মোট বিল", s.bill],
    ["মোট জমা", s.advance],
    ["মোট খরচ", s.expense + s.damageLoss],
    ["মোট বাকি", s.due],
    ["মোট লাভ (Profit)", s.profit],
    ["ফেরত", s.refund],
    ["ফেরত সংখ্যা", s.returnedCount],
  ];
}

const ROW_HEADER = [
  "আইডি", "তারিখ", "কাস্টমার", "ফোন", "মডেল", "টেকনিশিয়ান", "সমস্যা",
  "অবস্থা", "বিল", "জমা", "বাকি", "ডেলিভারি তারিখ", "গ্রুপ আইডি",
];

function rowValues(r: ServiceDTO): (string | number)[] {
  return [
    r.id,
    dhakaDateKey(r.serviceDate),
    r.customerName,
    r.phone,
    r.model,
    r.technician,
    r.problem,
    r.status,
    r.totalBill,
    r.advance,
    r.due,
    r.deliveryDate ? dhakaDateKey(r.deliveryDate) : "",
    r.groupId ?? "",
  ];
}

/** UTF-8 BOM + quoted cells so Excel renders Bengali correctly. */
export function buildReportCsv(d: ReportData): Blob {
  const L: string[] = [];
  L.push(csvCell("MAHER MOBILE CARE — ওভারঅল রিপোর্ট"));
  L.push([csvCell("তারিখ পরিসীমা"), csvCell(`${d.from} – ${d.to}`)].join(","));
  L.push("");
  L.push([csvCell("সারাংশ"), csvCell("পরিমাণ")].join(","));
  for (const [label, value] of summaryRows(d.summary)) {
    L.push([csvCell(label), String(value)].join(","));
  }
  L.push("");
  L.push(
    ["তারিখ", "কাজ", "বিল", "জমা", "বাকি", "খরচ"]
      .map(csvCell)
      .join(",")
  );
  for (const r of dailyBreakdown(d.rows)) {
    L.push([r.date, r.count, r.bill, r.advance, r.due, r.expense].join(","));
  }
  L.push("");
  L.push(ROW_HEADER.map(csvCell).join(","));
  for (const r of d.rows) {
    L.push(rowValues(r).map((v) => csvCell(v)).join(","));
  }
  return new Blob(["\uFEFF" + L.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
}

/** Real .xlsx via SheetJS — write-only, bundled, no network at runtime. */
export function buildReportXlsx(d: ReportData): Blob {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["তারিখ পরিসীমা", `${d.from} – ${d.to}`],
      [],
      ["সারাংশ", "পরিমাণ"],
      ...summaryRows(d.summary),
    ]),
    "সারাংশ"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["তারিখ", "কাজ", "বিল", "জমা", "বাকি", "খরচ"],
      ...dailyBreakdown(d.rows).map((r) => [
        r.date, r.count, r.bill, r.advance, r.due, r.expense,
      ]),
    ]),
    "দৈনিক ভাঙতি"
  );

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ROW_HEADER,
      ...d.rows.map(rowValues),
    ]),
    "সার্ভিস"
  );

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
