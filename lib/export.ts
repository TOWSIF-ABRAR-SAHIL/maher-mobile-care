/**
 * Offline report export (CSV + Excel). Everything is built in the browser —
 * no cloud, no server round-trip beyond the row fetch the caller performs.
 *
 * PRIVACY: row blocks never carry `expenseAmount`, `expenseWrittenOff`,
 * `imei`, `damageNote` or `refundNote` (business rules 2 and 8). The shop's
 * cost only ever appears as the report's own aggregate total.
 *
 * LAYOUT: CSV, Excel and the PDF sheet all read from these same helpers, in
 * the same order — title, window, summary, daily roll-up, detail, footer.
 */
import { dhakaDateKey } from "@/lib/dhaka";
import { PLATFORM_BRAND } from "@/lib/shop";
import type { MonthlySummary, ServiceDTO } from "@/lib/types";
import { effectiveRepairCost } from "@/lib/parts";
import { STATUS_BN } from "@/lib/utils";
import type { Worksheet } from "exceljs";

/** Formula-injection guard, same rule as /api/backup (csvCell). */
export const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  const guard = /^\s*[=+\-@]/.test(s) ? "'" : "";
  return `"${guard}${s.replace(/"/g, '""')}"`;
};

const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(",");

export interface ReportData {
  from: string;
  to: string;
  /** Human window label used in the file's header ("2026-10-01 – 2026-10-27"). */
  label: string;
  /** File-name stamp: the window (`from_to`) or `all` for the whole ledger. */
  stamp: string;
  /** One timestamp shared by CSV, Excel and PDF so the three files agree. */
  generatedAt: string;
  /** Live tenant name; blank/unconfigured falls back to the MSS platform brand. */
  shopName?: string;
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

/** Newest service day first, then highest id — matches the on-screen list. */
export function sortedReportRows(rows: ServiceDTO[]): ServiceDTO[] {
  return [...rows].sort((a, b) => {
    const da = dhakaDateKey(a.serviceDate);
    const db = dhakaDateKey(b.serviceDate);
    if (da !== db) return da < db ? 1 : -1;
    return b.id - a.id;
  });
}

/** One status vocabulary for every export, not the raw API enum. */
export function reportStatus(status: string): string {
  return (STATUS_BN as Record<string, string>)[status] ?? status;
}

/** Fixed-size chunks for the PDF sheet, so a row is never cut in half. */
export function paginate<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages.length ? pages : [[]];
}

/**
 * Per-day roll-up shared by CSV, Excel and the PDF sheet. Returned-only days
 * have no money and no active work, so they are left out instead of showing a
 * misleading all-zero line in the middle of the report.
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
    cell.expense += effectiveRepairCost(r, r.partsCost ?? null);
    map.set(key, cell);
  }
  return [...map.values()]
    .filter(
      (d) => d.count > 0 || d.bill > 0 || d.advance > 0 || d.due > 0 || d.expense > 0
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Money totals for the detail footer: only active jobs feed bill/advance/due
 * (the summary and daily roll-up use the same rule). A Returned row keeps its
 * original bill/advance in its own cell for audit, but must not inflate the
 * footer; its refund stays in the refund column so nothing is counted twice.
 */
export function detailTotals(rows: ServiceDTO[]): number[] {
  const active = rows.filter((r) => r.status !== "Returned");
  return [
    active.reduce((sum, r) => sum + r.totalBill, 0),
    active.reduce((sum, r) => sum + r.advance, 0),
    active.reduce((sum, r) => sum + r.due, 0),
    rows.reduce(
      (sum, r) => sum + (r.status === "Returned" ? r.refundAmount : 0),
      0
    ),
  ];
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

export const DAILY_HEADERS = ["তারিখ", "কাজ", "বিল", "জমা", "বাকি", "খরচ"];

export const DETAIL_HEADERS = [
  "আইডি", "তারিখ", "কাস্টমার", "ফোন", "মডেল", "টেকনিশিয়ান", "সমস্যা",
  "অবস্থা", "বিল", "জমা", "বাকি", "ফেরত", "ফেরত তারিখ", "ডেলিভারি তারিখ",
  "গ্রুপ আইডি",
];

/** Wide enough for Bengali words; kept in one place for CSV/Excel/PDF parity. */
export const DETAIL_WIDTHS = [
  8, 14, 24, 16, 36, 14, 40, 12, 13, 13, 13, 13, 14, 14, 12,
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
    reportStatus(r.status),
    r.totalBill,
    r.advance,
    r.due,
    // Refund is the returned advance only; nothing cost/IMEI/notes related.
    r.status === "Returned" ? r.refundAmount : 0,
    r.status === "Returned" && r.returnedAt ? dhakaDateKey(r.returnedAt) : "",
    r.deliveryDate ? dhakaDateKey(r.deliveryDate) : "",
    r.groupId ?? "",
  ];
}

const stampLabel = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? iso
    : new Intl.DateTimeFormat("bn-BD", {
        dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka",
      }).format(at);
};

export const REPORT_PRIVACY_NOTE =
  "এই ফাইল দোকানের অভ্যন্তরীণ নথি — কাস্টমারকে দেবেন না। এতে মোট খরচ, লাভ ও কাস্টমারের তথ্য আছে; খরচের বিস্তারিত ও IMEI নেই।";

/** Tenant name first; an unconfigured shop still gets a clean MSS title. */
const reportBrand = (d: ReportData) =>
  d.shopName?.trim() || PLATFORM_BRAND.name;

