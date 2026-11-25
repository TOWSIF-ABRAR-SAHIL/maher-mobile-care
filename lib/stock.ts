/**
 * Stock + product-sale service layer.
 *
 * ALL stock writes go through this module. The ledger (`StockMovement`) is
 * append-only: a sale decrements `Product.stock`, a return increments it, and
 * every change records previous/new stock so history explains itself.
 *
 * Money rules:
 * - A product line's bill is `unitPrice × quantity − discount`.
 * - `advanceAllocated` is the part of the visit's জমা that paid this line
 *   (waterfall order). Returning a line refunds exactly that much cash.
 * - `buyPrice` / `unitCost` are internal snapshots and never leave the shop.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "./prisma";
import { computeDue, parseBnNumber } from "./utils";
import {
  categoryNameKey,
  InventoryConflictError,
  optionalInventoryText,
  parseInventoryInt,
  parseOptionalInventoryInt,
  requiredInventoryText,
} from "./inventory";

type Tx = Prisma.TransactionClient;

/* ------------------------------------------------------------------ */
/* Request parsing                                                     */
/* ------------------------------------------------------------------ */

export const MAX_PRODUCT_LINES = 20;

/** One requested product line, before product snapshots are resolved. */
export interface ProductLineInput {
  /** Existing `SaleItem` id — only sent by the edit dialog. */
  id?: number;
  /** Tracked product id, or null for a one-off untracked line. */
  productId: number | null;
  /** Required only for untracked lines. */
  name: string | null;
  quantity: number;
  /** NULL = use the tracked product's selling price. */
  unitPrice: number | null;
  discount: number;
  /** Required when a tracked product's price is overridden. */
  priceNote?: string | null;
  /** Edit-only hint: reopen a previously returned line. */
  reopen?: boolean;
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ভুল ডেটা পাঠানো হয়েছে");
  }
  return value as Record<string, unknown>;
}

/** Parses/normalizes the `products` array sent by the form or API. */
export function parseProductLines(raw: unknown): ProductLineInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("প্রোডাক্ট লাইন সঠিকভাবে দিন");
  if (raw.length === 0) return [];
  if (raw.length > MAX_PRODUCT_LINES) {
    throw new Error(
      `একবারে সর্বোচ্চ ${MAX_PRODUCT_LINES}টি প্রোডাক্ট লাইন সেভ করা যাবে`
    );
  }
  return raw.map((entry, index) => {
    const row = readObject(entry);
    const label = `লাইন ${index + 1}`;
    const idRaw = row.id;
    let id: number | undefined;
    if (idRaw !== undefined && idRaw !== null && String(idRaw).trim() !== "") {
      id = parseInventoryInt(idRaw, "লাইন আইডি", { min: 1 });
    }

    const productRaw = row.productId;
    let productId: number | null = null;
    if (
      productRaw !== undefined &&
      productRaw !== null &&
      String(productRaw).trim() !== ""
    ) {
      productId = parseInventoryInt(productRaw, "প্রোডাক্ট", { min: 1 });
    }

    const name = productId
      ? null
      : requiredInventoryText(row.name, "প্রোডাক্টের নাম", 120);

    // unitPrice may be omitted for a tracked product (defaults to its selling
    // price in the DB step). Untracked lines must state a price.
    let unitPrice: number | null = null;
    const priceRaw = row.unitPrice;
    if (
      priceRaw !== undefined &&
      priceRaw !== null &&
      String(priceRaw).trim() !== ""
    ) {
      unitPrice = parseInventoryInt(priceRaw, `${label}এর দাম`);
    } else if (!productId) {
      throw new Error(`${label}এর দাম দিন`);
    }

    const quantity = parseInventoryInt(row.quantity, `${label}এর পরিমাণ`, {
      min: 1,
    });
    const discount = parseOptionalInventoryInt(
      row.discount,
      `${label}এর ছাড়`,
      0
    );
    if (unitPrice !== null && discount > unitPrice * quantity) {
      throw new Error(`${label}এর ছাড় লাইনমোটের বেশি হতে পারে না`);
    }

    return {
      ...(id ? { id } : {}),
      productId,
      name,
      quantity,
      unitPrice,
      discount,
      priceNote: optionalInventoryText(row.priceNote, "দাম বদলানোর কারণ", 200),
      ...(row.reopen === true ? { reopen: true } : {}),
    };
  });
}

export interface ValidatedRestock {
  quantity: number;
  purchasePrice: number | null;
  reason: string | null;
}

