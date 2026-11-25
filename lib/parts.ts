/**
 * Per-device repair parts — shared, client-safe rules.
 *
 * A device may itemize the parts it consumed (name, quantity, price, supplier,
 * purchase date). When it does, the parts total IS that device's repair cost
 * and `Service.expenseAmount` (the lump shop-expense code) is ignored for
 * খরচ/লাভ. When it does not, the lump keeps working exactly as before. One
 * cost per device, never both — and a written-off return cancels whichever is
 * used.
 *
 * Parts money is internal: no receipt, PDF or customer copy may show a part
 * name, price or total. Nothing here touches bill/advance/due.
 *
 * The line's price travels as ONE field (`price`): the shopkeeper may type a
 * plain amount or a keypad code exactly like দোকান খরচ. A plain amount is
 * converted to a canonical code on save (`1200` → `*A#`), a typed code stays
 * exactly as typed, and the server always derives `lineCost` itself.
 *
 * Pure by design (no Prisma import) so the form, the table and the report
 * exporters can share it. Database helpers live in `parts-data.ts`.
 */
import { normalizeShopExpense } from "./expense-code";
import type { CipherConfig } from "./secret-code";
import { isDateKey, serviceDateFromKey } from "./dhaka";
import {
  optionalInventoryText,
  parseInventoryInt,
  requiredInventoryText,
} from "./inventory";

export const MAX_PARTS_PER_DEVICE = 8;
export const MAX_PART_NAME_LENGTH = 80;
export const MAX_PART_SKU_LENGTH = 80;
export const MAX_PART_SUPPLIER_LENGTH = 100;
export const MAX_PART_NOTE_LENGTH = 200;
export const MAX_PART_PAID_NOTE_LENGTH = 1000;
export const MAX_PART_QUANTITY = 999;
export const MAX_PART_UNIT_COST = 1_000_000;

/** What the API accepts for one part line (already JSON-decoded). */
export interface PartInput {
  /** Existing row id on an edit; omitted for a brand-new line. */
  id?: number | null;
  productId?: number | null;
  name: string;
  sku?: string | null;
  quantity: number;
  /** Plain amount ("1500") or keypad code ("*J#") — one field. */
  price?: unknown;
  /** Legacy alias for `price`; only older callers use it. */
  unitCost?: unknown;
  supplier?: string | null;
  note?: string | null;
  /** Purchase day as "YYYY-MM-DD". Required for a new line. */
  purchaseDate?: string | null;
  /** "DAMAGED" from the entry form; every other value means "USED". */
  partStatus?: unknown;
}

/** What the server persists for one part line. */
export interface ValidatedPart {
  /** Existing row id, or null for a new line. Never written as a column. */
  id: number | null;
  productId: number | null;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
  supplier: string | null;
  /** Normalized supplier identity (trim + lowercase), or null. */
  supplierKey: string | null;
  /** Canonical keypad code (plain amounts converted), or null when no price. */
  priceCode: string | null;
  note: string | null;
  /** Stored as a day key first; resolved to a Date by `normalizePart`. */
  purchaseDateKey: string | null;
  purchaseDate: Date | null;
  /** Only USED/DAMAGED come from the form; stock/return states need the
   *  audited নিষ্পত্তি dialog, so they are never accepted here. */
  partStatus: "USED" | "DAMAGED";
}

export interface PartsNormalizeOptions {
  /**
   * `true` (create) requires supplier + purchase date on every line.
   * `false` (edit) lets a line that carries an existing `id` omit them — the
   * database merge keeps the previous values. A line without an id is always
   * treated as new and must supply both.
   */
  requirePurchaseInfo?: boolean;
  /** Active secret-code cipher from ShopSettings; defaults to the keypad map. */
  cipher?: CipherConfig;
}

function optionalProductId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInventoryInt(value, "প্রোডাক্ট", { min: 1 });
  return parsed > 0 ? parsed : null;
}

/** Supplier identity shared with the purchase ledger. */
export function partSupplierKey(name: string | null | undefined): string | null {
  const text = String(name ?? "").trim().toLowerCase();
  return text || null;
}

function isBlankPartRow(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  const blank = (value: unknown) =>
    value === undefined || value === null || String(value).trim() === "";
  return (
    !optionalId(row.id) &&
    blank(row.name) &&
    blank(row.sku) &&
    blank(row.quantity) &&
    blank(row.price) &&
    blank(row.unitCost) &&
    blank(row.supplier) &&
    blank(row.note) &&
    blank(row.purchaseDate)
  );
}

function optionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseInventoryInt(value, "পার্টস আইডি", { min: 1 });
  return parsed > 0 ? parsed : null;
}

/**
 * Validate one part line and compute its cost. `lineCost` is always derived
 * here (quantity × price) — a client-sent value is ignored so a stale or
 * hostile payload can never inject a cost the shop did not type.
 */
