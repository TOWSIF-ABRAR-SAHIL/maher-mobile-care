import type { StockMovementType, StockStatus } from "./types";
import { parseBnNumber } from "./utils";

/* ------------------------------------------------------------------ */
/* Stock status                                                        */
/* ------------------------------------------------------------------ */

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  in: "স্টকে আছে",
  low: "কম স্টক",
  out: "স্টক নেই",
};

/**
 * Out = 0. Low = above zero but at/below the product's threshold. In = above
 * the threshold. Computed in one place so the API, the table and the sale
 * picker can never disagree.
 */
export function stockStatus(stock: number, threshold: number): StockStatus {
  const qty = Math.max(0, Math.trunc(Number(stock) || 0));
  if (qty === 0) return "out";
  if (qty <= Math.max(0, Math.trunc(Number(threshold) || 0))) return "low";
  return "in";
}

/* ------------------------------------------------------------------ */
/* Stock movements                                                     */
/* ------------------------------------------------------------------ */

export const MOVEMENT_TYPES: StockMovementType[] = [
  "OPENING",
  "STOCK_IN",
  "STOCK_OUT",
  "ADJUSTMENT",
  "SALE",
  "RETURN",
];

export const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  OPENING: "ওপেনিং",
  STOCK_IN: "স্টক ইন",
  STOCK_OUT: "স্টক আউট",
  ADJUSTMENT: "সমন্বয়",
  SALE: "বিক্রয়",
  RETURN: "ফেরত",
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Matches every user-facing error thrown by this module. */
export const INVENTORY_VALIDATION_PATTERN =
  /আবশ্যক|দিন|বাছুন|সঠিক|ঋণাত্মক|বেশি|আগেই|ব্যবহার|আছে|নেই|করা যাবে না|ভুল ডেটা/;

export function isInventoryValidationError(err: unknown): boolean {
  return err instanceof Error && INVENTORY_VALIDATION_PATTERN.test(err.message);
}

export class InventoryConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryConflictError";
  }
}

/** Prisma's unique-constraint code, without importing the error class. */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "P2002"
  );
}

const MAX_AMOUNT = 2_147_483_647;
const MAX_NAME_LENGTH = 120;
const MAX_SKU_LENGTH = 80;
const MAX_BARCODE_LENGTH = 80;
const MAX_BRAND_LENGTH = 80;
const MAX_SUPPLIER_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 1000;

function readBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("ভুল ডেটা পাঠানো হয়েছে");
  }
  return body as Record<string, unknown>;
}