export function validateRestock(body: unknown): ValidatedRestock {
  const raw = readObject(body);
  const quantity = parseInventoryInt(raw.quantity, "পরিমাণ", { min: 1 });
  let purchasePrice: number | null = null;
  if (
    raw.purchasePrice !== undefined &&
    raw.purchasePrice !== null &&
    String(raw.purchasePrice).trim() !== ""
  ) {
    purchasePrice = parseInventoryInt(raw.purchasePrice, "ক্রয় মূল্য");
  }
  return {
    quantity,
    purchasePrice,
    reason: optionalInventoryText(raw.reason, "কারণ", 300),
  };
}

export interface ValidatedAdjust {
  stock: number;
  reason: string | null;
}

export function validateAdjust(body: unknown): ValidatedAdjust {
  const raw = readObject(body);
  return {
    stock: parseInventoryInt(raw.stock, "নতুন স্টক"),
    reason: optionalInventoryText(raw.reason, "কারণ", 300),
  };
}

/* ------------------------------------------------------------------ */
/* Transaction retry (SQLite busy)                                     */
/* ------------------------------------------------------------------ */

function isBusyError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : String((err as { message?: string })?.message ?? "");
  return /SQLITE_BUSY|database is locked|database table is locked/i.test(message);
}

/** Runs one stock operation in a transaction, retrying a short lock. */
export async function withStockTransaction<T>(
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(fn);
    } catch (err) {
      if (!isBusyError(err) || attempt === 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  // Unreachable — kept for TypeScript's benefit.
  throw new Error("স্টক লেনদেন সম্পন্ন হয়নি");
}

/* ------------------------------------------------------------------ */
/* Ledger primitives                                                   */
/* ------------------------------------------------------------------ */

interface MovementMeta {
  movementType: "SALE" | "RETURN" | "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";
  reason: string | null;
  saleItemId?: number | null;
  refType?: string | null;
  refId?: number | null;
  unitCost?: number | null;
  unitPrice?: number | null;
  note?: string | null;
}

/**
 * Atomically moves stock by `delta` and returns the before/after quantities.
 * A decrement that would go below zero fails inside the UPDATE itself — there
 * is no read-then-write window a concurrent sale could slip through.
 */
async function moveStock(
  tx: Tx,
  productId: number,
  delta: number
): Promise<{ previous: number; next: number }> {
  if (delta === 0) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { stock: true },
    });
    return { previous: product.stock, next: product.stock };
  }
  const rows = await tx.$queryRaw<{ stock: number }[]>`
    UPDATE "Product"
    SET "stock" = "stock" + ${delta}
    WHERE "id" = ${productId}
      AND "archived" = 0
      AND "stock" + ${delta} >= 0
    RETURNING "stock"`;
  if (rows.length === 0) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { name: true, stock: true, archived: true },
    });
    if (!product || product.archived) {
      throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
    }
    throw new InventoryConflictError(
      `"${product.name}" এর স্টক যথেষ্ট নয় (আছে ${product.stock})`
    );
  }
  const next = Number(rows[0].stock);
  return { previous: next - delta, next };
}

async function writeMovement(
  tx: Tx,
  productId: number,
  delta: number,
  stock: { previous: number; next: number },
  meta: MovementMeta
): Promise<void> {
  await tx.stockMovement.create({
    data: {
      productId,
      movementType: meta.movementType,
      quantity: delta,
      previousStock: stock.previous,
      newStock: stock.next,
      // New movements always leave this NULL: the legacy dedupe index then
      // permits repeat sale/return cycles for the same product.
      relatedServiceId: null,
      saleItemId: meta.saleItemId ?? null,
      refType: meta.refType ?? null,
      refId: meta.refId ?? null,
      unitCost: meta.unitCost ?? null,
      unitPrice: meta.unitPrice ?? null,
      note: meta.note ?? null,
      reason: meta.reason,
    },
  });
}

interface PreparedLine {
  productId: number | null;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  unitCost: number;
  buyPrice: number | null;
  priceNote: string | null;
}

