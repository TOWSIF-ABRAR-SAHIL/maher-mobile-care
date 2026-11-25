/**
 * The Excel copy of a backup.
 *
 * The real backup is the `.db` snapshot (`POST /api/backup`). This workbook is
 * the human-readable copy the shopkeeper opens in Excel: a simple date-ordered
 * service ledger, a one-page summary, and the full raw audit sheet.
 *
 * Nothing is dropped: the audit sheet carries every Service field (including
 * internal cost and IMEI) exactly like the CSV export.
 */
import ExcelJS from "exceljs";
import { dhakaDateKey } from "@/lib/dhaka";
import { effectiveRepairCost } from "@/lib/parts";
import { PLATFORM_BRAND } from "@/lib/shop";
import { STATUS_BN } from "@/lib/utils";

const FONT = "Nirmala UI";
export const BACKUP_SHEETS = {
  summary: "সারসংক্ষেপ",
  services: "সার্ভিস খাতা",
  parts: "সার্ভিস পার্টস",
  audit: "সম্পূর্ণ ডেটা (অডিট)",
} as const;

const C = {
  navy: "FF223D57",
  steel: "FF35648C",
  ink: "FF1F2A36",
  muted: "FF5E6B78",
  hairline: "FFD9E0E7",
  wash: "FFF3F5F7",
  zebra: "FFF7F9FB",
  white: "FFFFFFFF",
  success: "FF2E7D5C",
  warn: "FF9A6714",
  danger: "FFB23A3A",
} as const;

const HEADER_ROW = 4;

type Align = "left" | "center" | "right";

interface Column {
  header: string;
  width: number;
  align?: Align;
  numFmt?: string;
  wrap?: boolean;
}