/** Required trimmed text with a per-field maximum. */
export function requiredInventoryText(
  value: unknown,
  label: string,
  max = MAX_NAME_LENGTH
): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} দিন`);
  if (text.length > max) {
    throw new Error(`${label} ${max} অক্ষরের বেশি হতে পারবে না`);
  }
  return text;
}

export function optionalInventoryText(
  value: unknown,
  label: string,
  max: number
): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > max) {
    throw new Error(`${label} ${max} অক্ষরের বেশি হতে পারবে না`);
  }
  return text;
}

/** Whole, non-negative amount. Bengali digits are accepted. */
export function parseInventoryInt(
  value: unknown,
  label: string,
  { min = 0 }: { min?: number } = {}
): number {
  let parsed: number | null;
  if (typeof value === "number") {
    parsed = Number.isFinite(value) ? value : null;
  } else {
    parsed = parseBnNumber(value);
  }
  if (parsed === null) {
    throw new Error(`${label} সঠিক সংখ্যা দিন`);
  }
  const floored = Math.floor(parsed);
  if (floored < min) {
    throw new Error(min === 0 ? `${label} ঋণাত্মক হতে পারে না` : `${label} সঠিক সংখ্যা দিন`);
  }
  if (!Number.isSafeInteger(floored) || floored > MAX_AMOUNT) {
    throw new Error(`${label} অনেক বড়`);
  }
  return floored;
}

/** Optional non-negative integer; blank → `fallback`. */
export function parseOptionalInventoryInt(
  value: unknown,
  label: string,
  fallback: number
): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  return parseInventoryInt(value, label);
}

/** Case-insensitive category identity: trim + lowercase. */
export function categoryNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** SKUs/barcodes are stored uppercase so SQLite's UNIQUE is case-insensitive. */
export function normalizeCode(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : null;
}

export interface ValidatedCategory {
  name: string;
  nameKey: string;
}

export function validateCategoryName(value: unknown): ValidatedCategory {
  const name = requiredInventoryText(value, "ক্যাটাগরির নাম", 80);
  return { name, nameKey: categoryNameKey(name) };
}

export interface ValidatedProduct {
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: number;
  brand: string | null;
  description: string | null;
  supplier: string | null;
  sellingPrice: number;
  purchasePrice: number;
  lowStockThreshold: number;
}

export interface ValidatedProductCreate extends ValidatedProduct {
  openingStock: number;
}

function parseProductCore(raw: Record<string, unknown>): ValidatedProduct {
  const categoryId = parseInventoryInt(raw.categoryId, "ক্যাটাগরি", { min: 1 });
  return {
    name: requiredInventoryText(raw.name, "প্রোডাক্টের নাম"),
    sku: normalizeCode(raw.sku),
    barcode: normalizeCode(raw.barcode),
    categoryId,
    brand: optionalInventoryText(raw.brand, "ব্র্যান্ড", MAX_BRAND_LENGTH),
    description: optionalInventoryText(
      raw.description,
      "বিবরণ",
      MAX_DESCRIPTION_LENGTH
    ),
    supplier: optionalInventoryText(
      raw.supplier,
      "সাপ্লায়ার",
      MAX_SUPPLIER_LENGTH
    ),
    sellingPrice: parseInventoryInt(raw.sellingPrice, "বিক্রয় মূল্য"),
    purchasePrice: parseOptionalInventoryInt(
      raw.purchasePrice,
      "ক্রয় মূল্য",
      0
    ),
    lowStockThreshold: parseOptionalInventoryInt(
      raw.lowStockThreshold,
      "কম স্টক সীমা",
      3
    ),
  };
}

/** Create body: `openingStock` is required and starts the stock ledger. */
export function validateProductCreate(body: unknown): ValidatedProductCreate {
  const raw = readBody(body);
  const core = parseProductCore(raw);
  const openingStock = parseInventoryInt(raw.openingStock, "ওপেনিং স্টক");
  return { ...core, openingStock };
}

/** Update body: stock is intentionally absent — only movements change it. */
export function validateProductUpdate(body: unknown): ValidatedProduct {
  return parseProductCore(readBody(body));
}

/** Stock operation body (used by the stock dialog / API in phase B). */
export interface ValidatedStockOperation {
  movementType: "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";
  quantity: number;
  reason: string | null;
}

export function validateStockOperation(body: unknown): ValidatedStockOperation {
  const raw = readBody(body);
  const kind = String(raw.type ?? "").trim();
  if (kind !== "in" && kind !== "out" && kind !== "adjustment") {
    throw new Error("সঠিক স্টক অপারেশন বাছুন");
  }
  const reason = optionalInventoryText(raw.reason, "কারণ", 300);
  if (kind === "adjustment") {
    const target = parseInventoryInt(raw.quantity, "নতুন স্টক");
    return { movementType: "ADJUSTMENT", quantity: target, reason };
  }
  const quantity = parseInventoryInt(raw.quantity, "পরিমাণ", { min: 1 });
  return {
    movementType: kind === "in" ? "STOCK_IN" : "STOCK_OUT",
    quantity,
    reason,
  };
}

export {
  MAX_AMOUNT as MAX_INVENTORY_AMOUNT,
  MAX_SKU_LENGTH,
  MAX_BARCODE_LENGTH,
};
