import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  dhakaDateKey,
  dhakaRangeBounds,
  isDateKey,
} from "@/lib/dhaka";
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
import {
  partsCostByService,
  replaceServiceParts,
  servicePartsFor,
} from "@/lib/parts-data";

// Next 14 caches GET route handlers by default — stats must stay fresh.
export const dynamic = "force-dynamic";

/**
 * Attaches the visit's product lines and the device's itemized parts to every
 * returned row. Both are internal (a receipt never prints a part cost), and
 * `partsCost` is what খরচ/লাভ reports use for a device that has parts.
 */
async function attachSaleItems<T extends { id: number }>(services: T[]) {
  if (services.length === 0) return services;
  const ids = services.map((service) => service.id);
  const [rows, partsByService, costs] = await Promise.all([
    prisma.saleItem.findMany({
      where: { serviceId: { in: ids } },
      orderBy: { id: "asc" },
    }),
    servicePartsFor(ids),
    partsCostByService(ids),
  ]);
  const byService = new Map<number, unknown[]>();
  for (const row of rows) {
    const list = byService.get(row.serviceId) ?? [];
    list.push(row);
    byService.set(row.serviceId, list);
  }
  return services.map((service) => {
    const parts = partsByService.get(service.id) ?? [];
    return {
      ...service,
      saleItems: byService.get(service.id) ?? [],
      parts,
      partsCost: costs.has(service.id) ? costs.get(service.id)! : null,
    };
  });
}