export interface BackupService {
  id: number;
  customerName: string;
  phone: string;
  model: string;
  technician: string;
  problem: string;
  solution: string | null;
  condition: string | null;
  totalBill: number;
  advance: number;
  due: number;
  status: string;
  shopExpense: string | null;
  expenseAmount: number;
  partsShop: string | null;
  /** Derived parts cost of this device, or null when it has none. */
  partsCost: number | null;
  returnedAt: Date | null;
  refundAmount: number;
  refundNote: string | null;
  inspectionFee: number;
  returnReason: string | null;
  damageLoss: number;
  damageNote: string | null;
  expenseWrittenOff: boolean;
  imei: string | null;
  /** Visit-level customer address and per-device warranty (audit only). */
  customerAddress: string | null;
  warranty: string | null;
  saleRef: string | null;
  groupId: string | null;
  deliveryDate: Date | null;
  deliveredAt: Date | null;
  verified: boolean;
  verifiedAt: Date | null;
  serviceDate: Date;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BackupProduct {
  id: number;
  name: string;
  sku: string | null;
  brand: string | null;
  description: string | null;
  supplier: string | null;
  sellingPrice: number;
  purchasePrice: number;
  stock: number;
  lowStockThreshold: number;
  archived: boolean;
  category: { name: string };
}

export interface BackupWorkbookInput {
  services: BackupService[];
  products: BackupProduct[];
  /** Internal parts purchase ledger (never part of the customer copy). */
  parts?: BackupPart[];
  /** Row totals for every model covered by the backup contract. */
  modelCounts?: Record<string, number>;
  /** Live tenant name; blank/unconfigured falls back to the MSS platform brand. */
  shopName?: string;
  generatedAt: Date;
}

/** One itemized part line, including its internal purchase/paid facts. */
export interface BackupPart {
  id: number;
  serviceId: number;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
  supplier: string | null;
  supplierKey: string | null;
  /** Keypad price code exactly as typed, or null for a plain number. */
  priceCode: string | null;
  purchaseDate: Date | null;
  paidAt: Date | null;
  paidNote: string | null;
  note: string | null;
  createdAt: Date;
}

interface Summary {
  live: BackupService[];
  active: BackupService[];
  returned: BackupService[];
  archived: BackupService[];
  bill: number;
  advance: number;
  due: number;
  expense: number;
  damageLoss: number;
  profit: number;
  refund: number;
  statusCount: Record<string, number>;
}

function summarize(services: BackupService[]): Summary {
  const live = services.filter((s) => !s.archived);
  const active = live.filter((s) => s.status !== "Returned");
  const returned = live.filter((s) => s.status === "Returned");
  // Match the daily/monthly stats: a retained inspection fee is real income
  // even though its row is Returned. Without it the shipped workbook reports
  // zero revenue/profit for a fee-only return while the app reports +fee.
  const feeIncome = returned.reduce((sum, s) => sum + (s.inspectionFee ?? 0), 0);
  const bill = active.reduce((sum, s) => sum + s.totalBill, 0) + feeIncome;
  const advance = active.reduce((sum, s) => sum + s.advance, 0);
  const due = active.reduce((sum, s) => sum + s.due, 0);
  // A returned job may have written off its parts cost; that row stays in the
  // backup but never changes the shop's totals (business rule 4). A device
  // with itemized parts reports their sum instead of the lump code.
  const expense = live.reduce(
    (sum, s) =>
      sum + effectiveRepairCost(s, s.partsCost ?? null),
    0
  );
  const damageLoss = live.reduce((sum, s) => sum + s.damageLoss, 0);
  const refund = returned.reduce((sum, s) => sum + s.refundAmount, 0);
  const statusCount: Record<string, number> = {};
  for (const s of live) statusCount[s.status] = (statusCount[s.status] ?? 0) + 1;
  return {
    live,
    active,
    returned,
    archived: services.filter((s) => s.archived),
    bill,
    advance,
    due,
    expense,
    damageLoss,
    profit: bill - expense - damageLoss,
    refund,
    statusCount,
  };
}

const moneyFmt = "#,##0";
const dateFmt = "dd/mm/yyyy";

function bnStatus(status: string): string {
  return STATUS_BN[status as keyof typeof STATUS_BN] ?? status;
}

/** Excel dates are stored at UTC noon so a Dhaka shop never sees a day shift. */
function dayDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function serviceDate(s: BackupService): Date | null {
  return dayDate(dhakaDateKey(s.serviceDate));
}

function optionalDate(value: Date | null): Date | null {
  return value ? dayDate(dhakaDateKey(value)) : null;
}

function iso(value: Date | null): string {
  return value ? new Date(value).toISOString() : "";
}

function dhakaStamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusColor(status: string): string {
  if (status === "Delivered") return C.success;
  if (status === "Returned") return C.danger;
  if (status === "Completed") return C.steel;
  if (status === "In-Progress") return C.warn;
  return C.muted;
}

function font(color: string = C.ink, bold = false, size = 10) {
  return { name: FONT, size, bold, color: { argb: color } };
}

function baseRowStyle(
  row: ExcelJS.Row,
  columns: Column[],
  index: number
): void {
  row.height = columns.some((c) => c.wrap) ? 30 : 18;
  columns.forEach((col, i) => {
    const cell = row.getCell(i + 1);
    cell.font = font();
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? "left",
      wrapText: !!col.wrap,
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: C.hairline } },
    };
    if (col.numFmt) cell.numFmt = col.numFmt;
    if (index % 2 === 1) {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: C.zebra },
      };
    }
  });
}

function addTitle(
  ws: ExcelJS.Worksheet,
  columns: Column[],
  title: string,
  subtitle: string
): void {
  ws.mergeCells(1, 1, 1, columns.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = font(C.navy, true, 15);
  titleCell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, 1, 2, columns.length);
  const sub = ws.getCell(2, 1);
  sub.value = subtitle;
  sub.font = font(C.muted, false, 9);
  sub.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  ws.getRow(2).height = subtitle.length > 90 ? 30 : 18;

  ws.getRow(3).height = 6;
}

function addHeader(ws: ExcelJS.Worksheet, columns: Column[]): void {
  const header = ws.getRow(HEADER_ROW);
  columns.forEach((col, i) => {
    const cell = header.getCell(i + 1);
    cell.value = col.header;
    cell.font = font(C.white, true, 10);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: C.navy },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: col.align ?? "left",
      wrapText: true,
    };
    cell.border = {
      bottom: { style: "medium", color: { argb: C.navy } },
    };
  });
  header.height = 26;
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: columns.length },
  };
}

function emptyNote(ws: ExcelJS.Worksheet, columns: Column[], text: string) {
  ws.mergeCells(5, 1, 5, columns.length);
  const cell = ws.getCell(5, 1);
  cell.value = text;
  cell.font = font(C.muted, false, 10);
  cell.alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(5).height = 24;
}

function tableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  subtitle: string,
  columns: Column[],
  rows: (string | number | Date | null)[][],
  tabColor: string,
  brand: string
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      horizontalCentered: true,
    },
  });
  ws.properties.tabColor = { argb: tabColor };
  ws.columns = columns.map((c) => ({ width: c.width }));
  ws.headerFooter = {
    oddFooter: `&L${brand}&Cপৃষ্ঠা &P / &N&R&D`,
  };

  addTitle(ws, columns, title, subtitle);
  addHeader(ws, columns);

  if (rows.length === 0) {
    emptyNote(ws, columns, "এই শিটে এখনো কোনো তথ্য নেই।");
    return ws;
  }

  rows.forEach((values, index) => {
    const row = ws.getRow(HEADER_ROW + 1 + index);
    values.forEach((value, i) => {
      row.getCell(i + 1).value = value;
    });
    baseRowStyle(row, columns, index);
  });

  // Filter over the data itself, not just the header row, otherwise Excel
  // opens the dropdown with nothing to filter.
  ws.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW + rows.length, column: columns.length },
  };

  return ws;
}

function summarySheet(
  wb: ExcelJS.Workbook,
  input: BackupWorkbookInput,
  s: Summary
): void {
  const brand = input.shopName?.trim() || PLATFORM_BRAND.name;
  const columns: Column[] = [
    { header: "বিবরণ", width: 30 },
    { header: "মান", width: 18, align: "right" },
    { header: "নোট", width: 52, wrap: true },
  ];
  const ws = wb.addWorksheet(BACKUP_SHEETS.summary, {
    views: [{ state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.properties.tabColor = { argb: C.navy };
  ws.columns = columns.map((c) => ({ width: c.width }));

  addTitle(
    ws,
    columns,
    `${brand} — ডেটা ব্যাকআপ`,
    `তৈরি: ${dhakaStamp(input.generatedAt)} (Asia/Dhaka) · এই ফাইলটি ব্যাকআপের পড়ার উপযোগী কপি`
  );

  let r = HEADER_ROW;
  const section = (label: string) => {
    ws.mergeCells(r, 1, r, 3);
    const cell = ws.getCell(r, 1);
    cell.value = label;
    cell.font = font(C.navy, true, 11);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: C.wash },
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: C.hairline } },
    };
    ws.getRow(r).height = 24;
    r += 1;
  };

  const line = (
    label: string,
    value: string | number,
    note = "",
    money = false,
    emphasis = false
  ) => {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    row.getCell(2).value = value;
    row.getCell(3).value = note;
    row.getCell(1).font = font(C.ink, emphasis, 10);
    row.getCell(2).font = font(emphasis ? C.navy : C.ink, emphasis, 10);
    row.getCell(3).font = font(C.muted, false, 9);
    row.getCell(2).alignment = { vertical: "middle", horizontal: "right" };
    row.getCell(3).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    if (money) row.getCell(2).numFmt = moneyFmt;
    row.height = 20;
    for (let c = 1; c <= 3; c += 1) {
      row.getCell(c).border = {
        bottom: { style: "thin", color: { argb: C.hairline } },
      };
    }
    r += 1;
  };

  section("এক নজরে");
  line("মোট কাজ (সক্রিয়)", s.active.length, "ফেরত বাদে");
  line("আর্কাইভ করা সার্ভিস", s.archived.length, "তালিকা/হিসাবের বাইরে, ব্যাকআপে আছে");
  line("ফেরত", s.returned.length, "বিল/জমা অডিটের জন্য রাখা, হিসাবে ০");
  line("মোট রেকর্ড", input.services.length, "সব সার্ভিস (আর্কাইভসহ)");

  section("টাকা");
  line("মোট বিল", s.bill, "সক্রিয় সার্ভিস + ফেরতের চেকিং ফি", true, true);
  line("মোট জমা", s.advance, "সক্রিয় সার্ভিস", true);
  line("মোট বাকি", s.due, "সক্রিয় সার্ভিস", true);
  line("মোট খরচ", s.expense, "লেখা-বাতিল করা খরচ বাদে", true);
  line("মোট ড্যামেজ লস", s.damageLoss, "দোকানের বহন করা ক্ষতি", true);
  line("মোট লাভ", s.profit, "বিল − খরচ − ড্যামেজ লস", true, true);
  line("মোট রিফান্ড", s.refund, "শুধু ফেরত সার্ভিস", true);

  section("অবস্থা অনুযায়ী (সক্রিয়)");
  for (const status of [
    "Pending",
    "In-Progress",
    "Completed",
    "Delivered",
    "Returned",
  ]) {
    line(bnStatus(status), s.statusCount[status] ?? 0, status);
  }

  const activeProducts = input.products.filter((p) => !p.archived);
  const stockPieces = activeProducts.reduce((sum, p) => sum + p.stock, 0);
  const costValue = activeProducts.reduce(
    (sum, p) => sum + p.stock * p.purchasePrice,
    0
  );
  const lowStock = activeProducts.filter(
    (p) => p.stock > 0 && p.stock <= p.lowStockThreshold
  ).length;
  const outOfStock = activeProducts.filter((p) => p.stock <= 0).length;

  section("স্টক");
  line("পণ্য আইটেম", activeProducts.length, "আর্কাইভ বাদে");
  line("মোট পিস", stockPieces, "বর্তমান স্টক");
  line("স্টকের ক্রয়মূল্য", costValue, "অভ্যন্তরীণ হিসাব", true);
  line("স্টক কম", lowStock, "লো-স্টক সীমার নিচে");
  line("স্টক শেষ", outOfStock, "০ পিস");

  if (input.modelCounts) {
    section("ব্যাকআপে থাকা মডেল");
    for (const [model, count] of Object.entries(input.modelCounts)) {
      line(model, count, "ব্যাকআপ মডেল");
    }
  }

  r += 1;
  ws.mergeCells(r, 1, r + 2, 3);
  const note = ws.getCell(r, 1);
  note.value =
    "আসল ব্যাকআপ হলো backups ফোল্ডারের maher-*.db ফাইল — রিস্টোর ওই ফাইল দিয়েই হয়। " +
    "এই Excel ফাইলে দোকানের অভ্যন্তরীণ খরচ ও IMEI আছে; কাস্টমারকে দেবেন না।";
  note.font = font(C.muted, false, 9);
  note.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  note.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: C.wash },
  };
  note.border = {
    top: { style: "thin", color: { argb: C.hairline } },
  };
  ws.getRow(r).height = 22;
  ws.getRow(r + 1).height = 22;
  ws.getRow(r + 2).height = 22;
}