async function prepareLine(
  tx: Tx,
  input: ProductLineInput
): Promise<PreparedLine> {
  let nameSnapshot = input.name ?? "";
  let skuSnapshot: string | null = null;
  let unitPrice = input.unitPrice ?? 0;
  let unitCost = 0;
  let buyPrice: number | null = null;
  let priceNote = input.priceNote ?? null;

  if (input.productId) {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: {
        name: true,
        sku: true,
        sellingPrice: true,
        purchasePrice: true,
        archived: true,
      },
    });
    if (!product || product.archived) {
      throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
    }
    nameSnapshot = product.name;
    skuSnapshot = product.sku;
    // Blank price in the picker falls back to the shop's selling price.
    if (input.unitPrice === null) unitPrice = product.sellingPrice;
    // A price different from the shelf price is an override and must say why.
    if (unitPrice !== product.sellingPrice && !priceNote) {
      throw new Error(
        `"${product.name}" এর দাম বদলানোর কারণ লিখুন`
      );
    }
    unitCost = Math.max(0, product.purchasePrice);
    buyPrice = Math.max(0, product.purchasePrice);
  }

  const lineTotal = unitPrice * input.quantity - input.discount;
  if (lineTotal < 0) throw new Error("লাইনমোট ঋণাত্মক হতে পারে না");

  return {
    productId: input.productId,
    nameSnapshot: nameSnapshot.trim(),
    skuSnapshot,
    quantity: input.quantity,
    unitPrice,
    discount: input.discount,
    lineTotal,
    unitCost,
    buyPrice,
    priceNote,
  };
}

/** Creates one SaleItem, deducts tracked stock and writes the SALE movement. */
async function insertSaleLine(
  tx: Tx,
  serviceId: number,
  prepared: PreparedLine
): Promise<{ id: number; lineTotal: number }> {
  const item = await tx.saleItem.create({
    data: {
      serviceId,
      productId: prepared.productId,
      kind: "PRODUCT",
      nameSnapshot: prepared.nameSnapshot,
      skuSnapshot: prepared.skuSnapshot,
      quantity: prepared.quantity,
      unitPrice: prepared.unitPrice,
      discount: prepared.discount,
      lineTotal: prepared.lineTotal,
      unitCost: prepared.unitCost,
      buyPrice: prepared.buyPrice,
      priceNote: prepared.priceNote,
    },
    select: { id: true, lineTotal: true },
  });

  if (prepared.productId) {
    const stock = await moveStock(tx, prepared.productId, -prepared.quantity);
    await writeMovement(tx, prepared.productId, -prepared.quantity, stock, {
      movementType: "SALE",
      reason: "প্রোডাক্ট বিক্রয়",
      saleItemId: item.id,
      refType: "SALE_ITEM",
      refId: item.id,
      unitCost: prepared.unitCost,
      unitPrice: prepared.unitPrice,
    });
  }
  return item;
}

/* ------------------------------------------------------------------ */
/* Anchor bookkeeping                                                  */
/* ------------------------------------------------------------------ */

/**
 * Recomputes the anchor bill from its active lines and re-runs the জমা
 * waterfall. Returned lines keep their historical `advanceAllocated` (the cash
 * that was refunded) and are skipped.
 */
async function syncAnchorTotals(tx: Tx, serviceId: number): Promise<void> {
  const anchor = await tx.service.findUniqueOrThrow({
    where: { id: serviceId },
    select: { advance: true },
  });
  const items = await tx.saleItem.findMany({
    where: { serviceId },
    orderBy: { id: "asc" },
  });
  const active = items.filter((item) => !item.returnedAt);
  const totalBill = active.reduce((sum, item) => sum + item.lineTotal, 0);
  const advance = Math.min(Math.max(0, anchor.advance), totalBill);

  let remaining = advance;
  for (const item of active) {
    const allocated = Math.min(item.lineTotal, remaining);
    remaining -= allocated;
    if (allocated !== item.advanceAllocated) {
      await tx.saleItem.update({
        where: { id: item.id },
        data: { advanceAllocated: allocated },
      });
    }
  }

  await tx.service.update({
    where: { id: serviceId },
    data: { totalBill, advance, due: computeDue(totalBill, advance) },
  });
}

/* ------------------------------------------------------------------ */
/* Public operations                                                   */
/* ------------------------------------------------------------------ */

/** Total of the lines as they would be prepared right now (read-only). */
export async function quoteProductTotal(
  tx: Tx,
  lines: ProductLineInput[]
): Promise<number> {
  if (lines.length === 0) return 0;
  const prepared = await Promise.all(lines.map((line) => prepareLine(tx, line)));
  return prepared.reduce((sum, line) => sum + line.lineTotal, 0);
}

