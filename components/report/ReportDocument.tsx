import { dayLabel } from "@/lib/dhaka";
import { formatTaka } from "@/lib/utils";
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

/**
 * Print-friendly Bengali report sheet, rendered off-screen only (never in a
 * page) and captured by `createReportPdf`. Keeps the Premium Glossy palette
 * on white so the PDF reads like the app.
 */
export function ReportDocument({ data }: { data: ReportData }) {
  const days = dailyBreakdown(data.rows);
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
        {dayLabel(data.from)} – {dayLabel(data.to)} • {data.from} – {data.to}
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

      <div style={{ marginTop: 18, fontSize: 11, color: "#71819B" }}>
        তৈরি: {new Date().toLocaleString("bn-BD")} • অফলাইন রিপোর্ট • মার্জিত
        খরচের বিস্তারিত আলাদা (প্রাইভেসি) • MAHER MOBILE CARE
      </div>
    </div>
  );
}
