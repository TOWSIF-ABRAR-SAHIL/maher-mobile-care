import type { ReactNode } from "react";
import { dhakaDateKey } from "@/lib/dhaka";
import { PLATFORM_BRAND } from "@/lib/shop";
import { formatTaka } from "@/lib/utils";
import {
  DAILY_HEADERS,
  DETAIL_HEADERS,
  REPORT_PRIVACY_NOTE,
  dailyBreakdown,
  detailTotals,
  paginate,
  reportStatus,
  sortedReportRows,
  summaryRows,
  type DailyRow,
  type ReportData,
} from "@/lib/export";
import type { ServiceDTO } from "@/lib/types";

/* Counter Ledger tokens. The PDF is a printed page, so only ink, hairline and
 * the quiet surface fill appear — no gradients, badges or decorative rules. */
const INK = "#1F2A36";
const MUTED = "#5E6B78";
const NAVY = "#223D57";
const HAIRLINE = "#D9E0E7";
const QUIET = "#F3F5F7";
const DANGER = "#B23A3A";

const cell: React.CSSProperties = {
  border: `1px solid ${HAIRLINE}`,
  padding: "4px 8px",
  fontSize: 12,
};
const right: React.CSSProperties = { ...cell, textAlign: "right" };
const head: React.CSSProperties = {
  ...cell,
  background: QUIET,
  fontWeight: 700,
  color: NAVY,
};
const headRight: React.CSSProperties = { ...head, textAlign: "right" };
const totalCell: React.CSSProperties = {
  ...cell,
  background: QUIET,
  fontWeight: 700,
};
const totalRight: React.CSSProperties = { ...totalCell, textAlign: "right" };

/* Detail columns fill the 668px content box of a 720px sheet. Fixed widths +
 * ellipsis keep a long Bengali model from pushing the money columns off. */
const DETAIL_COLS = [44, 58, 84, 70, 74, 68, 84, 46, 35, 35, 35, 35];
const DETAIL_LIMIT = 1000;
const DAILY_PER_PAGE = 18;
const DETAIL_PER_PAGE = 26;

const pageStyle: React.CSSProperties = {
  width: 720,
  height: 1050,
  boxSizing: "border-box",
  padding: "26px 26px 44px",
  background: "#ffffff",
  color: INK,
  lineHeight: 1.45,
  position: "relative",
  overflow: "hidden",
};