function serviceColumns(): Column[] {
  return [
    { header: "ক্রম", width: 6, align: "right" },
    { header: "তারিখ", width: 11, align: "center", numFmt: dateFmt },
    { header: "কাস্টমার", width: 20 },
    { header: "ফোন", width: 14 },
    { header: "মডেল", width: 17 },
    { header: "সমস্যা", width: 28, wrap: true },
    { header: "টেকনিশিয়ান", width: 13 },
    { header: "অবস্থা", width: 11, align: "center" },
    { header: "বিল (৳)", width: 10, align: "right", numFmt: moneyFmt },
    { header: "জমা (৳)", width: 10, align: "right", numFmt: moneyFmt },
    { header: "বাকি (৳)", width: 10, align: "right", numFmt: moneyFmt },
    { header: "ডেলিভারি", width: 11, align: "center", numFmt: dateFmt },
    { header: "যাচাই", width: 8, align: "center" },
  ];
}

function serviceSheet(
  wb: ExcelJS.Workbook,
  services: BackupService[],
  s: Summary,
  brand: string
): void {
  const columns = serviceColumns();
  const ordered = [...services].sort((a, b) => {
    const byDate = dhakaDateKey(a.serviceDate).localeCompare(
      dhakaDateKey(b.serviceDate)
    );
    return byDate !== 0 ? byDate : a.id - b.id;
  });
  const rows = ordered.map((service, index) => [
    index + 1,
    serviceDate(service),
    service.customerName,
    service.phone,
    service.model,
    service.problem,
    service.technician,
    bnStatus(service.status),
    service.totalBill,
    service.advance,
    service.due,
    optionalDate(service.deliveryDate),
    service.verified ? "হ্যাঁ" : "",
  ]);

  const ws = tableSheet(
    wb,
    BACKUP_SHEETS.services,
    "সার্ভিস খাতা",
    "তারিখ অনুযায়ী পুরোনো থেকে নতুন · ফেরত সার্ভিস তালিকায় আছে, কিন্তু মোটে নেই · আর্কাইভ করা সার্ভিস অডিট শিটে",
    columns,
    rows,
    C.steel,
    brand
  );

  // Colour the two columns the shopkeeper scans first.
  if (rows.length > 0) {
    ordered.forEach((service, index) => {
      const row = ws.getRow(HEADER_ROW + 1 + index);
      row.getCell(8).font = font(statusColor(service.status), false, 10);
      if (service.due > 0) row.getCell(11).font = font(C.danger, true, 10);
    });

    const total = ws.getRow(HEADER_ROW + rows.length + 2);
    const values: (string | number)[] = [
      "মোট (সক্রিয়)",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      s.bill,
      s.advance,
      s.due,
      "",
      "",
    ];
    values.forEach((value, i) => {
      const cell = total.getCell(i + 1);
      cell.value = value;
      cell.font = font(C.navy, true, 10);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: C.wash },
      };
      cell.alignment = {
        vertical: "middle",
        horizontal: i === 0 ? "left" : columns[i].align ?? "left",
      };
      if (columns[i].numFmt) cell.numFmt = columns[i].numFmt;
      cell.border = {
        top: { style: "thin", color: { argb: C.hairline } },
        bottom: { style: "thin", color: { argb: C.hairline } },
      };
    });
    total.height = 22;
  }
}