export function normalizePart(
  raw: unknown,
  options: PartsNormalizeOptions = {}
): ValidatedPart {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("পার্টসের তথ্য সঠিকভাবে দিন");
  }
  const row = raw as Record<string, unknown>;
  const id = optionalId(row.id);
  const requireInfo = options.requirePurchaseInfo !== false || id === null;

  const nameSnapshot = requiredInventoryText(
    row.name,
    "পার্টসের নাম",
    MAX_PART_NAME_LENGTH
  );
  const quantity = parseInventoryInt(row.quantity, "পার্টসের পরিমাণ", {
    min: 1,
  });
  if (quantity > MAX_PART_QUANTITY) {
    throw new Error(
      `পার্টসের পরিমাণ ${MAX_PART_QUANTITY}-এর বেশি হতে পারবে না`
    );
  }

  // One price field: a plain amount is encoded into a canonical code
  // (`1200` → `*A#`), exactly like দোকান খরচ; a typed code stays as typed.
  const decoded = normalizeShopExpense(
    row.price !== undefined && row.price !== null
      ? row.price
      : row.unitCost,
    options.cipher
  );
  if (decoded.kind === "empty") {
    throw new Error("পার্টসের দাম দিন");
  }
  if (decoded.kind === "invalid" || decoded.amount === null) {
    throw new Error(decoded.error ?? "পার্টসের দাম সঠিকভাবে দিন");
  }
  const unitCost = decoded.amount;
  if (unitCost > MAX_PART_UNIT_COST) {
    throw new Error(
      `পার্টসের দাম ${MAX_PART_UNIT_COST}-এর বেশি হতে পারবে না`
    );
  }
  const lineCost = quantity * unitCost;
  if (!Number.isSafeInteger(lineCost)) {
    throw new Error("পার্টসের মোট দাম অনেক বড়");
  }
  // `stored` is the canonical code for a plain number, the typed code as-is
  // for a code, and null for empty/invalid input (already rejected above).
  const priceCode = decoded.stored;

  const supplierText = String(row.supplier ?? "").trim();
  let supplier: string | null;
  if (!supplierText) {
    if (requireInfo) {
      throw new Error("পার্টস কেনার দোকান বা সাপ্লায়ার দিন");
    }
    supplier = null;
  } else {
    supplier = requiredInventoryText(
      row.supplier,
      "পার্টসের দোকান",
      MAX_PART_SUPPLIER_LENGTH
    );
  }

  let purchaseDateKey: string | null = null;
  const dateText = String(row.purchaseDate ?? "").trim();
  if (!dateText) {
    if (requireInfo) {
      throw new Error("পার্টস কেনার তারিখ দিন");
    }
  } else if (!isDateKey(dateText)) {
    throw new Error("সঠিক পার্টস কেনার তারিখ দিন");
  } else {
    purchaseDateKey = dateText;
  }

  return {
    id,
    productId: optionalProductId(row.productId),
    nameSnapshot,
    skuSnapshot: optionalInventoryText(
      row.sku,
      "পার্টসের SKU",
      MAX_PART_SKU_LENGTH
    ),
    quantity,
    unitCost,
    lineCost,
    supplier,
    supplierKey: partSupplierKey(supplier),
    priceCode,
    note: optionalInventoryText(row.note, "পার্টসের নোট", MAX_PART_NOTE_LENGTH),
    purchaseDateKey,
    purchaseDate: purchaseDateKey ? serviceDateFromKey(purchaseDateKey) : null,
    partStatus: row.partStatus === "DAMAGED" ? "DAMAGED" : "USED",
  };
}

/**
 * Validate a whole parts list. An empty list means "no parts"; fully blank
 * rows (the empty row the form always shows) are simply dropped, while a
 * partially filled row is an error so half a purchase is never saved.
 */
export function normalizeParts(
  raw: unknown,
  options: PartsNormalizeOptions = {}
): ValidatedPart[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("পার্টসের তালিকা সঠিকভাবে দিন");
  }
  const rows = raw.filter((row) => !isBlankPartRow(row));
  if (rows.length > MAX_PARTS_PER_DEVICE) {
    throw new Error(
      `একটি ডিভাইসে ${MAX_PARTS_PER_DEVICE}টির বেশি পার্টস যোগ করা যাবে না`
    );
  }
  return rows.map((row) => normalizePart(row, options));
}

export function partsTotal(parts: readonly { lineCost: number }[]): number {
  return parts.reduce(
    (sum, part) => sum + Math.max(0, Math.round(part.lineCost || 0)),
    0
  );
}

/** `serviceId → parts cost`, built once per request (never an N+1 query). */
export type PartsCostLookup = Map<number, number>;

/**
 * Cost for one device row, or `null` when the lookup has no entry.
 *
 * `null` means "this device has no parts" and must not be confused with a
 * parts total of 0 (a free part), which correctly wins over the lump code.
 */
export function partsCostOf(
  lookup: PartsCostLookup,
  serviceId: number
): number | null {
  return lookup.has(serviceId) ? lookup.get(serviceId)! : null;
}

/**
 * The single cost rule used by খরচ/লাভ everywhere:
 *
 *  - `expenseWrittenOff` → 0 (a return cancelled the cost, parts or lump)
 *  - parts exist         → their lineCost sum (even when it is 0)
 *  - otherwise           → the decoded shop-expense amount
 */
export function effectiveRepairCost(
  row: { expenseAmount: number; expenseWrittenOff?: boolean | null },
  partsCost: number | null
): number {
  if (row.expenseWrittenOff) return 0;
  if (partsCost !== null) return Math.max(0, Math.round(partsCost || 0));
  return Math.max(0, Math.round(row.expenseAmount || 0));
}

/**
 * True when a device has both an itemized cost and a shop-expense code. The
 * code stays on the row for audit but never counts; the form and the খরচ cell
 * explain this instead of failing the save.
 */
export function partsOverrideLump(
  partsCost: number | null,
  expenseAmount: number
): boolean {
  return partsCost !== null && expenseAmount > 0;
}
