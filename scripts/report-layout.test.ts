/* Report export layout contract — runs with `npx tsx --test` and needs no DB:
 *   npx tsx --test scripts/report-layout.test.ts
 * Every assertion here describes the organised file shape the desk expects.
 */
import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS, { type Row } from "exceljs";

import {
  buildReportCsv,
  buildReportXlsx,
  dailyBreakdown,
  paginate,
  reportStatus,
  sortedReportRows,
  type ReportData,
} from "../lib/export";
import type { MonthlySummary, ServiceDTO } from "../lib/types";

const summary: MonthlySummary = {
  count: 3, bill: 10950, advance: 4950, expense: 0, due: 6000,
  profit: 10950, productCost: 0, damageLoss: 0, refund: 900, returnedCount: 1,
};

const row = (id: number, date: string, extra: Partial<ServiceDTO> = {}) =>
  ({
    id, serviceDate: `${date}T12:00:00+06:00`, customerName: `Customer ${id}`,
    phone: "01711111111", model: "Model", problem: "Problem", technician: "NURUL",
    status: "In-Progress", totalBill: 1000 + id, advance: 500 + id, due: 500,
    refundAmount: 0, deliveredAt: null, ...extra,
  }) as ServiceDTO;

const data: ReportData = {
  from: "2026-11-15", to: "2026-11-18", label: "2026-11-15 – 2026-11-18",
  stamp: "2026-11-15_2026-11-18", summary,
  generatedAt: "2026-11-18T10:00:00.000Z",
  shopName: "Dynamic Report Shop",
  rows: [
    row(1, "2026-11-18", { status: "Delivered" }),
    row(4, "2026-11-15", { status: "Returned", refundAmount: 900 }),
    row(3, "2026-11-17"),
    row(2, "2026-11-18", { customerName: "Karim, =SUM(A1)", status: "Completed" }),
  ],
};

test("detail rows run newest day first, then highest id first", () => {
  assert.deepEqual(sortedReportRows(data.rows).map((r) => r.id), [2, 1, 3, 4]);
});

test("daily roll-up drops a returned-only day with no active work", () => {
  const days = dailyBreakdown(data.rows);
  assert.deepEqual(days.map((d) => d.date), ["2026-11-18", "2026-11-17"]);
  assert.deepEqual(days.map((d) => d.count), [2, 1]);
});

test("status labels are Bengali in every export", () => {
  assert.equal(reportStatus("Delivered"), "ডেলিভারি");
  assert.equal(reportStatus("In-Progress"), "চলছে");
  assert.equal(reportStatus("Returned"), "ফেরত");
  assert.equal(reportStatus("Unknown"), "Unknown");
});

test("CSV is Excel-safe and keeps the same section order", async () => {
  const bytes = new Uint8Array(await buildReportCsv(data).arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM must lead the file");
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  assert.ok(!/(^|[^\r])\n/.test(text.replace(/\r\n/g, "")), "lines must use CRLF");
  const lines = text.split("\r\n").filter(Boolean);
  const headings = ["Dynamic Report Shop", "তারিখ পরিসীমা", "সারাংশ", "দৈনিক ভাঙতি", "কাস্টমার ডিটেইল", "তৈরি:"];
  let cursor = -1;
  for (const h of headings) {
    const at = lines.findIndex((l, i) => i > cursor && l.includes(h));
    assert.ok(at > cursor, `missing/out-of-order section: ${h}`);
    cursor = at;
  }
  assert.ok(lines.every((l) => /^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/.test(l)),
    "every CSV cell must be quoted");
  const detail = lines.filter((l) => /^"\d+","2026-/.test(l));
  assert.deepEqual(detail.map((l) => JSON.parse(`[${l}]`)[0]), ["2", "1", "3", "4"]);
  assert.ok(lines.some((l) => l.includes('"ডেলিভারি"')), "status must be Bengali");
});

test("an unconfigured shop falls back to the MSS platform title", async () => {
  const bytes = new Uint8Array(await buildReportCsv({ ...data, shopName: "  " }).arrayBuffer());
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  assert.ok(text.includes('"MSS — ওভারঅল রিপোর্ট"'), "MSS must headline a fresh shop");
  assert.ok(!text.includes("MAHER MOBILE CARE"), "legacy shop name must never return");
});

test("CSV detail totals reconcile with active money, not returned audit rows", async () => {
  const bytes = new Uint8Array(await buildReportCsv(data).arrayBuffer());
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const lines = text.split("\r\n");
  const totalLine = lines.find((l) => l.includes('"মোট"') && l.split(",").length === 15);
  assert.ok(totalLine, "detail totals row missing");
  const cells = JSON.parse(`[${totalLine}]`) as string[];
  const active = data.rows.filter((r) => r.status !== "Returned");
  assert.equal(cells[8], String(active.reduce((s, r) => s + r.totalBill, 0)));
  assert.equal(cells[9], String(active.reduce((s, r) => s + r.advance, 0)));
  assert.equal(cells[10], String(active.reduce((s, r) => s + r.due, 0)));
  assert.equal(cells[11], "900", "refund stays in its own column");
});

test("Excel detail totals reconcile with the same active money", async () => {
  const blob = await buildReportXlsx(data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  const detail = wb.getWorksheet("সার্ভিস")!;
  let totalRow: Row | undefined;
  detail.eachRow((row) => { if (row.getCell(1).value === "মোট") totalRow = row; });
  assert.ok(totalRow, "detail totals row missing");
  const active = data.rows.filter((r) => r.status !== "Returned");
  assert.equal(totalRow!.getCell(9).value, active.reduce((s, r) => s + r.totalBill, 0));
  assert.equal(totalRow!.getCell(10).value, active.reduce((s, r) => s + r.advance, 0));
  assert.equal(totalRow!.getCell(11).value, active.reduce((s, r) => s + r.due, 0));
  assert.equal(totalRow!.getCell(12).value, 900);
});

test("Excel sheets have titles, frozen headers, readable widths and a totals row", async () => {
  const blob = await buildReportXlsx(data);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await blob.arrayBuffer());
  assert.deepEqual(wb.worksheets.map((s) => s.name), ["সারাংশ", "দৈনিক ভাঙতি", "সার্ভিস"]);
  for (const sheet of wb.worksheets) {
    assert.ok(String(sheet.getCell("A1").value)?.length, `${sheet.name} needs a title`);
    assert.ok(sheet.getColumn(2).width && sheet.getColumn(2).width! > 8, `${sheet.name} needs column widths`);
  }
  const detail = wb.getWorksheet("সার্ভিস")!;
  assert.equal(detail.views[0]?.state, "frozen", "detail header must stay visible");
  assert.deepEqual([5, 6, 7, 8].map((n) => detail.getCell(`A${n}`).value), [2, 1, 3, 4]);
  assert.equal(detail.getCell("H5").value, "সম্পন্ন", "Bengali status in detail sheet");
  let hasTotal = false;
  detail.eachRow((row) => { if (row.getCell(1).value === "মোট") hasTotal = true; });
  assert.ok(hasTotal, "totals row at the foot");
});

test("PDF pages split on section boundaries", () => {
  const pages = paginate(Array.from({ length: 55 }, (_, i) => i + 1), 30);
  assert.deepEqual(pages.map((p) => p.length), [30, 25]);
  assert.deepEqual(pages[1].slice(0, 3), [31, 32, 33]);
});