export interface CreateProductSaleInput {
  customerName: string;
  phone: string;
  /** Visit-level delivery address, copied onto the product bill holder. */
  customerAddress?: string | null;
  serviceDate: Date;
  groupId: string | null;
  /** জমা paid specifically for the product part of the visit. */
  advance: number;
  /** Client idempotency key, stored on the sale anchor. */
  saleRef?: string | null;
  /** Customer terms from the visit, copied onto the product anchor. */
  condition?: string | null;
  lines: ProductLineInput[];
}

/**
 * Creates the single non-device bill holder for a visit plus its sale lines.
 * Must run inside the caller's transaction so devices, anchor and stock moves
 * commit together.
 */
export async function createProductSale(
  tx: Tx,
  input: CreateProductSaleInput
): Promise<{ serviceId: number; totalBill: number; items: number }> {
  if (input.lines.length === 0) {
    throw new Error("অন্তত একটি প্রোডাক্ট দিন");
  }
  const prepared = await Promise.all(
    input.lines.map((line) => prepareLine(tx, line))
  );
  const totalBill = prepared.reduce((sum, line) => sum + line.lineTotal, 0);
  if (input.advance > totalBill) {
    throw new Error("জমা মোট বিলের বেশি হতে পারে না");
  }

  const anchor = await tx.service.create({
    data: {
      customerName: input.customerName,
      phone: input.phone,
      customerAddress: input.customerAddress ?? null,
      // The list/receipt still need human-readable text; the anchor is not a
      // repair job, so it carries the first item name and a fixed description.
      model: prepared[0].nameSnapshot.slice(0, 120) || "প্রোডাক্ট বিক্রয়",
      technician: "",
      problem: "প্রোডাক্ট বিক্রয়",
      totalBill,
      advance: input.advance,
      due: computeDue(totalBill, input.advance),
      status: "Delivered",
      entryKind: "PRODUCT",
      groupId: input.groupId,
      condition: input.condition ?? null,
      saleRef: input.saleRef ?? null,
      serviceDate: input.serviceDate,
      deliveredAt: new Date(),
    },
    select: { id: true },
  });

  for (const line of prepared) {
    await insertSaleLine(tx, anchor.id, line);
  }
  await syncAnchorTotals(tx, anchor.id);

  return { serviceId: anchor.id, totalBill, items: prepared.length };
}

/** Adds product lines to an existing anchor (edit mode). */
export async function addProductLines(
  tx: Tx,
  serviceId: number,
  lines: ProductLineInput[]
): Promise<void> {
  for (const line of lines) {
    const prepared = await prepareLine(tx, line);
    await insertSaleLine(tx, serviceId, prepared);
  }
  await syncAnchorTotals(tx, serviceId);
}

/** Puts a sold line back into stock and records the return movement. */
async function restockLine(
  tx: Tx,
  item: {
    id: number;
    productId: number | null;
    quantity: number;
    unitCost: number;
    unitPrice: number;
  },
  kind: string,
  damaged: boolean
): Promise<boolean> {
  if (!item.productId || damaged) {
    await tx.saleItem.update({
      where: { id: item.id },
      data: {
        returnedAt: new Date(),
        restockedAt: null,
        returnKind: kind,
      },
    });
    return false;
  }
  const stock = await moveStock(tx, item.productId, item.quantity);
  await writeMovement(tx, item.productId, item.quantity, stock, {
    movementType: "RETURN",
    reason: damaged ? "ড্যামেজসহ ফেরত" : "বিক্রয় ফেরত",
    saleItemId: item.id,
    refType: "SALE_ITEM",
    refId: item.id,
    unitCost: item.unitCost,
    unitPrice: item.unitPrice,
    note: kind,
  });
  await tx.saleItem.update({
    where: { id: item.id },
    data: {
      returnedAt: new Date(),
      restockedAt: new Date(),
      returnKind: kind,
    },
  });
  return true;
}

export interface ReturnLineResult {
  refund: number;
  restocked: boolean;
  serviceId: number;
}

/** Returns one product line (full quantity only). */
export async function returnProductLine(
  tx: Tx,
  saleItemId: number,
  kind: "CANCEL" | "RETURN",
  damaged: boolean
): Promise<ReturnLineResult> {
  const item = await tx.saleItem.findUnique({ where: { id: saleItemId } });
  if (!item) throw new InventoryConflictError("বিক্রয় লাইন পাওয়া যায়নি");
  if (item.returnedAt) {
    throw new InventoryConflictError("এই লাইন আগেই ফেরত দেওয়া হয়েছে");
  }

  const restocked = await restockLine(tx, item, kind, damaged);
  const refund = Math.max(0, item.advanceAllocated);

  const anchor = await tx.service.findUniqueOrThrow({
    where: { id: item.serviceId },
    select: { advance: true, refundAmount: true },
  });
  const nextAdvance = Math.max(0, anchor.advance - refund);
  await tx.service.update({
    where: { id: item.serviceId },
    data: {
      advance: nextAdvance,
      refundAmount: anchor.refundAmount + refund,
    },
  });
  await syncAnchorTotals(tx, item.serviceId);

  return { refund, restocked, serviceId: item.serviceId };
}