function auditSheet(
  wb: ExcelJS.Workbook,
  services: BackupService[],
  brand: string
): void {
  const columns: Column[] = [
    { header: "id", width: 6, align: "right" },
    { header: "date", width: 11, align: "center" },
    { header: "customer", width: 20 },
    { header: "phone", width: 14 },
    { header: "model", width: 16 },
    { header: "technician", width: 13 },
    { header: "problem", width: 26 },
    { header: "solution", width: 30 },
    { header: "condition", width: 26 },
    { header: "status", width: 11 },
    { header: "bill", width: 9, align: "right" },
    { header: "advance", width: 9, align: "right" },
    { header: "due", width: 9, align: "right" },
    { header: "expense", width: 9 },
    { header: "expenseAmount", width: 12, align: "right" },
    { header: "partsShop", width: 14 },
    { header: "damageLoss", width: 11, align: "right" },
    { header: "damageNote", width: 18 },
    { header: "returnedAt", width: 20 },
    { header: "refundAmount", width: 12, align: "right" },
    { header: "refundNote", width: 18 },
    { header: "inspectionFee", width: 13, align: "right" },
    { header: "returnReason", width: 22 },
    { header: "expenseWrittenOff", width: 15 },
    { header: "imei", width: 16 },
    { header: "customerAddress", width: 22 },
    { header: "warranty", width: 14 },
    { header: "saleRef", width: 18 },
    { header: "groupId", width: 20 },
    { header: "deliveryDate", width: 12 },
    { header: "deliveredAt", width: 20 },
    { header: "verified", width: 9 },
    { header: "verifiedAt", width: 20 },
    { header: "partsCost", width: 12, align: "right" },
    { header: "archived", width: 9 },
    { header: "created", width: 20 },
    { header: "updated", width: 20 },
  ];

  const rows = [...services]
    .sort((a, b) => a.id - b.id)
    .map((s) => [
      s.id,
      dhakaDateKey(s.serviceDate),
      s.customerName,
      s.phone,
      s.model,
      s.technician,
      s.problem,
      s.solution ?? "",
      s.condition ?? "",
      s.status,
      s.totalBill,
      s.advance,
      s.due,
      s.shopExpense ?? "",
      s.expenseAmount,
      s.partsShop ?? "",
      s.damageLoss,
      s.damageNote ?? "",
      iso(s.returnedAt),
      s.refundAmount,
      s.refundNote ?? "",
      s.inspectionFee,
      s.returnReason ?? "",
      s.expenseWrittenOff ? "YES" : "",
      s.imei ?? "",
      s.customerAddress ?? "",
      s.warranty ?? "",
      s.saleRef ?? "",
      s.groupId ?? "",
      s.deliveryDate ? dhakaDateKey(s.deliveryDate) : "",
      iso(s.deliveredAt),
      s.verified ? "YES" : "",
      iso(s.verifiedAt),
      s.partsCost ?? 0,
      s.archived ? "YES" : "",
      iso(s.createdAt),
      iso(s.updatedAt),
    ]);

  tableSheet(
    wb,
    BACKUP_SHEETS.audit,
    "সম্পূর্ণ ডেটা (অডিট)",
    "সব সার্ভিসের কাঁচা ফিল্ড — CSV ব্যাকআপের সমান, কোনো তথ্য বাদ নেই",
    columns,
    rows,
    C.muted,
    brand
  );
}

