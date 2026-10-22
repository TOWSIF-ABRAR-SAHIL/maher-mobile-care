import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Domain constants                                                     */
/* ------------------------------------------------------------------ */

/**
 * Pre-v1.1 hardcoded roster, kept ONLY as a fallback for when the technician
 * list request fails, plus the type alias. The live list lives in the database
 * (prisma `Technician` model) and is fetched from /api/technicians.
 */
export const FALLBACK_TECHNICIANS = ["NURUL", "RONI", "ASRAFUL", "NAYEM"] as const;
export type Technician = string;

/** The normal job flow. "Returned" is deliberately not here: the table's
 *  status badge advances through these four stages only. */
export const FLOW_STATUSES = [
  "Pending",
  "In-Progress",
  "Completed",
  "Delivered",
] as const;

export const RETURNED_STATUS = "Returned" as const;

/** Every status the UI can display/filter, including the terminal return. */
export const STATUSES = [...FLOW_STATUSES, RETURNED_STATUS] as const;
export type ServiceStatus = (typeof STATUSES)[number];

export const STATUS_BN: Record<ServiceStatus, string> = {
  Pending: "পেন্ডিং",
  "In-Progress": "চলছে",
  Completed: "সম্পন্ন",
  Delivered: "ডেলিভারি",
  Returned: "ফেরত",
};

export function isReturned(status: string): boolean {
  return status === RETURNED_STATUS;
}

/* ------------------------------------------------------------------ */
/* Numbers: Bengali digits in, integers out                             */
/* ------------------------------------------------------------------ */

const BN_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

/**
 * Parse a user-typed amount that may contain Bengali digits (১৬০০),
 * commas, spaces or ৳. Returns a non-negative integer, or null when the
 * text is not a pure number (e.g. a part code like "*M#").
 */
export function parseBnNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s
    .split("")
    .map((ch) => BN_DIGITS[ch] ?? ch)
    .join("");
  s = s.replace(/[,\s৳]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** বাকি = মোট বিল − জমা (never negative). */
export function computeDue(totalBill: number, advance: number): number {
  return Math.max(0, Math.round(totalBill || 0) - Math.round(advance || 0));
}

/* ------------------------------------------------------------------ */
/* Formatting (Western digits, matching the shop's existing style)      */
/* ------------------------------------------------------------------ */

export function formatTaka(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `৳${v.toLocaleString("en-IN")}`;
}

export function formatNum(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString("en-IN");
}

const BN_OUT_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

/** Bengali digits for the live code badge, e.g. 1500 -> "১৫০০". */
export function toBnDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BN_OUT_DIGITS[Number(d)]);
}

/** Badge-only formatter. The rest of the app keeps its Western digits. */
export function formatTakaBn(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `৳${toBnDigits(v)}`;
}
