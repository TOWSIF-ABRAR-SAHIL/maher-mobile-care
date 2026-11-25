import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  isServiceValidationError,
  OVERPAY_MESSAGE,
  parseServiceAmount,
  validateServiceCreate,
  validateVisitShared,
} from "@/lib/service-validation";
import { computeDue } from "@/lib/utils";
import { activeTechnicianNames } from "@/lib/technicians";
import { getCipherConfig } from "@/lib/shop-settings";
import {
  createProductSale,
  parseProductLines,
  quoteProductTotal,
  withStockTransaction,
} from "@/lib/stock";
import { allocateVisitAdvance, parseSaleRef } from "@/lib/sales";
import { InventoryConflictError, isInventoryValidationError } from "@/lib/inventory";
import { replaceServiceParts } from "@/lib/parts-data";

export const dynamic = "force-dynamic";

const MAX_DEVICES = 8;

/**
 * POST /api/services/batch
 *
 * One customer visit can bring several devices and/or buy products. Customer/
 * phone/date are shared; each device keeps its own model, problem, bill, status
 * and expected delivery date. Product lines are attached to ONE non-device
 * `entryKind = "PRODUCT"` anchor row (same groupId) so the visit still has a
 * single bill, advance and due. Everything commits in one transaction.
 */
/** Loads a completed product sale by its idempotency key, for a retried submit. */
async function loadSaleByRef(saleRef: string) {
  const anchor = await prisma.service.findUnique({ where: { saleRef } });
  if (!anchor) return null;
  const services = anchor.groupId
    ? await prisma.service.findMany({
        where: { groupId: anchor.groupId },
        orderBy: { id: "asc" },
      })
    : [anchor];
  const saleItems = await prisma.saleItem.findMany({
    where: { serviceId: anchor.id },
    orderBy: { id: "asc" },
  });
  return { groupId: anchor.groupId, services, anchor, saleItems };
}