/**
 * Internal parts purchase sheet. Deliberately kept OUT of the summary and the
 * customer-facing service sheet: `priceCode` is visible here because this is
 * the shopkeeper-only audit copy of the internal ledger.
 */
function partsSheet(
  wb: ExcelJS.Workbook,
  parts: BackupPart[],
  brand: string
): void {
  const columns: Column[] = [
    { header: "ক্রম", width: 6, align: "right" },
    { header: "সার্ভিস আইডি", width: 10, align: "right" },
    { header: "পার্টস", width: 26, wrap: true },
    { header: "SKU", width: 14 },
    { header: "পরিমাণ", width: 9, align: "right" },
    { header: "একক দাম (৳)", width: 12, align: "right", numFmt: moneyFmt },
    { header: "মোট (৳)", width: 12, align: "right", numFmt: moneyFmt },
    { header: "দোকান / সাপ্লায়ার", width: 20, wrap: true },
    { header: "মূল্য কোড", width: 13, align: "center" },
    { header: "কেনার তারিখ", width: 12, align: "center", numFmt: dateFmt },
    { header: "Paid?", width: 8, align: "center" },
    { header: "Paid সময়", width: 17, align: "center" },
    { header: "Paid নোট", width: 34, wrap: true },
    { header: "নোট", width: 24, wrap: true },
  ];

  const ordered = [...parts].sort((a, b) => {
    const aKey = a.purchaseDate
      ? dhakaDateKey(a.purchaseDate)
      : "9999-99-99";
    const bKey = b.purchaseDate
      ? dhakaDateKey(b.purchaseDate)
      : "9999-99-99";
    return aKey !== bKey ? aKey.localeCompare(bKey) : a.id - b.id;
  });

  const rows = ordered.map((part, index) => [
    index + 1,
    part.serviceId,
    part.nameSnapshot,
    part.skuSnapshot ?? "",
    part.quantity,
    part.unitCost,
    part.lineCost,
    part.supplier ?? "",
    part.priceCode ?? "",
    part.purchaseDate ? optionalDate(part.purchaseDate) : "",
    part.paidAt ? "হ্যাঁ" : "",
    part.paidAt ? dhakaStamp(part.paidAt) : "",
    part.paidNote ?? "",
    part.note ?? "",
  ]);

  const ws = tableSheet(
    wb,
    BACKUP_SHEETS.parts,
    "সার্ভিস পার্টস",
    "দোকানের অভ্যন্তরীণ পার্টসক্রয় খাতা · মূল্য কোড ও Paid ইতিহাসসহ · কাস্টমারকে দেবেন না",
    columns,
    rows,
    C.warn,
    brand
  );

  if (rows.length === 0) return;
  // Only lines with a known purchase date count in the money totals; a legacy
  // unknown-date row is listed for audit but never silently totalled.
  const known = ordered.filter((part) => part.purchaseDate !== null);
  const total = known.reduce((sum, part) => sum + part.lineCost, 0);
  const paid = known
    .filter((part) => part.paidAt !== null)
    .reduce((sum, part) => sum + part.lineCost, 0);
  const totalRow = ws.getRow(HEADER_ROW + rows.length + 2);
  const values: (string | number)[] = [
    "মোট (তারিখ আছে)",
    "",
    "",
    "",
    "",
    "",
    total,
    "",
    "",
    "",
    "",
    "",
    `Paid: ৳${paid} · Unpaid: ৳${total - paid}`,
    "",
  ];
  values.forEach((value, i) => {
    const cell = totalRow.getCell(i + 1);
    cell.value = value;
    cell.font = font(C.navy, true, 10);
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: C.wash },
    };
    cell.alignment = {
      vertical: "middle",
      horizontal: i === 12 ? "right" : "center",
    };
  });
}

export async function buildBackupWorkbook(
  input: BackupWorkbookInput
): Promise<Buffer> {
  const brand = input.shopName?.trim() || PLATFORM_BRAND.name;
  const wb = new ExcelJS.Workbook();
  wb.creator = brand;
  wb.title = `${brand} — ডেটা ব্যাকআপ`;
  wb.created = input.generatedAt;
  wb.modified = input.generatedAt;

  const stats = summarize(input.services);
  summarySheet(wb, input, stats);
  serviceSheet(wb, stats.live, stats, brand);
  partsSheet(wb, input.parts ?? [], brand);
  auditSheet(wb, input.services, brand);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
