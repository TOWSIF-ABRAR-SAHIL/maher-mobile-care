/**
 * Database helpers for the per-device parts purchase ledger. Server-only: the
 * pure money rule lives in `parts.ts` so client code never imports Prisma.
 *
 * A `ServicePart` row is both "a part used on this device" and "a purchase
 * line". Its purchase date/supplier/paid marker are whole-line facts, never a
 * payment transaction: supplier balances (`PurchasePayment`) and customer dues
 * (`Service.due`) stay completely separate from this ledger.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "./prisma";
import {
  dhakaDateKey,
  dhakaRangeBounds,
  isDateKey,
  serviceDateFromKey,
} from "./dhaka";
import type {
  ServicePartDTO,
  ServicePartLedgerRowDTO,
  ServicePartResolutionStatus,
} from "./types";
import {
  MAX_PART_NOTE_LENGTH,
  MAX_PART_PAID_NOTE_LENGTH,
  partSupplierKey,
  type PartsCostLookup,
  type ValidatedPart,
} from "./parts";
import { RETURNED_STATUS } from "./utils";
import {
  InventoryConflictError,
  optionalInventoryText,
  parseInventoryInt,
} from "./inventory";
import {
  receiveServicePartStock,
  reverseServicePartStock,
  withStockTransaction,
} from "./stock";

type Tx = Prisma.TransactionClient;

/** A conflict that must answer 409 instead of a generic validation 400. */
export class PartConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartConflictError";
  }
}

/** One Dhaka-time stamp for an append-only paid history entry. */
function dhakaStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

function appendPaidNote(
  existing: string | null,
  entry: string
): string {
  const clean = entry.trim();
  if (!clean) return existing ?? "";
  const line = `${dhakaStamp()} — ${clean}`;
  const next = existing && existing.trim() ? `${existing}\n${line}` : line;
  if (next.length > MAX_PART_PAID_NOTE_LENGTH) {
    throw new Error(
      `Paid নোট ${MAX_PART_PAID_NOTE_LENGTH} অক্ষরের বেশি হতে পারবে না`
    );
  }
  return next;
}

function supplierIdentity(
  supplier: string | null | undefined
): { supplier: string | null; supplierKey: string | null } {
  const text = String(supplier ?? "").trim();
  if (!text) return { supplier: null, supplierKey: null };
  return { supplier: text, supplierKey: partSupplierKey(text) };
}

