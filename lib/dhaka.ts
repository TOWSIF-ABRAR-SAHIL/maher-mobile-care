/**
 * Asia/Dhaka (UTC+6, no DST) date helpers.
 *
 * Vercel serverless functions run on UTC. `new Date().getDate()` in an API
 * route would bucket "today" to the wrong calendar day for a Bangladesh
 * shop, so every day-boundary is computed explicitly in Dhaka time.
 */

export const DHAKA_TZ = "Asia/Dhaka";
const OFFSET = "+06:00";

const pad = (n: number) => String(n).padStart(2, "0");

function dhakaParts(date: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DHAKA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** True when `v` is a real calendar date in "YYYY-MM-DD" form.
 *  Rejects both malformed strings and impossible dates like 2026-02-31. */
export function isDateKey(v: string | null | undefined): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    y >= 100 &&
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** "YYYY-MM-DD" key of `date` in Dhaka time — for grouping documents. */
export function dhakaDateKey(date: Date | string | number): string {
  const d = new Date(date);
  const { y, m, d: day } = dhakaParts(d);
  return `${y}-${pad(m)}-${pad(day)}`;
}

/** [start, end) of an inclusive Dhaka date range "YYYY-MM-DD"→"YYYY-MM-DD". */
export function dhakaRangeBounds(dateFrom: string, dateTo: string): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(`${dateFrom}T00:00:00.000${OFFSET}`),
    end: new Date(`${dateTo}T23:59:59.999${OFFSET}`),
  };
}

/** Short label for a "YYYY-MM-DD" key, e.g. "30 Sep". */
export function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${d} ${months[(m ?? 1) - 1] ?? ""}`;
}

/** Shift a "YYYY-MM-DD" key by ±n days (pure UTC math, DST-safe). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** {from, to} of the calendar month containing "YYYY-MM-DD" (DST-safe). */
export function monthContaining(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1 + 1, 0)).getUTCDate();
  const mm = pad(m ?? 1);
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${pad(last)}` };
}

/** Shift a "YYYY-MM-DD" key by ±n calendar months, clamped to month end. */
export function shiftMonth(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 2000, ((m ?? 1) - 1) + n, 1));
  const last = new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const day = Math.min(d ?? 1, last);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(day)}`;
}

/** Midday Dhaka on the given YYYY-MM-DD — safely inside the day's bounds. */
export function serviceDateFromKey(key: string): Date {
  // isDateKey also rejects impossible dates (2026-99-99, 2026-02-31) that
  // would otherwise become an Invalid Date and blow up inside Prisma.
  if (!isDateKey(key)) {
    throw new Error("Invalid date (expected YYYY-MM-DD)");
  }
  return new Date(`${key}T12:00:00.000${OFFSET}`);
}
