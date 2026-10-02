import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/* Domain constants                                                     */
/* ------------------------------------------------------------------ */

export const TECHNICIANS = ["NURUL", "RONI", "ASRAFUL", "NAYEM"] as const;
export type Technician = (typeof TECHNICIANS)[number];

export const STATUSES = [
  "Pending",
  "In-Progress",
  "Completed",
  "Delivered",
] as const;
export type ServiceStatus = (typeof STATUSES)[number];

export const STATUS_BN: Record<ServiceStatus, string> = {
  Pending: "পেন্ডিং",
  "In-Progress": "চলছে",
  Completed: "সম্পন্ন",
  Delivered: "ডেলিভারি",
};

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