export async function GET(req: NextRequest) {
  try {
    // ?groupId=… → every device row from one customer visit, for the
    // combined receipt/payment slip. Archived rows are never printed.
    const groupId = req.nextUrl.searchParams.get("groupId");
    if (groupId !== null) {
      if (!groupId.trim() || groupId.length > 80) {
        return NextResponse.json({ error: "ভুল গ্রুপ আইডি" }, { status: 400 });
      }
      const services = await prisma.service.findMany({
        where: { groupId: groupId.trim(), archived: false },
        orderBy: { id: "asc" },
      });
      return NextResponse.json({
        groupId: groupId.trim(),
        services: await attachSaleItems(services),
      });
    }
    // ?archived=true → every archived record (all dates, for restore view).
    if (req.nextUrl.searchParams.get("archived") === "true") {
      const services = await prisma.service.findMany({
        where: { archived: true },
        orderBy: { id: "desc" },
      });
      return NextResponse.json({
        archived: true,
        services: await attachSaleItems(services),
      });
    }
    // v1.3 multi-date scopes: ?from&to (range) or ?all=1. Capped rendering
    // plus a SQL count() aggregate keeps a huge window cheap; day mode below
    // stays byte-identical for every existing caller.
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const all = sp.get("all") === "1";
    if (all || from !== null || to !== null) {
      if (!all) {
        if (!from || !to || !isDateKey(from) || !isDateKey(to)) {
          return NextResponse.json(
            { error: "শুরু ও শেষ তারিখ দিন (YYYY-MM-DD)" },
            { status: 400 }
          );
        }
        if (from > to) {
          return NextResponse.json(
            { error: "শুরুর তারিখ শেষের তারিখের আগে" },
            { status: 400 }
          );
        }
      }
      // Page size 300 (client default), never above 1000.
      const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 1000);
      const offset = Math.max(Number(sp.get("offset")) || 0, 0);
      const bounds = all ? null : dhakaRangeBounds(from!, to!);
      const where = {
        archived: false,
        ...(bounds ? { serviceDate: { gte: bounds.start, lte: bounds.end } } : {}),
      };
      const [total, services] = await Promise.all([
        prisma.service.count({ where }),
        prisma.service.findMany({
          where,
          // Newest day first so a multi-date view opens on recent work.
          orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
          skip: offset,
          take: limit,
        }),
      ]);
      return NextResponse.json({
        mode: all ? "all" : "range",
        ...(all ? {} : { from, to }),
        total,
        offset,
        shown: services.length,
        hasMore: offset + services.length < total,
        services: await attachSaleItems(services),
      });
    }
    const dateParam = req.nextUrl.searchParams.get("date");
    if (dateParam !== null && !isDateKey(dateParam)) {
      return NextResponse.json(
        { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const date = dateParam || dhakaDateKey(new Date());
    const { start, end } = dhakaRangeBounds(date, date);
    const services = await prisma.service.findMany({
      where: { archived: false, serviceDate: { gte: start, lte: end } },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({
      date,
      services: await attachSaleItems(services),
    });
  } catch (err) {
    console.error("GET /api/services failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

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
    const body = await req.json();
    const raw = body as Record<string, unknown>;
    const products = parseProductLines(raw?.products);
    requestedSaleRef = products.length > 0 ? parseSaleRef(raw?.saleRef) : null;

    // A retried submit resolves to the original visit and writes nothing.
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

    // Product lines change stock: the device row (if any) and the product
    // anchor must commit together, so both paths share one transaction.
    if (products.length > 0) {
      const visit = validateVisitShared(body);
      const hasDevice = ["model", "problem", "technician"].some(
        (key) => String(raw?.[key] ?? "").trim() !== ""
      );

      let payload: ReturnType<typeof validateServiceCreate> | null = null;
      if (hasDevice) {
        const allowedTechnicians = await activeTechnicianNames();
        if (allowedTechnicians.length === 0) {
          return NextResponse.json(
            { error: "প্রথমে একজন টেকনিশিয়ান যোগ করুন।" },
            { status: 400 }
          );
        }
        payload = validateServiceCreate(body, {
          allowedTechnicians,
          cipher: await getCipherConfig(),
        });
      }

      let productAdvance = 0;
      const rawAdvance = raw?.productAdvance;
      if (
        rawAdvance !== undefined &&
        rawAdvance !== null &&
        String(rawAdvance).trim() !== ""
      ) {
        productAdvance = parseServiceAmount(rawAdvance, "প্রোডাক্টের জমা");
      }
      // One visit advance is allocated devices-first, then products. When the
      // caller sends it, per-row advances are ignored so the waterfall cannot
      // be bypassed.
      let visitAdvance: number | null = null;
      const rawVisitAdvance = raw?.visitAdvance;
      if (
        rawVisitAdvance !== undefined &&
        rawVisitAdvance !== null &&
        String(rawVisitAdvance).trim() !== ""
      ) {
        visitAdvance = parseServiceAmount(rawVisitAdvance, "জমা");
      }

      const groupId = `g-${randomUUID()}`;
      const now = new Date();
      const result = await withStockTransaction(async (tx) => {
        const productTotal = await quoteProductTotal(tx, products);
        const bills = [
          ...(payload ? [payload.totalBill] : []),
          productTotal,
        ];
        const advance =
          visitAdvance ?? (payload?.advance ?? 0) + productAdvance;
        const total = bills.reduce((sum, bill) => sum + bill, 0);
        if (advance > total) throw new Error(OVERPAY_MESSAGE);
        const shares = allocateVisitAdvance(bills, advance);
        const deviceAdvance = payload ? shares[0] : 0;
        const anchorAdvance = payload ? shares[1] : shares[0];

        let service: unknown = null;
        if (payload) {
          const { serviceDateKey: _key, parts, ...data } = payload;
          void _key;
          const created = await tx.service.create({
            data: {
              ...data,
              advance: deviceAdvance,
              due: computeDue(data.totalBill, deviceAdvance),
              entryKind: "DEVICE",
              groupId,
              deliveredAt: data.status === "Delivered" ? now : null,
            },
          });
          if (parts.length > 0) {
            await replaceServiceParts(tx, created.id, parts);
          }
          service = created;
        }
        const anchor = await createProductSale(tx, {
          customerName: visit.customerName,
          phone: visit.phone,
          customerAddress: visit.customerAddress,
          serviceDate: visit.serviceDate,
          groupId,
          advance: anchorAdvance,
          saleRef: requestedSaleRef,
          // Customer terms belong to the visit; the anchor is a visit row too.
          condition: visit.condition,
          lines: products,
        });
        return { service, anchorId: anchor.serviceId };
      });

      const [anchor, saleItems] = await Promise.all([
        prisma.service.findUnique({ where: { id: result.anchorId } }),
        prisma.saleItem.findMany({
          where: { serviceId: result.anchorId },
          orderBy: { id: "asc" },
        }),
      ]);
      return NextResponse.json(
        {
          groupId,
          service: result.service ?? anchor,
          anchor,
          saleItems,
        },
        { status: 201 }
      );
    }

    // v1.1: the accepted technician names come from the database, so a
    // left-the-shop technician can no longer be booked.
    const allowedTechnicians = await activeTechnicianNames();
    if (allowedTechnicians.length === 0) {
      return NextResponse.json(
        { error: "প্রথমে একজন টেকনিশিয়ান যোগ করুন।" },
        { status: 400 }
      );
    }
    const validated = validateServiceCreate(body, {
      allowedTechnicians,
      cipher: await getCipherConfig(),
    });
    const { serviceDateKey: _serviceDateKey, parts, ...serviceData } = validated;
    void _serviceDateKey;
    // The row and its parts are one document: both commit or neither does.
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.service.create({
        data: {
          ...serviceData,
          entryKind: "DEVICE",
          // Handover time is server-owned; a product sale is delivered at save.
          deliveredAt:
            serviceData.status === "Delivered" ? new Date() : null,
        },
      });
      if (parts.length > 0) {
        await replaceServiceParts(tx, row.id, parts);
      }
      return row;
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    // Concurrent duplicate submit: the unique index rejected the loser. The
    // winner's rows are already committed, so answer with those ids.
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
      return NextResponse.json(
        { error: err.message },
        { status: 409 }
      );
    }
    if (isServiceValidationError(err) || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/services failed:", err);
    return NextResponse.json(
      { error: "Failed to create service" },
      { status: 500 }
    );
  }
}