/** One grouped query for a whole page of rows — never one query per row. */
export async function partsCostByService(
  ids: readonly number[]
): Promise<PartsCostLookup> {
  const unique = [
    ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (unique.length === 0) return new Map();
  const [groups, withParts, servicePurchases] = await Promise.all([
    prisma.servicePart.groupBy({
      by: ["serviceId"],
      // Only USED lines are the device's repair cost. MOVED_TO_STOCK and
      // RETURNED belong to stock/supplier, and DAMAGED is carried once in
      // Service.damageLoss — counting it here too would double the loss.
      where: { serviceId: { in: unique }, partStatus: "USED" },
      _sum: { lineCost: true },
    }),
    // A device whose every line was resolved away still HAS parts: its cost is
    // zero, not "no parts", so an old lump code must not come back.
    prisma.servicePart.findMany({
      where: { serviceId: { in: unique } },
      distinct: ["serviceId"],
      select: { serviceId: true },
    }),
    prisma.purchase.findMany({
      where: {
        purchaseType: "SERVICE_PART",
        serviceId: { in: unique },
        archived: false,
      },
      select: {
        serviceId: true,
        items: { select: { lineTotal: true } },
      },
    }),
  ]);
  const map: PartsCostLookup = new Map();
  const purchased = new Map<number, number>();
  for (const group of groups) {
    map.set(group.serviceId, Math.max(0, group._sum.lineCost ?? 0));
  }
  for (const row of withParts) {
    if (!map.has(row.serviceId)) map.set(row.serviceId, 0);
  }
  for (const purchase of servicePurchases) {
    if (purchase.serviceId === null) continue;
    const amount = purchase.items.reduce(
      (sum, item) => sum + Math.max(0, item.lineTotal),
      0
    );
    // A linked service-part purchase is the source of truth for that device's
    // bought parts. This prevents a manual PartsEditor line plus its purchase
    // bill from counting the same repair cost twice.
    purchased.set(purchase.serviceId, (purchased.get(purchase.serviceId) ?? 0) + amount);
  }
  for (const [serviceId, amount] of purchased) {
    map.set(serviceId, amount);
  }
  return map;
}

function toDTO(row: {
  id: number;
  serviceId: number;
  nameSnapshot: string;
  skuSnapshot: string | null;
  quantity: number;
  unitCost: number;
  lineCost: number;
  supplier: string | null;
  supplierKey: string | null;
  priceCode: string | null;
  purchaseDate: Date | null;
  paidAt: Date | null;
  paidNote: string | null;
  note: string | null;
  partStatus: string;
  resolutionNote: string | null;
  targetProductId: number | null;
  resolvedAt: Date | null;
}): ServicePartDTO {
  return {
    id: row.id,
    serviceId: row.serviceId,
    name: row.nameSnapshot,
    sku: row.skuSnapshot,
    quantity: row.quantity,
    unitCost: row.unitCost,
    lineCost: row.lineCost,
    supplier: row.supplier,
    supplierKey: row.supplierKey,
    priceCode: row.priceCode,
    purchaseDate: row.purchaseDate ? dhakaDateKey(row.purchaseDate) : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    paidNote: row.paidNote,
    note: row.note,
    partStatus: resolutionStatus(row.partStatus),
    resolutionNote: row.resolutionNote,
    targetProductId: row.targetProductId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

/** Unknown values from an old/edited snapshot are treated as USED. */
export function resolutionStatus(value: unknown): ServicePartResolutionStatus {
  return value === "MOVED_TO_STOCK" ||
    value === "RETURNED" ||
    value === "DAMAGED" ||
    value === "KEPT_IN_LEDGER"
    ? value
    : "USED";
}

/** Full part lines for a page of rows (used by the edit form and the list). */
export async function servicePartsFor(
  ids: readonly number[]
): Promise<Map<number, ServicePartDTO[]>> {
  const unique = [
    ...new Set(ids.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (unique.length === 0) return new Map();
  const rows = await prisma.servicePart.findMany({
    where: { serviceId: { in: unique } },
    orderBy: { id: "asc" },
  });
  const map = new Map<number, ServicePartDTO[]>();
  for (const row of rows) {
    const list = map.get(row.serviceId) ?? [];
    list.push(toDTO(row));
    map.set(row.serviceId, list);
  }
  return map;
}

function equalMoney(
  old: {
    quantity: number;
    unitCost: number;
    priceCode: string | null;
    purchaseDate: Date | null;
    supplierKey: string | null;
  },
  next: {
    quantity: number;
    unitCost: number;
    priceCode: string | null;
    purchaseDate: Date | null;
    supplierKey: string | null;
  }
): boolean {
  return (
    old.quantity === next.quantity &&
    old.unitCost === next.unitCost &&
    old.priceCode === next.priceCode &&
    (old.purchaseDate?.getTime() ?? null) ===
      (next.purchaseDate?.getTime() ?? null) &&
    old.supplierKey === next.supplierKey
  );
}

/**
 * Reconcile a device's parts atomically. Existing lines sent back with their
 * `id` are updated in place (keeping a blank purchase date/supplier they did
 * not resend), new lines are created, and missing lines are deleted — except:
 *
 *  - a paid line may not lose its money/date/supplier (mark Unpaid with a note
 *    first), and
 *  - a line with `paidAt`/`paidNote` history may never be removed here.
 *
 * New lines always require a real purchase date and supplier: the ledger
 * cannot contain an unknown-date row created by today's form.
 */
export async function replaceServiceParts(
  tx: Tx,
  serviceId: number,
  parts: readonly ValidatedPart[]
): Promise<void> {
  const existing = await tx.servicePart.findMany({ where: { serviceId } });
  const byId = new Map(existing.map((row) => [row.id, row]));
  const keptIds = new Set<number>();
  const creates: Array<Omit<Prisma.ServicePartCreateManyInput, "serviceId">> = [];
  let damageDelta = 0;

  for (const part of parts) {
    const old = part.id !== null ? byId.get(part.id) : undefined;
    if (part.id !== null && !old) {
      throw new PartConflictError(
        "পার্টসের একটি লাইন আর নেই — তালিকা রিফ্রেশ করে আবার চেষ্টা করুন"
      );
    }

    if (!old) {
      if (!part.purchaseDate || !part.purchaseDateKey) {
        throw new Error("নতুন পার্টসের কেনার তারিখ দিন");
      }
      if (!part.supplier) {
        throw new Error("নতুন পার্টসের দোকান/সাপ্লায়ার দিন");
      }
      // A part flagged on the entry form is resolved at save time. The full
      // line moves to the shop's damage loss once; partsCostByService ignores
      // non-USED lines, so it never lands in the device cost as well.
      if (part.partStatus === "DAMAGED") damageDelta += part.lineCost;
      creates.push({
        productId: part.productId,
        nameSnapshot: part.nameSnapshot,
        skuSnapshot: part.skuSnapshot,
        quantity: part.quantity,
        unitCost: part.unitCost,
        lineCost: part.lineCost,
        supplier: part.supplier,
        supplierKey: part.supplierKey,
        priceCode: part.priceCode,
        note: part.note,
        purchaseDate: part.purchaseDate,
        partStatus: part.partStatus,
        ...(part.partStatus === "DAMAGED"
          ? {
              resolutionNote: "ফর্মে ড্যামেজ হিসেবে চিহ্নিত",
              resolvedAt: new Date(),
            }
          : {}),
      });
      continue;
    }

    keptIds.add(old.id);
    const supplier = part.supplier
      ? supplierIdentity(part.supplier)
      : { supplier: old.supplier, supplierKey: old.supplierKey };
    const next = {
      productId: part.productId,
      nameSnapshot: part.nameSnapshot,
      skuSnapshot: part.skuSnapshot,
      quantity: part.quantity,
      unitCost: part.unitCost,
      lineCost: part.lineCost,
      supplier: supplier.supplier,
      supplierKey: supplier.supplierKey,
      priceCode: part.priceCode,
      note: part.note,
      purchaseDate: part.purchaseDate ?? old.purchaseDate,
    };

    if (old.paidAt && !equalMoney(old, next)) {
      throw new PartConflictError(
        "Paid পার্টসের দাম/তারিখ/সাপ্লায়ার বদলানো যাবে না — আগে Unpaid করুন এবং কারণ লিখুন"
      );
    }
    // A resolved line owns stock/damage/payable consequences. It may only be
    // reached through নিষ্পত্তি / অবস্থা পরিবর্তন, not the service form.
    if (
      resolutionStatus(old.partStatus) !== "USED" &&
      (!equalMoney(old, next) ||
        old.nameSnapshot !== next.nameSnapshot ||
        old.skuSnapshot !== next.skuSnapshot ||
        old.productId !== next.productId ||
        old.note !== next.note)
    ) {
      throw new PartConflictError(
        "নিষ্পত্তিকৃত পার্টস লাইন সার্ভিস ফর্ম থেকে বদলানো যাবে না — পার্টস খাতার নিষ্পত্তি দিয়ে অবস্থা বদলান"
      );
    }

    await tx.servicePart.update({ where: { id: old.id }, data: next });
  }

  const removed = existing.filter((row) => !keptIds.has(row.id));
  for (const row of removed) {
    if (resolutionStatus(row.partStatus) !== "USED") {
      throw new PartConflictError(
        "নিষ্পত্তিকৃত পার্টস লাইন মোছা যাবে না — আগে নিষ্পত্তি বদলে ব্যবহৃত করুন"
      );
    }
    if (row.paidAt || row.paidNote) {
      throw new PartConflictError(
        "Paid বা Paid-ইতিহাসযুক্ত পার্টস লাইন মোছা যাবে না — আগে Unpaid করুন এবং কারণ লিখুন"
      );
    }
  }
  if (removed.length > 0) {
    await tx.servicePart.deleteMany({
      where: { id: { in: removed.map((row) => row.id) } },
    });
  }
  if (creates.length > 0) {
    await tx.servicePart.createMany({
      data: creates.map((row) => ({ ...row, serviceId })),
    });
  }
  if (damageDelta !== 0) {
    // Parts flagged on the entry form move the whole line into the shop's
    // damage loss once. partsCostByService ignores non-USED lines, so this
    // never also lands in the device cost. Same raw-SQL/clamp pattern as
    // resolveServicePartInTx so both paths stay in one transaction.
    await tx.$executeRaw`UPDATE "Service" SET "damageLoss" = MAX(0, "damageLoss" + ${damageDelta}) WHERE "id" = ${serviceId}`;
  }

  // Pairing: parts and a linked SERVICE_PART purchase bill would count the
  // same repair cost twice. Refuse to create both for one device.
  if (parts.length > 0) {
    const linked = await tx.purchase.findFirst({
      where: { purchaseType: "SERVICE_PART", serviceId, archived: false },
      select: { id: true },
    });
    if (linked) {
      throw new PartConflictError(
        "এই ডিভাইসের পার্টসক্রয় বিল আছে — পার্টস লাইন যোগ করার আগে সেই বিলটি সরান"
      );
    }
  }
}

/** True when the device already itemizes parts (blocks a SERVICE_PART bill). */
export async function deviceHasParts(
  tx: Tx,
  serviceId: number
): Promise<boolean> {
  const row = await tx.servicePart.findFirst({
    where: { serviceId },
    select: { id: true },
  });
  return row !== null;
}

/* ------------------------------------------------------------------ */
/* Purchase ledger                                                     */
/* ------------------------------------------------------------------ */

export type ServicePartStatusFilter = "all" | "paid" | "unpaid" | "legacy";
export type ServicePartResolutionFilter =
  | "all"
  | ServicePartResolutionStatus;

export interface ServicePartLedgerFilters {
  from?: string | null;
  to?: string | null;
  supplierKey?: string | null;
  /** Paid-marker tab, kept for the existing ledger. */
  status?: ServicePartStatusFilter;
  /** Resolution tab: ব্যবহৃত / স্টকে যুক্ত / ফেরত / ড্যামেজ. */
  resolution?: ServicePartResolutionFilter;
}

export interface ServicePartLedgerSummary {
  /** Paid + Unpaid lines (legacy/unknown-date lines are excluded). */
  count: number;
  total: number;
  paidCount: number;
  paidTotal: number;
  unpaidCount: number;
  unpaidTotal: number;
  /** Legacy lines with no purchase date: never part of the money totals. */
  legacyCount: number;
  legacyAmount: number;
}

/** Builds the date/supplier base filter shared by rows and summary. */
function ledgerBaseWhere(filters: ServicePartLedgerFilters) {
  const where: Prisma.ServicePartWhereInput = {};
  const from = filters.from?.trim();
  const to = filters.to?.trim();
  if (from || to) {
    if ((from && !isDateKey(from)) || (to && !isDateKey(to))) {
      throw new Error("সঠিক তারিখ দিন (YYYY-MM-DD)");
    }
    const bounds = dhakaRangeBounds(from || to!, to || from!);
    where.purchaseDate = { gte: bounds.start, lte: bounds.end };
  }
  if (filters.supplierKey?.trim()) {
    where.supplierKey = filters.supplierKey.trim().toLowerCase();
  }
  return where;
}

function statusWhere(
  status: ServicePartStatusFilter
): Prisma.ServicePartWhereInput {
  if (status === "paid") return { paidAt: { not: null } };
  if (status === "unpaid") {
    return { paidAt: null, purchaseDate: { not: null } };
  }
  if (status === "legacy") return { purchaseDate: null };
  return {};
}

function resolutionWhere(
  resolution: ServicePartResolutionFilter
): Prisma.ServicePartWhereInput {
  return resolution === "all" ? {} : { partStatus: resolution };
}

function summarize(
  rows: Array<{
    lineCost: number;
    paidAt: Date | null;
    purchaseDate: Date | null;
    partStatus: string;
  }>
): ServicePartLedgerSummary {
  const summary: ServicePartLedgerSummary = {
    count: 0,
    total: 0,
    paidCount: 0,
    paidTotal: 0,
    unpaidCount: 0,
    unpaidTotal: 0,
    legacyCount: 0,
    legacyAmount: 0,
  };
  for (const row of rows) {
    // A returned part is no longer a supplier liability: it never enters any
    // all-time/pending balance, whichever tab is showing the row.
    if (resolutionStatus(row.partStatus) === "RETURNED") continue;
    const amount = Math.max(0, Math.round(row.lineCost || 0));
    if (row.purchaseDate === null) {
      summary.legacyCount += 1;
      summary.legacyAmount += amount;
      continue;
    }
    summary.count += 1;
    summary.total += amount;
    if (row.paidAt) {
      summary.paidCount += 1;
      summary.paidTotal += amount;
    } else {
      summary.unpaidCount += 1;
      summary.unpaidTotal += amount;
    }
  }
  return summary;
}

/**
 * Ledger rows + a summary that depends ONLY on the date/supplier filters.
 * Switching the status tab changes the visible rows but never the totals.
 */
export async function servicePartLedger(filters: ServicePartLedgerFilters) {
  const base = ledgerBaseWhere(filters);
  const [baseRows, rows, supplierRows] = await Promise.all([
    prisma.servicePart.findMany({
      where: base,
      select: {
        lineCost: true,
        paidAt: true,
        purchaseDate: true,
        partStatus: true,
      },
    }),
    prisma.servicePart.findMany({
      where: {
        ...base,
        ...statusWhere(filters.status ?? "all"),
        ...resolutionWhere(filters.resolution ?? "all"),
      },
      orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
      take: 1000,
    }),
    prisma.servicePart.findMany({
      where: { supplierKey: { not: null } },
      distinct: ["supplierKey"],
      select: { supplier: true, supplierKey: true },
      orderBy: { supplier: "asc" },
    }),
  ]);

  const serviceIds = [...new Set(rows.map((row) => row.serviceId))];
  const services =
    serviceIds.length > 0
      ? await prisma.service.findMany({
          where: { id: { in: serviceIds } },
          select: {
            id: true,
            customerName: true,
            phone: true,
            model: true,
            technician: true,
            status: true,
            archived: true,
          },
        })
      : [];
  const serviceById = new Map(services.map((row) => [row.id, row]));

  const ledgerRows: ServicePartLedgerRowDTO[] = rows.map((row) => {
    const service = serviceById.get(row.serviceId);
    return {
      ...toDTO(row),
      service: service
        ? {
            id: service.id,
            customerName: service.customerName,
            phone: service.phone,
            model: service.model,
            technician: service.technician,
            status: service.status,
            archived: service.archived,
          }
        : null,
    };
  });

  const suppliers = supplierRows
    .filter(
      (row): row is { supplier: string; supplierKey: string } =>
        !!row.supplier && !!row.supplierKey
    )
    .map((row) => ({ name: row.supplier, key: row.supplierKey }));

  return {
    rows: ledgerRows,
    summary: summarize(baseRows),
    suppliers,
  };
}

export interface PaidToggleInput {
  paid: boolean;
  note?: string | null;
  /** Required to give a legacy (unknown-date) line a date before marking Paid. */
  purchaseDate?: string | null;
  confirmUnknownDate?: boolean;
}

/**
 * Whole-line paid marker. This is NOT a payment: it never writes a
 * `PurchasePayment`, never allocates money and never touches `Service.due`.
 *
 * Unpaid → Paid requires a known purchase date. A legacy row needs the caller
 * to send a valid date plus an explicit confirmation.
 */
export async function setServicePartPaid(
  id: number,
  input: PaidToggleInput
): Promise<ServicePartDTO | null> {
  const row = await prisma.servicePart.findUnique({ where: { id } });
  if (!row) return null;
  if (resolutionStatus(row.partStatus) === "RETURNED") {
    throw new PartConflictError(
      "ফেরতকৃত পার্টস লাইনে Paid চিহ্ন বদলানো যাবে না"
    );
  }

  const note = String(input.note ?? "").trim();
  if (!input.paid) {
    if (!row.paidAt) {
      // Already unpaid: nothing to undo, no history entry.
      return toDTO(row);
    }
    if (!note) {
      throw new Error("Paid বাতিলের কারণ লিখুন");
    }
    const updated = await prisma.servicePart.update({
      where: { id },
      data: {
        paidAt: null,
        paidNote: appendPaidNote(row.paidNote, `Paid বাতিল — ${note}`),
      },
    });
    return toDTO(updated);
  }

  let purchaseDate = row.purchaseDate;
  if (!purchaseDate) {
    const key = String(input.purchaseDate ?? "").trim();
    if (!input.confirmUnknownDate || !key || !isDateKey(key)) {
      throw new PartConflictError(
        "এই লাইনের কেনার তারিখ নেই — Paid করার আগে সঠিক তারিখ দিন ও নিশ্চিত করুন"
      );
    }
    purchaseDate = serviceDateFromKey(key);
  }
  if (row.paidAt && !note) return toDTO(row);

  const updated = await prisma.servicePart.update({
    where: { id },
    data: {
      purchaseDate,
      paidAt: row.paidAt ?? new Date(),
      paidNote: note
        ? appendPaidNote(row.paidNote, `Paid — ${note}`)
        : row.paidNote,
    },
  });
  return toDTO(updated);
}

/**
 * Deletes one ledger line. Money evidence may never disappear:
 * paid/history-bearing rows are blocked and an unknown-date row needs the
 * explicit confirmation + reason the UI collects.
 */
export async function deleteServicePart(
  id: number,
  input: { confirmUnknownDate?: boolean; note?: string | null } = {}
): Promise<boolean | null> {
  const row = await prisma.servicePart.findUnique({ where: { id } });
  if (!row) return null;
  if (resolutionStatus(row.partStatus) !== "USED") {
    throw new PartConflictError(
      "নিষ্পত্তিকৃত পার্টস লাইন মোছা যাবে না — আগে নিষ্পত্তি বদলে ব্যবহৃত করুন"
    );
  }
  if (row.paidAt || row.paidNote) {
    throw new PartConflictError(
      "Paid বা Paid-ইতিহাসযুক্ত পার্টস লাইন মোছা যাবে না — আগে Unpaid করুন এবং কারণ লিখুন"
    );
  }
  if (row.purchaseDate === null) {
    if (!input.confirmUnknownDate || !String(input.note ?? "").trim()) {
      throw new PartConflictError(
        "তারিখহীন পার্টস লাইন মোছার জন্য নিশ্চিতকরণ ও কারণ দিন"
      );
    }
  }
  await prisma.servicePart.delete({ where: { id } });
  return true;
}

export interface BulkPaidInput {
  ids?: number[];
  supplierKey?: string | null;
  from?: string | null;
  to?: string | null;
  paid: boolean;
  note?: string | null;
}

/**
 * Marks many whole lines Paid/Unpaid in one transaction. Narrow by explicit
 * ids (max 100) or by supplier + optional date range. A supplier-wide change
 * touching more than 500 rows is refused as a whole — never a partial write.
 */
export async function bulkSetServicePartPaid(input: BulkPaidInput) {
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  if (ids.length > 100) {
    throw new Error("একবারে সর্বোচ্চ ১০০টি পার্টস লাইন বদলানো যাবে");
  }
  const note = String(input.note ?? "").trim();
  const bySupplier = !ids.length && !!input.supplierKey?.trim();

  const where: Prisma.ServicePartWhereInput = ids.length
    ? { id: { in: ids } }
    : bySupplier
      ? { supplierKey: input.supplierKey!.trim().toLowerCase() }
      : {};
  if (!ids.length && !bySupplier) {
    throw new Error("কোন পার্টস লাইন বাছুন");
  }
  if (bySupplier) {
    const from = input.from?.trim();
    const to = input.to?.trim();
    if (from || to) {
      if ((from && !isDateKey(from)) || (to && !isDateKey(to))) {
        throw new Error("সঠিক তারিখ দিন (YYYY-MM-DD)");
      }
      const bounds = dhakaRangeBounds(from || to!, to || from!);
      where.purchaseDate = { gte: bounds.start, lte: bounds.end };
    }
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.servicePart.findMany({
      where,
      select: {
        id: true,
        lineCost: true,
        paidAt: true,
        paidNote: true,
        purchaseDate: true,
        partStatus: true,
      },
    });
    if (bySupplier && rows.length > 500) {
      throw new Error(
        "এক সাপ্লায়ারের ৫০০-এর বেশি পার্টস লাইন একবারে বদলানো যাবে না — তারিখসীমা ছোট করুন"
      );
    }
    if (!input.paid && !note) {
      throw new Error("Paid বাতিলের কারণ লিখুন");
    }
    let changed = 0;
    for (const row of rows) {
      if (resolutionStatus(row.partStatus) === "RETURNED") continue;
      if (!input.paid) {
        if (!row.paidAt) continue;
        await tx.servicePart.update({
          where: { id: row.id },
          data: {
            paidAt: null,
            paidNote: appendPaidNote(row.paidNote, `Paid বাতিল — ${note}`),
          },
        });
        changed += 1;
        continue;
      }
      if (!row.purchaseDate) continue; // legacy line needs its own date first
      if (row.paidAt) continue;
      await tx.servicePart.update({
        where: { id: row.id },
        data: {
          paidAt: new Date(),
          paidNote: note
            ? appendPaidNote(row.paidNote, `Paid — ${note}`)
            : row.paidNote,
        },
      });
      changed += 1;
    }
    return { changed, matched: rows.length };
  });
}

/* ------------------------------------------------------------------ */
/* Four-way resolution                                                 */
/* ------------------------------------------------------------------ */

export interface ResolveServicePartInput {
  partStatus: unknown;
  resolutionNote?: unknown;
  categoryName?: unknown;
  productName?: unknown;
  sellingPrice?: unknown;
  targetProductId?: unknown;
}

const RESOLUTION_STATUSES: ServicePartResolutionStatus[] = [
  "USED",
  "MOVED_TO_STOCK",
  "RETURNED",
  "DAMAGED",
  "KEPT_IN_LEDGER",
];

/**
 * Applies one whole-line resolution. Every money/stock consequence lives in a
 * single SQLite transaction so a failed stock write can never leave a line
 * marked "moved to stock" without its product and movement (or vice versa).
 *
 * - USED: normal device cost + supplier payable.
 * - MOVED_TO_STOCK: stock in, device cost 0, supplier still payable/paid.
 * - RETURNED: device cost 0, no stock, removed from supplier balances.
 * - DAMAGED: device cost 0, full line cost moves to Service.damageLoss once;
 *   supplier still payable because the shop must pay for the broken part.
 * - KEPT_IN_LEDGER: device cost 0, no stock, no damage charge; the line and
 *   its supplier balance both stay in /parts. External-shop parts never enter
 *   the shop's own Product stock when a job is cancelled.
 */
export async function resolveServicePart(
  id: number,
  input: ResolveServicePartInput
): Promise<ServicePartDTO | null> {
  return withStockTransaction((tx) => resolveServicePartInTx(tx, id, input));
}

/**
 * Same resolution, but inside a transaction owned by the caller. The refund
 * endpoint uses it so a returned job and every attached part's resolution
 * commit together — a failed stock write can never half-close a return.
 */
export async function resolveServicePartInTx(
  tx: Tx,
  id: number,
  input: ResolveServicePartInput
): Promise<ServicePartDTO | null> {
  const statusText = String(input.partStatus ?? "").trim();
  if (!RESOLUTION_STATUSES.includes(statusText as ServicePartResolutionStatus)) {
    throw new Error("সঠিক নিষ্পত্তির অবস্থা দিন");
  }
  const next = statusText as ServicePartResolutionStatus;

  const row = await tx.servicePart.findUnique({ where: { id } });
    if (!row) return null;
    const old = resolutionStatus(row.partStatus);
    if (old === next) return toDTO(row); // idempotent: never double-stock/damage

    // A returned or archived job is a closed ledger row: its cost/stock/damage
    // were reported at return time. The refund endpoint resolves parts BEFORE
    // stamping Returned, so bulk resolution still works; only later standalone
    // PATCHes are frozen here. Without this guard a post-return PATCH could
    // silently rewrite damageLoss, supplier payable and product stock.
    const parent = await tx.service.findUnique({
      where: { id: row.serviceId },
      select: { status: true, archived: true },
    });
    if (parent && (parent.archived || parent.status === RETURNED_STATUS)) {
      throw new PartConflictError(
        "ফেরত বা আর্কাইভ করা কাজের পার্টস নিষ্পত্তি বদলানো যাবে না"
      );
    }

    const note = optionalInventoryText(
      input.resolutionNote,
      "নিষ্পত্তির নোট",
      MAX_PART_NOTE_LENGTH
    );
    if (next === "RETURNED" && !note) {
      throw new Error("ফেরত দেওয়ার কারণ লিখুন");
    }

    const amount = Math.max(0, Math.round(row.lineCost || 0));
    let damageDelta = 0;
    let targetProductId = row.targetProductId;
    let paidAt = row.paidAt;
    let paidNote = row.paidNote;

    if (next === "MOVED_TO_STOCK") {
      const requestedId =
        input.targetProductId === undefined ||
        input.targetProductId === null ||
        String(input.targetProductId).trim() === ""
          ? null
          : parseInventoryInt(input.targetProductId, "প্রোডাক্ট", { min: 1 });
      const categoryName = String(input.categoryName ?? "").trim();
      const productName =
        String(input.productName ?? "").trim() || row.nameSnapshot;
      if (!requestedId && !categoryName) {
        throw new Error("স্টকে রাখার ক্যাটাগরির নাম দিন");
      }
      const estimated = Math.round(row.unitCost * 1.2);
      const sellingPrice = parseInventoryInt(
        input.sellingPrice === undefined ||
          input.sellingPrice === null ||
          String(input.sellingPrice).trim() === ""
          ? estimated
          : input.sellingPrice,
        "বিক্রয় দাম",
        { min: 0 }
      );
      targetProductId = await receiveServicePartStock(tx, {
        serviceId: row.serviceId,
        partId: row.id,
        productId: requestedId,
        categoryName: categoryName || "সার্ভিস পার্টস",
        productName,
        quantity: row.quantity,
        unitCost: row.unitCost,
        sellingPrice,
        note: `সার্ভিস #${row.serviceId} থেকে স্টকে যুক্ত`,
      });
    } else if (old === "MOVED_TO_STOCK") {
      // Undo the earlier stock-in. A sold-out product blocks the change and
      // rolls the whole transition back rather than going negative.
      if (row.targetProductId) {
        try {
          await reverseServicePartStock(tx, {
            productId: row.targetProductId,
            partId: row.id,
            quantity: row.quantity,
            note: `সার্ভিস #${row.serviceId} থেকে স্টকে যুক্ত বাতিল`,
          });
        } catch (err) {
          if (err instanceof InventoryConflictError) {
            throw new PartConflictError(err.message);
          }
          throw err;
        }
      }
      targetProductId = null;
    }

    if (next === "DAMAGED") damageDelta += amount;
    if (old === "DAMAGED") damageDelta -= amount;
    if (damageDelta !== 0) {
      // Clamp at zero: a manually adjusted loss can never go negative.
      await tx.$executeRaw`UPDATE "Service" SET "damageLoss" = MAX(0, "damageLoss" + ${damageDelta}) WHERE "id" = ${row.serviceId}`;
    }

    if (next === "RETURNED") {
      paidAt = null; // Paid marker disabled for a returned line.
      paidNote = appendPaidNote(
        paidNote,
        note ? `ফেরতকৃত — ${note}` : "ফেরতকৃত"
      );
    }

    const updated = await tx.servicePart.update({
      where: { id },
      data: {
        partStatus: next,
        resolutionNote: note || null,
        targetProductId,
        resolvedAt: new Date(),
        paidAt,
        paidNote,
      },
    });
    return toDTO(updated);
}