const detailCell: React.CSSProperties = {
  ...cell,
  padding: "2px 3px",
  fontSize: 10,
  lineHeight: 1.3,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const detailHead: React.CSSProperties = {
  ...detailCell,
  background: QUIET,
  fontWeight: 700,
  color: NAVY,
};
const detailRight: React.CSSProperties = { ...detailCell, textAlign: "right" };

const SectionTitle = ({ children }: { children: ReactNode }) => (
  <div style={{ fontSize: 14, fontWeight: 700, color: NAVY, margin: "14px 0 6px" }}>
    {children}
  </div>
);

function SummaryTable({ data }: { data: ReportData }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {summaryRows(data.summary).map(([label, value]) => (
          <tr key={label}>
            <td style={cell}>{label}</td>
            <td style={right}>
              {label.includes("কাজ") || label.includes("সংখ্যা")
                ? `${value} টি`
                : formatTaka(value)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DailyTable({ days, total }: { days: DailyRow[]; total: boolean }) {
  const sums = DAILY_HEADERS.slice(1).map((_, i) =>
    days.reduce((sum, d) => sum + [d.count, d.bill, d.advance, d.due, d.expense][i], 0)
  );
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {DAILY_HEADERS.map((h, i) => (
            <th key={h} style={i === 0 ? head : headRight}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.date}>
            <td style={cell}>{d.date}</td>
            <td style={right}>{d.count}</td>
            <td style={right}>{formatTaka(d.bill)}</td>
            <td style={right}>{formatTaka(d.advance)}</td>
            <td style={right}>{formatTaka(d.due)}</td>
            <td style={right}>{formatTaka(d.expense)}</td>
          </tr>
        ))}
        {total ? (
          <tr>
            <td style={totalCell}>মোট</td>
            {sums.map((v, i) => (
              <td key={i} style={totalRight}>{i === 0 ? v : formatTaka(v)}</td>
            ))}
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function DetailTable({
  rows,
  total,
}: {
  rows: ServiceDTO[];
  total: boolean;
}) {
  const money = detailTotals(rows);
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <colgroup>
        {DETAIL_COLS.map((w, i) => <col key={i} style={{ width: `${w}px` }} />)}
      </colgroup>
      <thead>
        <tr>
          {DETAIL_HEADERS.slice(0, DETAIL_COLS.length).map((h, i) => (
            <th key={h} style={i >= 8 ? detailHead : { ...detailHead, textAlign: "left" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={detailCell}>#{r.id}</td>
            <td style={detailCell}>{dhakaDateKey(r.serviceDate)}</td>
            <td style={detailCell}>{r.customerName}</td>
            <td style={detailCell}>{r.phone}</td>
            <td style={detailCell}>{r.model}</td>
            <td style={detailCell}>{r.technician}</td>
            <td style={detailCell}>{r.problem}</td>
            <td style={detailCell}>{reportStatus(r.status)}</td>
            <td style={detailRight}>{formatTaka(r.totalBill)}</td>
            <td style={detailRight}>{formatTaka(r.advance)}</td>
            <td style={detailRight}>{formatTaka(r.due)}</td>
            <td style={detailRight}>
              {r.status === "Returned" && r.refundAmount > 0
                ? formatTaka(r.refundAmount)
                : "—"}
            </td>
          </tr>
        ))}
        {total ? (
          <tr>
            <td style={{ ...detailCell, background: QUIET, fontWeight: 700 }} colSpan={8}>
              মোট
            </td>
            {money.map((v, i) => (
              <td key={i} style={{ ...detailRight, background: QUIET, fontWeight: 700 }}>
                {formatTaka(v)}
              </td>
            ))}
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

/**
 * Print-friendly Bengali report sheet, rendered off-screen only and captured
 * one page at a time by `createReportPdf`. Totals, daily roll-up and detail
 * rows share the same order and are paginated on section boundaries, so a
 * row is never sliced across two sheets and every page repeats its heading.
 */
export function ReportDocument({ data }: { data: ReportData }) {
  const brand = data.shopName?.trim() || PLATFORM_BRAND.name;
  const days = dailyBreakdown(data.rows);
  const detail = sortedReportRows(data.rows).slice(0, DETAIL_LIMIT);
  const dailyPages = paginate(days, DAILY_PER_PAGE);
  const detailPages = paginate(detail, DETAIL_PER_PAGE);
  const hasDaily = days.length > 0;

  const bodies: ReactNode[] = [];
  bodies.push(
    <>
      <div style={{ fontSize: 18, fontWeight: 700, color: NAVY }}>
        {brand}
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>
        ওভারঅল রিপোর্ট • {data.from && data.to ? `${data.from} – ${data.to}` : data.label}
      </div>
      <SectionTitle>সারাংশ</SectionTitle>
      <SummaryTable data={data} />
      {hasDaily ? (
        <>
          <SectionTitle>দৈনিক ভাঙতি</SectionTitle>
          <DailyTable days={dailyPages[0]} total={dailyPages.length === 1} />
        </>
      ) : (
        <>
          <SectionTitle>কাস্টমার ডিটেইল রিপোর্ট</SectionTitle>
          <DetailTable rows={detailPages[0]} total={detailPages.length === 1} />
        </>
      )}
    </>
  );

  for (let i = 1; i < dailyPages.length; i++) {
    bodies.push(
      <>
        <SectionTitle>দৈনিক ভাঙতি (চলতি)</SectionTitle>
        <DailyTable days={dailyPages[i]} total={i === dailyPages.length - 1} />
      </>
    );
  }

  const detailStart = hasDaily ? 0 : 1;
  const truncated = data.rows.length - detail.length;
  for (let i = detailStart; i < detailPages.length; i++) {
    const last = i === detailPages.length - 1;
    bodies.push(
      <>
        <SectionTitle>কাস্টমার ডিটেইল রিপোর্ট</SectionTitle>
        <DetailTable rows={detailPages[i]} total={last} />
        {last && truncated > 0 ? (
          <div style={{ marginTop: 6, fontSize: 10, color: MUTED }}>
            প্রথম {detail.length}টি রো PDF-এ আছে — বাকি {truncated}টি CSV/Excel ফাইলে দেখুন।
          </div>
        ) : null}
      </>
    );
  }

  const total = bodies.length;
  return (
    <div data-report-doc>
      {bodies.map((body, i) => (
        <div key={i} data-report-page style={pageStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              borderBottom: `1px solid ${HAIRLINE}`,
              paddingBottom: 6,
              marginBottom: 10,
              fontSize: 10,
              color: MUTED,
            }}
          >
            <span style={{ fontWeight: 700, color: NAVY }}>{brand}</span>
            <span>ওভারঅল রিপোর্ট • {data.label}</span>
          </div>
          {body}
          <div
            style={{
              position: "absolute",
              left: 26,
              right: 26,
              bottom: 14,
              borderTop: `1px solid ${HAIRLINE}`,
              paddingTop: 6,
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              fontSize: 9,
              color: MUTED,
            }}
          >
            <span style={{ maxWidth: 520 }}>
              <strong style={{ color: DANGER }}>
                অভ্যন্তরীণ — কাস্টমারকে দেবেন না।{" "}
              </strong>
              {REPORT_PRIVACY_NOTE}
            </span>
            <span>
              তৈরি: {new Date(data.generatedAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })} • পৃষ্ঠা {i + 1}/{total}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