/**
 * Refund choice "yes": every active product line of a visit goes back to stock.
 * Used when a repair device is returned and the customer also returns the
 * products bought in the same visit. Returned lines keep their historical
 * `advanceAllocated` and are skipped, so this is safe to call twice.
 */
export async function returnEntryProducts(
  tx: Tx,
  groupId: string
): Promise<{ lines: number; refund: number }> {
  const anchors = await tx.service.findMany({
    where: { groupId, entryKind: "PRODUCT", archived: false },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  let lines = 0;
  let refund = 0;
  for (const anchor of anchors) {
    const items = await tx.saleItem.findMany({
      where: { serviceId: anchor.id, returnedAt: null },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    for (const item of items) {
      const result = await returnProductLine(tx, item.id, "RETURN", false);
      lines += 1;
      refund += result.refund;
    }
  }
  return { lines, refund };
}

/** Re-sells a previously returned line (undo return): stock is deducted again. */export async function reopenProductLine(
  tx: Tx,
  saleItemId: number
): Promise<{ serviceId: number }> {
  const item = await tx.saleItem.findUnique({ where: { id: saleItemId } });
  if (!item) throw new InventoryConflictError("বিক্রয় লাইন পাওয়া যায়নি");
  if (!item.returnedAt) return { serviceId: item.serviceId };

  if (item.productId && item.restockedAt) {
    const stock = await moveStock(tx, item.productId, -item.quantity);
    await writeMovement(tx, item.productId, -item.quantity, stock, {
      movementType: "SALE",
      reason: "ফেরত বাতিল — আবার বিক্রয়",
      saleItemId: item.id,
      refType: "SALE_ITEM",
      refId: item.id,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
    });
  }

  const anchor = await tx.service.findUniqueOrThrow({
    where: { id: item.serviceId },
    select: { advance: true, refundAmount: true },
  });
  const previouslyPaid = Math.max(0, item.advanceAllocated);
  await tx.service.update({
    where: { id: item.serviceId },
    data: {
      advance: anchor.advance + previouslyPaid,
      refundAmount: Math.max(0, anchor.refundAmount - previouslyPaid),
    },
  });
  await tx.saleItem.update({
    where: { id: item.id },
    data: { returnedAt: null, restockedAt: null, returnKind: null },
  });
  await syncAnchorTotals(tx, item.serviceId);
  return { serviceId: item.serviceId };
}

/** Cancels a whole product-sale entry: every active line goes back to stock. */
export async function cancelProductEntry(
  tx: Tx,
  serviceId: number,
  damaged: boolean
): Promise<{ refund: number; lines: number }> {
  const anchor = await tx.service.findUnique({ where: { id: serviceId } });
  if (!anchor) throw new InventoryConflictError("এন্ট্রি পাওয়া যায়নি");
  if (anchor.entryKind !== "PRODUCT") {
    throw new InventoryConflictError("এই এন্ট্রি প্রোডাক্ট বিক্রয় নয়");
  }
  if (anchor.status === "Returned") {
    throw new InventoryConflictError("এই এন্ট্রি আগেই বাতিল হয়েছে");
  }

  const items = await tx.saleItem.findMany({
    where: { serviceId, returnedAt: null },
    orderBy: { id: "asc" },
  });
  for (const item of items) {
    await restockLine(tx, item, "CANCEL", damaged);
  }

  const refund = Math.max(0, anchor.advance);
  await tx.service.update({
    where: { id: serviceId },
    data: {
      totalBill: 0,
      advance: 0,
      due: 0,
      status: "Returned",
      returnedAt: new Date(),
      deliveredAt: null,
      refundAmount: anchor.refundAmount + refund,
    },
  });
  return { refund, lines: items.length };
}

/**
 * Archives a product entry: active lines are restocked (the goods came back)
 * and marked ARCHIVE so a later restore can deduct them again.
 */
export async function archiveProductEntry(
  tx: Tx,
  serviceId: number
): Promise<void> {
  const items = await tx.saleItem.findMany({
    where: { serviceId, returnedAt: null },
  });
  for (const item of items) {
    await restockLine(tx, item, "ARCHIVE", false);
  }
}

/** Restores an archived product entry: its ARCHIVE-returned lines sell again. */
export async function restoreProductEntry(
  tx: Tx,
  serviceId: number
): Promise<void> {
  const items = await tx.saleItem.findMany({
    where: { serviceId, returnKind: "ARCHIVE" },
    orderBy: { id: "asc" },
  });
  for (const item of items) {
    if (item.productId) {
      const stock = await moveStock(tx, item.productId, -item.quantity);
      await writeMovement(tx, item.productId, -item.quantity, stock, {
        movementType: "SALE",
        reason: "এন্ট্রি পুনরুদ্ধার",
        saleItemId: item.id,
        refType: "SALE_ITEM",
        refId: item.id,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
      });
    }
    await tx.saleItem.update({
      where: { id: item.id },
      data: { returnedAt: null, restockedAt: null, returnKind: null },
    });
  }
  await syncAnchorTotals(tx, serviceId);
}

/**
 * Edit-dialog line editor. Existing active lines can change quantity/price;
 * returned lines can be reopened; omitted active lines are cancelled and new
 * lines are sold. One transaction, one consistent ledger.
 */
export async function editProductLines(
  tx: Tx,
  serviceId: number,
  lines: ProductLineInput[]
): Promise<void> {
  const anchor = await tx.service.findUnique({ where: { id: serviceId } });
  if (!anchor) throw new InventoryConflictError("এন্ট্রি পাওয়া যায়নি");

  const existing = await tx.saleItem.findMany({
    where: { serviceId },
    orderBy: { id: "asc" },
  });
  const byId = new Map(existing.map((item) => [item.id, item]));
  const keep = new Set<number>();

  for (const line of lines) {
    if (!line.id) {
      const prepared = await prepareLine(tx, line);
      await insertSaleLine(tx, serviceId, prepared);
      continue;
    }
    const item = byId.get(line.id);
    if (!item) throw new InventoryConflictError("বিক্রয় লাইন পাওয়া যায়নি");
    keep.add(item.id);

    const prepared = await prepareLine(tx, {
      ...line,
      // Keep the original product identity; quantity/price are what change.
      productId: line.productId ?? item.productId,
      name: line.name ?? item.nameSnapshot,
      priceNote: line.priceNote ?? item.priceNote,
    });

    if (item.returnedAt) {
      if (!line.reopen) {
        // A returned line sent back unchanged stays returned.
        keep.add(item.id);
        continue;
      }
      // Undo the refund allocation before re-selling.
      const previouslyPaid = Math.max(0, item.advanceAllocated);
      const current = await tx.service.findUniqueOrThrow({
        where: { id: serviceId },
        select: { advance: true, refundAmount: true },
      });
      await tx.service.update({
        where: { id: serviceId },
        data: {
          advance: current.advance + previouslyPaid,
          refundAmount: Math.max(0, current.refundAmount - previouslyPaid),
        },
      });
      if (item.productId && item.restockedAt) {
        const stock = await moveStock(tx, item.productId, -item.quantity);
        await writeMovement(tx, item.productId, -item.quantity, stock, {
          movementType: "SALE",
          reason: "ফেরত বাতিল — আবার বিক্রয়",
          saleItemId: item.id,
          refType: "SALE_ITEM",
          refId: item.id,
          unitCost: item.unitCost,
          unitPrice: item.unitPrice,
        });
      }
      await tx.saleItem.update({
        where: { id: item.id },
        data: { returnedAt: null, restockedAt: null, returnKind: null },
      });
    }

    // Align stock with the new quantity.
    if (prepared.productId) {
      const delta = item.quantity - prepared.quantity;
      if (delta !== 0) {
        const stock = await moveStock(tx, prepared.productId, delta);
        await writeMovement(tx, prepared.productId, delta, stock, {
          movementType: delta > 0 ? "RETURN" : "SALE",
          reason: "বিক্রয় লাইন সংশোধন",
          saleItemId: item.id,
          refType: "SALE_ITEM",
          refId: item.id,
          unitCost: prepared.unitCost,
          unitPrice: prepared.unitPrice,
        });
      }
    }

    await tx.saleItem.update({
      where: { id: item.id },
      data: {
        nameSnapshot: prepared.nameSnapshot,
        skuSnapshot: prepared.skuSnapshot,
        quantity: prepared.quantity,
        unitPrice: prepared.unitPrice,
        discount: prepared.discount,
        lineTotal: prepared.lineTotal,
        unitCost: prepared.unitCost,
        buyPrice: prepared.buyPrice,
        priceNote: prepared.priceNote,
      },
    });
  }

  // Active lines the dialog no longer lists are cancelled.
  for (const item of existing) {
    if (keep.has(item.id) || item.returnedAt) continue;
    await restockLine(tx, item, "CANCEL", false);
  }

  await syncAnchorTotals(tx, serviceId);
}

/* ------------------------------------------------------------------ */
/* Stock operations (restock / adjust / ledger)                        */
/* ------------------------------------------------------------------ */

/**
 * Materialises a supplier purchase: bumps stock, refreshes the product's last
 * purchase price, and writes one STOCK_IN movement linked to the purchase.
 * The purchase row itself is created by `lib/purchases.ts`.
 */
export async function receivePurchaseStock(
  tx: Tx,
  productId: number,
  quantity: number,
  unitCost: number,
  purchaseId: number
): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { archived: true },
  });
  if (!product || product.archived) {
    throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
  }
  // "Cost = last purchase price" — sale snapshots read this field later.
  await tx.product.update({
    where: { id: productId },
    data: { purchasePrice: unitCost },
  });
  const stock = await moveStock(tx, productId, quantity);
  await writeMovement(tx, productId, quantity, stock, {
    movementType: "STOCK_IN",
    reason: "ক্রয়",
    refType: "PURCHASE",
    refId: purchaseId,
    unitCost,
  });
}

/**
 * Re-runs a product anchor's জমা waterfall after an outside payment raised
 * its advance, so SaleItem.advanceAllocated stays consistent with refunds.
 * Non-product rows are a no-op.
 */
export async function resyncAnchorAdvance(
  tx: Tx,
  serviceId: number
): Promise<void> {
  const anchor = await tx.service.findUnique({
    where: { id: serviceId },
    select: { entryKind: true },
  });
  if (!anchor || anchor.entryKind !== "PRODUCT") return;
  await syncAnchorTotals(tx, serviceId);
}

export async function restockProduct(
  tx: Tx,
  productId: number,
  input: ValidatedRestock
): Promise<{ stock: number }> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, archived: true },
  });
  if (!product || product.archived) {
    throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
  }
  if (input.purchasePrice !== null) {
    // "Cost = last restock price" — the sale snapshot reads this field later.
    await tx.product.update({
      where: { id: productId },
      data: { purchasePrice: input.purchasePrice },
    });
  }
  const stock = await moveStock(tx, productId, input.quantity);
  await writeMovement(tx, productId, input.quantity, stock, {
    movementType: "STOCK_IN",
    reason: input.reason ?? "নতুন স্টক",
    refType: "RESTOCK",
    refId: productId,
    unitCost: input.purchasePrice,
    note: input.reason,
  });
  return { stock: stock.next };
}

