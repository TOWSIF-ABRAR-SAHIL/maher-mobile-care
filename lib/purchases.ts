/**
 * Shop purchases (money out) — supplier bills and supplier payments.
 *
 * A purchase is fully separate from service expenses/profit: receiving stock
 * bumps `Product.stock` through the normal ledger, but its cost never enters
 * `Service.expenseAmount` or the profit formula. Supplier payments settle the
 * oldest open bill first, exactly like customer payments, and can never
 * overpay (due never negative).
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "./prisma";
import { serviceDateFromKey } from "./dhaka";
import {
  optionalInventoryText,
  parseInventoryInt,
  requiredInventoryText,
} from "./inventory";
import { receivePurchaseStock } from "./stock";
import { PartConflictError, deviceHasParts } from "./parts-data";
import {
  normalizePaymentMethod,
  PaymentError,
  type PaymentMethod,
} from "./payments";

type Tx = Prisma.TransactionClient;

export const MAX_PURCHASE_LINES = 50;
export const PURCHASE_TYPES = ["STOCK", "SERVICE_PART"] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];

export interface PurchaseLineInput {
  productId: number | null;
  /** Required only for untracked lines. */
  name: string | null;
  quantity: number;
  unitCost: number;
}

export interface ValidatedPurchase {
  purchaseType: PurchaseType;
  serviceId: number | null;
  supplier: string;
  supplierKey: string;
  invoiceNo: string | null;
  purchaseDate: Date;
  note: string | null;
  /** Optional amount paid at creation; defaults to 0 (on credit). */
  paid: number;
  method: PaymentMethod;
  items: PurchaseLineInput[];
}

export interface ValidatedSupplierPayment {
  supplier: string;
  supplierKey: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
}

export function supplierKey(name: string): string {
  return name.trim().toLowerCase();
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentError("ভুল ডেটা পাঠানো হয়েছে");
  }
  return value as Record<string, unknown>;
}

function parsePurchaseLine(raw: unknown, index: number): PurchaseLineInput {
  const row = readObject(raw);
  const label = `লাইন ${index + 1}`;
  let productId: number | null = null;
  if (
    row.productId !== undefined &&
    row.productId !== null &&
    String(row.productId).trim() !== ""
  ) {
    productId = parseInventoryInt(row.productId, `${label}এর প্রোডাক্ট`, {
      min: 1,
    });
  }
  const name = productId
    ? null
    : requiredInventoryText(row.name, `${label}এর নাম`, 120);
  return {
    productId,
    name,
    quantity: parseInventoryInt(row.quantity, `${label}এর পরিমাণ`, { min: 1 }),
    unitCost: parseInventoryInt(row.unitCost, `${label}এর ক্রয় মূল্য`),
  };
}

function parsePurchaseType(value: unknown): PurchaseType {
  const type = String(value ?? "STOCK").trim().toUpperCase();
  if ((PURCHASE_TYPES as readonly string[]).includes(type)) {
    return type as PurchaseType;
  }
  throw new PaymentError("ক্রয়ের ধরন সঠিক নয়");
}

