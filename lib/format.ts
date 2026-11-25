/**
 * Display formatting for the on-screen workspace.
 *
 * The shop reads Latin digits on screen — prices, counts, dates — while the
 * printed receipt and the monthly report keep Bengali digits. Month and
 * weekday names stay Bengali so a date still reads naturally.
 */
import { BN_MONTHS, BN_WEEKDAYS, isDateKey } from "./dhaka";

/** Full Bengali date with Latin digits, e.g. "শনিবার, 24 অক্টোবর 2026". */
export function latinDateLabel(key: string): string {
  if (!isDateKey(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${BN_WEEKDAYS[weekday]}, ${d} ${BN_MONTHS[m - 1]} ${y}`;
}