export async function adjustProductStock(
  tx: Tx,
  productId: number,
  input: ValidatedAdjust
): Promise<{ stock: number; delta: number }> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { stock: true, archived: true },
  });
  if (!product || product.archived) {
    throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
  }
  const delta = input.stock - product.stock;
  if (delta === 0) return { stock: product.stock, delta: 0 };
  const stock = await moveStock(tx, productId, delta);
  await writeMovement(tx, productId, delta, stock, {
    movementType: "ADJUSTMENT",
    reason: input.reason ?? "স্টক সমন্বয়",
    refType: "ADJUSTMENT",
    refId: productId,
    note: input.reason,
  });
  return { stock: stock.next, delta };
}

/* ------------------------------------------------------------------ */
/* Service-part resolution → stock                                     */
/* ------------------------------------------------------------------ */

export interface ServicePartStockInput {
  serviceId: number;
  partId: number;
  /** Existing product to increment; when absent, find/create by name. */
  productId?: number | null;
  categoryName: string;
  productName: string;
  quantity: number;
  unitCost: number;
  sellingPrice: number;
  note: string;
}

/**
 * Materialises a part that was resolved as MOVED_TO_STOCK: one category,
 * one product (created or reused by name), one atomic stock increment and one
 * STOCK_IN movement. Caller supplies the transaction so the ServicePart update
 * commits or rolls back with it. Buying price always comes from the part.
 */