export function validatePurchase(body: unknown): ValidatedPurchase {
  const raw = readObject(body);
  const supplier = requiredInventoryText(raw.supplier, "সাপ্লায়ারের নাম", 120);
  const purchaseType = parsePurchaseType(raw.purchaseType);
  let serviceId: number | null = null;
  if (raw.serviceId !== undefined && raw.serviceId !== null && String(raw.serviceId).trim() !== "") {
    serviceId = parseInventoryInt(raw.serviceId, "সার্ভিস আইডি", { min: 1 });
  }
  if (purchaseType === "SERVICE_PART" && !serviceId) {
    throw new PaymentError("পার্টস কেনার বিলের সাথে সার্ভিস বাছুন");
  }
  if (purchaseType === "STOCK" && serviceId) {
    throw new PaymentError("স্টক ক্রয়ে সার্ভিস লিংক দেওয়া যাবে না");
  }
  const rawItems = raw.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new PaymentError("অন্তত একটি ক্রয় আইটেম দিন");
  }
  if (rawItems.length > MAX_PURCHASE_LINES) {
    throw new PaymentError(
      `একবারে সর্বোচ্চ ${MAX_PURCHASE_LINES}টি আইটেম সেভ করা যাবে`
    );
  }
  let purchaseDate = new Date();
  if (typeof raw.purchaseDate === "string" && raw.purchaseDate.trim()) {
    try {
      purchaseDate = serviceDateFromKey(raw.purchaseDate.trim());
    } catch {
      throw new PaymentError("সঠিক তারিখ দিন (YYYY-MM-DD)");
    }
  }
  return {
    purchaseType,
    serviceId,
    supplier,
    supplierKey: supplierKey(supplier),
    invoiceNo: optionalInventoryText(raw.invoiceNo, "ইনভয়েস নম্বর", 60),
    purchaseDate,
    note: optionalInventoryText(raw.note, "নোট", 300),
    paid: parseInventoryInt(raw.paid ?? 0, "পরিশোধিত টাকা"),
    method: normalizePaymentMethod(raw.method),
    items: rawItems.map(parsePurchaseLine),
  };
}

export function validateSupplierPayment(body: unknown): ValidatedSupplierPayment {
  const raw = readObject(body);
  const supplier = requiredInventoryText(raw.supplier, "সাপ্লায়ারের নাম", 120);
  return {
    supplier,
    supplierKey: supplierKey(supplier),
    amount: parseInventoryInt(raw.amount, "টাকার পরিমাণ", { min: 1 }),
    method: normalizePaymentMethod(raw.method),
    note: optionalInventoryText(raw.note, "নোট", 300),
  };
}

