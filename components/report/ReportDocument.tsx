import { dayLabel, dhakaDateKey } from "@/lib/dhaka";
import { formatTaka, STATUS_BN } from "@/lib/utils";
import { dailyBreakdown, summaryRows, type ReportData } from "@/lib/export";

const cell: React.CSSProperties = {
  border: "1px solid #E0E8F5",
  padding: "6px 10px",
  fontSize: 13,
};
const right: React.CSSProperties = { ...cell, textAlign: "right" };
const headCell: React.CSSProperties = {
  ...cell,
  background: "#F3F7FD",
  fontWeight: 700,
};

/* Detail table: 12 columns must fit one 720px sheet, so cells are 10px,
   fixed-width and ellipsized instead of wrapping. */
const detailCell: React.CSSProperties = {
  border: "1px solid #E0E8F5",
  padding: "3px 4px",
  fontSize: 10,
  lineHeight: 1.35,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const detailHead: React.CSSProperties = {
  ...detailCell,
  background: "#F3F7FD",
  fontWeight: 700,
};
const detailHeadRight: React.CSSProperties = {
  ...detailHead,
  textAlign: "right",
};
const detailRight: React.CSSProperties = { ...detailCell, textAlign: "right" };

/** Column widths sum to the 664px content width of the sheet. */
const DETAIL_COLS = [62, 34, 82, 66, 66, 96, 58, 46, 40, 38, 38, 38];
const DETAIL_HEADERS = [
  "তারিখ",
  "বিল নং",
  "কাস্টমার",
  "ফোন",
  "মডেল",
  "সমস্যা",
  "টেকনিশিয়ান",
  "অবস্থা",
  "বিল",
  "জমা",
  "বাকি",
  "ফেরত",
];
/** html2canvas rasterises the whole sheet; cap keeps a long report usable. */
const DETAIL_LIMIT = 1000;

/**
 * Print-friendly Bengali report sheet, rendered off-screen only (never in a
 * page) and captured by `createReportPdf`. Keeps the Premium Glossy palette
 * on white so the PDF reads like the app, and carries the same window as the
 * dialog (একদিন / তারিখ রেঞ্জ / সব তারিখ): totals + daily roll-up + rows.
 */
export function ReportDocument({ data }: { data: ReportData }) {
  const days = dailyBreakdown(data.rows);
  const detail = data.rows.slice(0, DETAIL_LIMIT);
  return (
    <div
      data-report-doc
      style={{
        width: "720px",
        padding: "28px",
        background: "#ffffff",
        color: "#17233D",
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 700 }}>
        MAHER MOBILE CARE — ওভারঅল রিপোর্ট
      </div>
      <div style={{ fontSize: 13, color: "#71819B", marginBottom: 16 }}>
        {data.from && data.to
          ? `${dayLabel(data.from)} – ${dayLabel(data.to)} • ${data.from} – ${data.to}`
          : data.label}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 18 }}>
        <tbody>
          {summaryRows(data.summary).map(([label, value]) => (
            <tr key={label}>
              <td style={cell}>{label}</td>
              <td style={{ ...right, fontWeight: 700 }}>
                {label.includes("কাজ") || label.includes("সংখ্যা")
                  ? `${value} টি`
                  : formatTaka(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
        দৈনিক ভাঙতি
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["তারিখ", "কাজ", "বিল", "জমা", "বাকি", "খরচ"].map((h, i) => (
              <th key={h} style={i === 0 ? headCell : { ...headCell, textAlign: "right" }}>
                {h}
              </th>
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
        </tbody>
      </table>

      <div style={{ fontSize: 15, fontWeight: 700, margin: "18px 0 6px" }}>
        কাস্টমার ডিটেইল রিপোর্ট
      </div>
      <table
        style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
      >
        <colgroup>
          {DETAIL_COLS.map((w, i) => (
            <col key={i} style={{ width: `${w}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {DETAIL_HEADERS.map((h, i) => (
              <th key={h} style={i >= 8 ? detailHeadRight : detailHead}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.map((r) => {
            const returned = r.status === "Returned";
            return (
              <tr key={r.id}>
                <td style={detailCell}>{dhakaDateKey(r.serviceDate)}</td>
                <td style={detailCell}>#{r.id}</td>
                <td style={detailCell}>{r.customerName}</td>
                <td style={detailCell}>{r.phone}</td>
                <td style={detailCell}>{r.model}</td>
                <td style={detailCell}>{r.problem}</td>
                <td style={detailCell}>{r.technician}</td>
                <td style={detailCell}>
                  {(STATUS_BN as Record<string, string>)[r.status] ?? r.status}
                </td>
                <td style={detailRight}>{formatTaka(r.totalBill)}</td>
                <td style={detailRight}>{formatTaka(r.advance)}</td>
                <td style={detailRight}>{formatTaka(r.due)}</td>
                <td style={detailRight}>
                  {returned && r.refundAmount > 0 ? formatTaka(r.refundAmount) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {data.rows.length > detail.length ? (
        <div style={{ marginTop: 4, fontSize: 10, color: "#71819B" }}>
          প্রথম {detail.length}টি রো দেখানো হয়েছে — বাকি{" "}
          {data.rows.length - detail.length}টি CSV/Excel ফাইলে আছে।
        </div>
      ) : null}

      <div style={{ marginTop: 18, fontSize: 11, color: "#71819B" }}>
        তৈরি: {new Date().toLocaleString("bn-BD")} • অফলাইন রিপোর্ট • মার্জিত
        খরচের বিস্তারিত আলাদা (প্রাইভেসি) • MAHER MOBILE CARE
      </div>
    </div>
  );
}
