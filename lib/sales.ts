/**
 * Shared sale/visit arithmetic.
 *
 * This module is pure (no Prisma, no React) so the form, the API routes and the
 * tests all use exactly one definition of:
 *  - how a visit total is built (device bills + product lines),
 *  - how one জমা advance is waterfall-allocated (devices first, products last),
 *  - what a price override note must look like,
 *  - how the sale-reference idempotency key is normalised.
 */

/** Largest number of device cards one visit can hold (API contract). */
export const MAX_VISIT_DEVICES = 8;

/** Largest number of product lines one visit can hold (matches stock.ts). */
export const MAX_VISIT_PRODUCT_LINES = 20;

/**
 * Splits one visit advance across rows in order. Each row receives at most its
 * own bill, so no row is ever overpaid and the group due is exactly
 * `visitTotal − advance`.
 *
 * Order is the contract: pass device bills first, then the product total.
 */
export function allocateVisitAdvance(bills: number[], advance: number): number[] {
  let remaining = Math.max(0, Math.floor(Number(advance) || 0));
  return bills.map((rawBill) => {
    const bill = Math.max(0, Math.floor(Number(rawBill) || 0));
    const share = Math.min(bill, remaining);
    remaining -= share;
    return share;
  });
}

/** Visit total = every device bill + every product line total. */
export function visitTotal(deviceBills: number[], productTotal: number): number {
  const devices = deviceBills.reduce(
    (sum, bill) => sum + Math.max(0, Math.floor(Number(bill) || 0)),
    0
  );
  return devices + Math.max(0, Math.floor(Number(productTotal) || 0));
}

/** Sum of product line totals (already discounted). */
export function productLinesTotal(
  lines: { lineTotal: number }[]
): number {
  return lines.reduce(
    (sum, line) => sum + Math.max(0, Math.floor(Number(line.lineTotal) || 0)),
    0
  );
}

/** Internal product cost of the sold (not returned) lines. */
export function productLinesCost(
  lines: { unitCost: number; quantity: number; returnedAt?: string | null }[]
): number {
  return lines.reduce((sum, line) => {
    if (line.returnedAt) return sum;
    const unit = Math.max(0, Math.floor(Number(line.unitCost) || 0));
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    return sum + unit * qty;
  }, 0);
}

/**
 * Client-generated idempotency key for a product-bearing submit. Kept opaque,
 * trimmed and bounded; a blank value means "no idempotency key".
 */
export function parseSaleRef(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > 80) {
    throw new Error("বিক্রয় রেফারেন্স ৮০ অক্ষরের বেশি হতে পারবে না");
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(text)) {
    throw new Error("বিক্রয় রেফারেন্সে শুধু অক্ষর, সংখ্যা ও - _ . : ব্যবহার করুন");
  }
  return text;
}

/**
 * A price override must say why. Returns NULL when the price is the product's
 * normal selling price, otherwise the trimmed reason.
 */
export function normalizePriceNote(
  value: unknown,
  required: boolean
): string | null {
  const text = String(value ?? "").trim();
  if (!text) {
    if (required) throw new Error("দাম বদলানোর কারণ লিখুন");
    return null;
  }
  if (text.length > 200) {
    throw new Error("দাম বদলানোর কারণ ২০০ অক্ষরের বেশি হতে পারবে না");
  }
  return text;
}
