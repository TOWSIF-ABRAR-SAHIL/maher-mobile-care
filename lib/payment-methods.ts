/**
 * Client-safe payment vocabulary: method codes/labels and the customer key.
 * Kept apart from `lib/payments.ts` so UI components never import Prisma or
 * the stock service layer into the browser bundle.
 */

export const PAYMENT_METHODS = ["CASH", "BKASH", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "নগদ",
  BKASH: "বিকাশ",
  OTHER: "অন্য",
};

/** Digits only — spaces, dashes and +880 prefixes all collapse away. */
export function phoneDigits(phone: unknown): string {
  return String(phone ?? "").replace(/\D+/g, "");
}

/**
 * Stable customer identity. A phone with any digit identifies the customer by
 * those digits; a phone-less slip falls back to its exact (trimmed) name.
 */
export function customerKey(phone: unknown, customerName: unknown): string {
  const digits = phoneDigits(phone);
  if (digits) return digits;
  return `name:${String(customerName ?? "").trim()}`;
}

export function isSameCustomer(
  row: { phone: string; customerName: string },
  key: string
): boolean {
  return customerKey(row.phone, row.customerName) === key;
}