export async function POST(req: NextRequest) {
  let requestedSaleRef: string | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "ভুল ডেটা" }, { status: 400 });
    }
    const shared = body as Record<string, unknown>;
    const deviceRows = Array.isArray(shared.devices) ? shared.devices : [];
    const products = parseProductLines(shared.products);
    requestedSaleRef =
      products.length > 0 ? parseSaleRef(shared.saleRef) : null;

    if (requestedSaleRef) {
      const existing = await loadSaleByRef(requestedSaleRef);
      if (existing) {
        return NextResponse.json(
          {
            duplicate: true,
            groupId: existing.groupId,
            services: existing.services,
            service: existing.anchor,
            anchor: existing.anchor,
            saleItems: existing.saleItems,
          },
          { status: 200 }
        );
      }
    }

    if (deviceRows.length === 0 && products.length === 0) {
      return NextResponse.json(
        { error: "অন্তত একটি ডিভাইস বা প্রোডাক্ট দিন" },
        { status: 400 }
      );
    }
    if (deviceRows.length > MAX_DEVICES) {
      return NextResponse.json(
        { error: `একবারে সর্বোচ্চ ${MAX_DEVICES}টি ডিভাইস সেভ করা যাবে` },
        { status: 400 }
      );
    }

    const visit = validateVisitShared(shared);
    let productAdvance = 0;
    const rawProductAdvance = shared.productAdvance;
    if (
      rawProductAdvance !== undefined &&
      rawProductAdvance !== null &&
      String(rawProductAdvance).trim() !== ""
    ) {
      productAdvance = parseServiceAmount(rawProductAdvance, "প্রোডাক্টের জমা");
    }
    let visitAdvance: number | null = null;
    const rawVisitAdvance = shared.visitAdvance;
    if (
      rawVisitAdvance !== undefined &&
      rawVisitAdvance !== null &&
      String(rawVisitAdvance).trim() !== ""
    ) {
      visitAdvance = parseServiceAmount(rawVisitAdvance, "জমা");
    }

    const activeTechnicians = await activeTechnicianNames();
    const cipher = await getCipherConfig();
    if (deviceRows.length > 0 && activeTechnicians.length === 0) {
      return NextResponse.json(
        { error: "প্রথমে একজন টেকনিশিয়ান যোগ করুন।" },
        { status: 400 }
      );
    }

    const payloads = deviceRows.map((device) => {
      const d =
        device && typeof device === "object" && !Array.isArray(device)
          ? (device as Record<string, unknown>)
          : {};
      // Customer/phone/technician/day are shared, but the expected handover
      // date belongs to the individual device. Fall back to the shared value
      // so older callers that only send one date keep working.
      const deviceDeliveryDate =
        typeof d.deliveryDate === "string" && d.deliveryDate.trim() !== ""
          ? d.deliveryDate
          : shared.deliveryDate;
      return validateServiceCreate(
        {
          // Shared fields come from the top level, never from a device row.
          customerName: visit.customerName,
          phone: visit.phone,
          technician: shared.technician,
          serviceDate: visit.serviceDateKey,
          deliveryDate: deviceDeliveryDate,
          model: d.model,
          problem: d.problem,
          totalBill: d.totalBill,
          advance: d.advance,
          status: d.status,
          shopExpense: d.shopExpense,
          partsShop: d.partsShop,
          // Work note is per device; customer terms are shared by the visit.
          solution: d.solution,
          condition: visit.condition ?? undefined,
          // Optional and per device — a blank IMEI stays NULL for that row.
          imei: d.imei,
          // Address is shared by the visit; warranty belongs to this device.
          customerAddress: visit.customerAddress,
          warranty: d.warranty,
          // Itemized parts belong to this device only.
          parts: d.parts,
        },
        { allowedTechnicians: activeTechnicians, cipher }
      );
    });

    const groupId = `g-${randomUUID()}`;
    const now = new Date();
    const result = await withStockTransaction(async (tx) => {
      const productTotal =
        products.length > 0 ? await quoteProductTotal(tx, products) : 0;
      const bills = [
        ...payloads.map((payload) => payload.totalBill),
        ...(products.length > 0 ? [productTotal] : []),
      ];
      const fallback =
        payloads.reduce((sum, payload) => sum + payload.advance, 0) +
        productAdvance;
      const advance = visitAdvance ?? fallback;
      const total = bills.reduce((sum, bill) => sum + bill, 0);
      if (advance > total) throw new Error(OVERPAY_MESSAGE);
      const shares = allocateVisitAdvance(bills, advance);

      const services: unknown[] = [];
      for (let index = 0; index < payloads.length; index += 1) {
        const p = payloads[index];
        const { serviceDateKey: _serviceDateKey, parts, ...data } = p;
        void _serviceDateKey;
        const rowAdvance = shares[index];
        const created = await tx.service.create({
          data: {
            ...data,
            advance: rowAdvance,
            due: computeDue(data.totalBill, rowAdvance),
            entryKind: "DEVICE",
            groupId,
            deliveredAt: data.status === "Delivered" ? now : null,
          },
        });
        if (parts.length > 0) {
          await replaceServiceParts(tx, created.id, parts);
        }
        services.push(created);
      }

      let anchorId: number | null = null;
      if (products.length > 0) {
        const anchorAdvance = shares[payloads.length];
        const created = await createProductSale(tx, {
          customerName: visit.customerName,
          phone: visit.phone,
          customerAddress: visit.customerAddress,
          serviceDate: visit.serviceDate,
          groupId,
          advance: anchorAdvance,
          saleRef: requestedSaleRef,
          condition: visit.condition,
          lines: products,
        });
        anchorId = created.serviceId;
      }
      return { services, anchorId };
    });

    let anchor: unknown = null;
    let saleItems: unknown[] = [];
    if (result.anchorId) {
      const [anchorRow, items] = await Promise.all([
        prisma.service.findUnique({ where: { id: result.anchorId } }),
        prisma.saleItem.findMany({
          where: { serviceId: result.anchorId },
          orderBy: { id: "asc" },
        }),
      ]);
      anchor = anchorRow;
      saleItems = items;
    }

    return NextResponse.json(
      {
        groupId,
        services: anchor ? [...result.services, anchor] : result.services,
        ...(anchor ? { saleItems } : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    if (
      requestedSaleRef &&
      !!err &&
      typeof err === "object" &&
      (err as { code?: unknown }).code === "P2002"
    ) {
      const existing = await loadSaleByRef(requestedSaleRef);
      if (existing) {
        return NextResponse.json(
          {
            duplicate: true,
            groupId: existing.groupId,
            services: existing.services,
            service: existing.anchor,
            anchor: existing.anchor,
            saleItems: existing.saleItems,
          },
          { status: 200 }
        );
      }
    }
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (isServiceValidationError(err) || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "সঠিক তথ্য দিন" },
        { status: 400 }
      );
    }
    console.error("POST /api/services/batch failed:", err);
    return NextResponse.json(
      { error: "একসাথে সেভ করা যায়নি" },
      { status: 500 }
    );
  }
}