/** UTF-8 BOM + CRLF + quoted cells so Excel on Windows renders Bengali cleanly. */
export function buildReportCsv(d: ReportData): Blob {
  const L: string[] = [];
  L.push(csvLine([`${reportBrand(d)} — ওভারঅল রিপোর্ট`]));
  L.push(csvLine(["তারিখ পরিসীমা", d.label]));
  L.push("");
  L.push(csvLine(["সারাংশ", "পরিমাণ"]));
  for (const [label, value] of summaryRows(d.summary)) {
    L.push(csvLine([label, value]));
  }
  L.push("");
  L.push(csvLine(["দৈনিক ভাঙতি"]));
  L.push(csvLine(DAILY_HEADERS));
  const days = dailyBreakdown(d.rows);
  for (const r of days) {
    L.push(csvLine([r.date, r.count, r.bill, r.advance, r.due, r.expense]));
  }
  L.push(csvLine(["মোট", "", ...DAILY_HEADERS.slice(2).map((_, i) =>
    days.reduce((sum, r) => sum + [r.bill, r.advance, r.due, r.expense][i], 0))]));
  L.push("");
  L.push(csvLine(["কাস্টমার ডিটেইল রিপোর্ট"]));
  L.push(csvLine(DETAIL_HEADERS));
  const rows = sortedReportRows(d.rows);
  for (const r of rows) L.push(csvLine(rowValues(r)));
  const money = detailTotals(rows);
  const totals: (string | number)[] = DETAIL_HEADERS.map((_, i) =>
    [8, 9, 10, 11].includes(i) ? money[i - 8] : ""
  );
  totals[0] = "মোট";
  L.push(csvLine(totals));
  L.push("");
  L.push(csvLine([REPORT_PRIVACY_NOTE]));
  L.push(csvLine(["তৈরি:", stampLabel(d.generatedAt)]));
  return new Blob(["\uFEFF" + L.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
}

/**
 * Real .xlsx via ExcelJS — write-only at runtime, loaded through a dynamic
 * import so the workbook writer stays out of the service page's first paint.
 * Titles, widths, frozen headers and number formats make each sheet readable
 * on its own instead of a grid of unlabelled numbers.
 */
export async function buildReportXlsx(d: ReportData): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = reportBrand(d);
  wb.created = new Date(d.generatedAt);

  const title = (sheet: Worksheet, heading: string, widths: number[]) => {
    sheet.getCell("A1").value = `${reportBrand(d)} — ${heading}`;
    sheet.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF1F2A36" } };
    sheet.getCell("A2").value = "তারিখ পরিসীমা";
    sheet.getCell("B2").value = d.label;
    sheet.getCell("A2").font = { bold: true, color: { argb: "FF5E6B78" } };
    widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
    sheet.getRow(1).height = 24;
  };

  const tableHeader = (sheet: Worksheet, headers: string[]) => {
    const row = sheet.getRow(4);
    row.values = headers;
    row.font = { bold: true, color: { argb: "FF1F2A36" } };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F5F7" } };
    row.height = 22;
    sheet.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];
  };

  const totalRow = (sheet: Worksheet, label: string, values: (string | number)[]) => {
    const row = sheet.addRow([label, ...values]);
    row.font = { bold: true };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F5F7" } };
  };

  const summarySheet = wb.addWorksheet("সারাংশ");
  title(summarySheet, "ওভারঅল রিপোর্ট", [30, 22]);
  summarySheet.getCell("A4").value = "সারাংশ";
  summarySheet.getCell("B4").value = "পরিমাণ";
  summarySheet.getRow(4).font = { bold: true };
  summaryRows(d.summary).forEach(([label, value], i) => {
    summarySheet.getCell(`A${5 + i}`).value = label;
    const cell = summarySheet.getCell(`B${5 + i}`);
    cell.value = value;
    cell.numFmt = "#,##0";
  });
  summarySheet.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];

  const dailySheet = wb.addWorksheet("দৈনিক ভাঙতি");
  title(dailySheet, "দৈনিক ভাঙতি", [16, 10, 15, 15, 15, 15]);
  tableHeader(dailySheet, DAILY_HEADERS);
  const days = dailyBreakdown(d.rows);
  for (const r of days) {
    const row = dailySheet.addRow([r.date, r.count, r.bill, r.advance, r.due, r.expense]);
    for (let c = 3; c <= 6; c++) row.getCell(c).numFmt = "#,##0";
  }
  totalRow(dailySheet, "মোট", DAILY_HEADERS.slice(1).map((_, i) =>
    days.reduce((sum, r) => sum + [r.count, r.bill, r.advance, r.due, r.expense][i], 0)));

  const detailSheet = wb.addWorksheet("সার্ভিস");
  title(detailSheet, "কাস্টমার ডিটেইল রিপোর্ট", DETAIL_WIDTHS);
  tableHeader(detailSheet, DETAIL_HEADERS);
  const rows = sortedReportRows(d.rows);
  for (const r of rows) {
    const values = rowValues(r);
    const row = detailSheet.addRow(values);
    for (const c of [9, 10, 11, 12]) row.getCell(c).numFmt = "#,##0";
  }
  const money = detailTotals(rows);
  const totals: (string | number)[] = DETAIL_HEADERS.map((_, i) =>
    [8, 9, 10, 11].includes(i) ? money[i - 8] : ""
  );
  totalRow(detailSheet, "মোট", totals.slice(1));
  detailSheet.addRow([REPORT_PRIVACY_NOTE]);
  detailSheet.addRow(["তৈরি:", stampLabel(d.generatedAt)]);

  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