export async function receiveServicePartStock(
  tx: Tx,
  input: ServicePartStockInput
): Promise<number> {
  const categoryName = requiredInventoryText(
    input.categoryName,
    "ক্যাটাগরির নাম",
    80
  );
  const productName = requiredInventoryText(
    input.productName,
    "প্রোডাক্টের নাম",
    120
  );
  const sellingPrice = parseInventoryInt(
    input.sellingPrice,
    "বিক্রয় দাম",
    { min: 0 }
  );
  const unitCost = Math.max(0, Math.round(input.unitCost || 0));
  const categoryKey = categoryNameKey(categoryName);

  let category = await tx.productCategory.findUnique({
    where: { nameKey: categoryKey },
    select: { id: true },
  });
  if (!category) {
    category = await tx.productCategory.create({
      data: { name: categoryName, nameKey: categoryKey },
      select: { id: true },
    });
  }

  let product: { id: number; sellingPrice: number } | null = null;
  if (input.productId) {
    const chosen = await tx.product.findUnique({
      where: { id: input.productId },
      select: { id: true, sellingPrice: true, archived: true },
    });
    if (!chosen || chosen.archived) {
      throw new InventoryConflictError("প্রোডাক্ট পাওয়া যায়নি");
    }
    product = { id: chosen.id, sellingPrice: chosen.sellingPrice };
  } else {
    product = await tx.product.findFirst({
      where: { name: productName, archived: false },
      select: { id: true, sellingPrice: true },
      orderBy: { id: "asc" },
    });
  }

  if (!product) {
    product = await tx.product.create({
      data: {
        name: productName,
        categoryId: category.id,
        sellingPrice,
        purchasePrice: unitCost,
        stock: 0,
      },
      select: { id: true, sellingPrice: true },
    });
  } else if (product.sellingPrice === 0 && sellingPrice > 0) {
    // Never overwrite an existing shelf price; only fill an unset one.
    await tx.product.update({
      where: { id: product.id },
      data: { sellingPrice },
    });
  }
  // "Cost = last purchase price" — later sale snapshots read this field.
  await tx.product.update({
    where: { id: product.id },
    data: { purchasePrice: unitCost },
  });

  const stock = await moveStock(tx, product.id, input.quantity);
  await writeMovement(tx, product.id, input.quantity, stock, {
    movementType: "STOCK_IN",
    reason: input.note,
    refType: "SERVICE_PART",
    refId: input.partId,
    unitCost,
    note: input.note,
  });
  return product.id;
}