interface PreparedItem {
  productId: number | null;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

async function prepareItem(
  tx: Tx,
  input: PurchaseLineInput,
  purchaseType: PurchaseType
): Promise<PreparedItem> {
  if (purchaseType === "SERVICE_PART" && input.productId) {
    throw new PaymentError("সার্ভিস পার্টসের জন্য ট্র্যাক করা প্রোডাক্ট বাছাই করা যাবে না");
  }
  let nameSnapshot = input.name?.trim() ?? "";
  let skuSnapshot: string | null = null;
  if (input.productId) {
    const product = await tx.product.findUnique({
      where: { id: input.productId },
      select: { name: true, sku: true, archived: true },
    });
    if (!product || product.archived) {
      throw new PaymentError("প্রোডাক্ট পাওয়া যায়নি");
    }
    nameSnapshot = product.name;
    skuSnapshot = product.sku;
  }
  return {
    productId: input.productId,
    nameSnapshot,
    skuSnapshot,
    quantity: input.quantity,
    unitCost: input.unitCost,
    lineTotal: input.quantity * input.unitCost,
  };
}

export interface PurchaseResult {
  purchaseId: number;
  total: number;
  paid: number;
  items: number;
}

/**
 * Creates the supplier bill, receives every tracked line into stock and
 * applies an optional up-front payment. Must run inside the caller's
 * transaction so the bill, stock moves and money commit together.
 */
export async function createPurchase(
  tx: Tx,
  input: ValidatedPurchase
): Promise<PurchaseResult> {
  if (input.purchaseType === "SERVICE_PART") {
    const service = await tx.service.findUnique({
      where: { id: input.serviceId! },
      select: { id: true, archived: true, entryKind: true },
    });
    if (!service || service.archived || service.entryKind === "PRODUCT") {
      throw new PaymentError("সঠিক সার্ভিস ডিভাইস বাছুন");
    }
    // One device, one source of parts cost: manual part lines OR a linked
    // purchase bill, never both (that would double-count repair cost).
    if (await deviceHasParts(tx, input.serviceId!)) {
      throw new PartConflictError(
        "এই ডিভাইসে পার্টস লাইন আছে — আগে পার্টস লাইন সরান, তারপর ক্রয় বিল যোগ করুন"
      );
    }
  }
  const prepared = await Promise.all(
    input.items.map((item) => prepareItem(tx, item, input.purchaseType))
  );
  const total = prepared.reduce((sum, item) => sum + item.lineTotal, 0);
  if (input.paid > total) {
    throw new PaymentError("পরিশোধিত টাকা মোট বিলের বেশি হতে পারে না");
  }

  const purchase = await tx.purchase.create({
    data: {
      purchaseType: input.purchaseType,
      serviceId: input.serviceId,
      supplier: input.supplier,
      supplierKey: input.supplierKey,
      invoiceNo: input.invoiceNo,
      purchaseDate: input.purchaseDate,
      total,
      paid: input.paid,
      note: input.note,
    },
    select: { id: true },
  });

  for (const item of prepared) {
    if (input.purchaseType === "STOCK" && item.productId) {
      await receivePurchaseStock(
        tx,
        item.productId,
        item.quantity,
        item.unitCost,
        purchase.id
      );
    }
    await tx.purchaseItem.create({
      data: {
        purchaseId: purchase.id,
        productId: item.productId,
        nameSnapshot: item.nameSnapshot,
        skuSnapshot: item.skuSnapshot,
        quantity: item.quantity,
        unitCost: item.unitCost,
        lineTotal: item.lineTotal,
      },
    });
  }

  // The up-front payment is recorded like any other supplier payment, but it
  // is guaranteed to settle this bill first.
  if (input.paid > 0) {
    const payment = await tx.purchasePayment.create({
      data: {
        supplierKey: input.supplierKey,
        supplier: input.supplier,
        amount: input.paid,
        method: input.method,
        note: null,
      },
      select: { id: true },
    });
    await tx.purchasePaymentAllocation.create({
      data: {
        paymentId: payment.id,
        purchaseId: purchase.id,
        amount: input.paid,
      },
    });
  }

  return { purchaseId: purchase.id, total, paid: input.paid, items: prepared.length };
}

export interface SupplierPaymentResult {
  paymentId: number;
  amount: number;
  allocations: { purchaseId: number; amount: number }[];
}

/** Pays a supplier, oldest open bill first; refuses any overpay. */
export async function applySupplierPayment(
  tx: Tx,
  input: ValidatedSupplierPayment
): Promise<SupplierPaymentResult> {
  const open = await tx.purchase.findMany({
    where: {
      archived: false,
      supplierKey: input.supplierKey,
    },
    orderBy: [{ purchaseDate: "asc" }, { id: "asc" }],
    select: { id: true, total: true, paid: true, supplier: true },
  });
  const unpaid = open
    .map((purchase) => ({
      ...purchase,
      due: Math.max(0, purchase.total - purchase.paid),
    }))
    .filter((purchase) => purchase.due > 0);
  const totalDue = unpaid.reduce((sum, purchase) => sum + purchase.due, 0);
  if (totalDue <= 0) {
    throw new PaymentError("এই সাপ্লায়ারের কোনো বাকি নেই");
  }
  if (input.amount > totalDue) {
    throw new PaymentError(
      `বাকির চেয়ে বেশি টাকা দেওয়া যাবে না (মোট বাকি ৳${totalDue})`
    );
  }

  const payment = await tx.purchasePayment.create({
    data: {
      supplierKey: input.supplierKey,
      supplier: input.supplier,
      amount: input.amount,
      method: input.method,
      note: input.note,
    },
    select: { id: true },
  });

  const allocations: { purchaseId: number; amount: number }[] = [];
  let remaining = input.amount;
  for (const purchase of unpaid) {
    if (remaining <= 0) break;
    const take = Math.min(purchase.due, remaining);
    if (take <= 0) continue;
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { paid: purchase.paid + take },
    });
    await tx.purchasePaymentAllocation.create({
      data: { paymentId: payment.id, purchaseId: purchase.id, amount: take },
    });
    allocations.push({ purchaseId: purchase.id, amount: take });
    remaining -= take;
  }

  return { paymentId: payment.id, amount: input.amount, allocations };
}

/** List payload: bills with items, computed due, newest first. */
export async function listPurchases() {
  const rows = await prisma.purchase.findMany({
    where: { archived: false },
    orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
    include: {
      items: { orderBy: { id: "asc" } },
    },
  });
  return rows.map((row) => ({
    ...row,
    due: Math.max(0, row.total - row.paid),
  }));
}