export interface ServicePartStockReversalInput {
  productId: number;
  partId: number;
  quantity: number;
  note: string;
}

/**
 * Undoes an earlier MOVED_TO_STOCK resolution when the line changes state.
 * A short stock is refused inside `moveStock`, so the whole transition rolls
 * back instead of writing a negative quantity.
 */
export async function reverseServicePartStock(
  tx: Tx,
  input: ServicePartStockReversalInput
): Promise<void> {
  const product = await tx.product.findUnique({
    where: { id: input.productId },
    select: { id: true, archived: true },
  });
  if (!product || product.archived) {
    throw new InventoryConflictError("স্টকের প্রোডাক্ট পাওয়া যায়নি");
  }
  const stock = await moveStock(tx, input.productId, -input.quantity);
  await writeMovement(tx, input.productId, -input.quantity, stock, {
    movementType: "STOCK_OUT",
    reason: input.note,
    refType: "SERVICE_PART",
    refId: input.partId,
    note: input.note,
  });
}

/** Ledger sanity check used by tests and the first-run backfill. */
export async function verifyStockLedger(productId?: number): Promise<{
  ok: boolean;
  mismatches: { productId: number; stock: number; ledger: number }[];
}> {
  const products = await prisma.product.findMany({
    where: productId ? { id: productId } : undefined,
    select: { id: true, stock: true },
  });
  const sums = await prisma.stockMovement.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
  });
  const ledger = new Map(
    sums.map((row) => [row.productId, row._sum.quantity ?? 0])
  );
  const mismatches = products
    .map((product) => ({
      productId: product.id,
      stock: product.stock,
      ledger: ledger.get(product.id) ?? 0,
    }))
    .filter((row) => row.stock !== row.ledger);
  return { ok: mismatches.length === 0, mismatches };
}

/** Accepts Western/Bengali digits for the client-side product picker. */
export function parseProductQuantity(value: unknown): number | null {
  return parseBnNumber(value);
}
