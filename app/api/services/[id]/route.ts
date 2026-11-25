import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isServiceValidationError,
  validateServiceUpdate,
} from "@/lib/service-validation";
import { activeTechnicianNames } from "@/lib/technicians";
import { getCipherConfig } from "@/lib/shop-settings";
import {
  archiveProductEntry,
  editProductLines,
  parseProductLines,
  withStockTransaction,
} from "@/lib/stock";
import { InventoryConflictError } from "@/lib/inventory";
import { parseBnNumber } from "@/lib/utils";
import {
  partsCostByService,
  PartConflictError,
  replaceServiceParts,
  servicePartsFor,
} from "@/lib/parts-data";

export const dynamic = "force-dynamic";

/** GET /api/services/:id — one row, for deep-link edit/receipt navigation. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const service = await prisma.service.findUnique({ where: { id } });
    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    const saleItems = await prisma.saleItem.findMany({
      where: { serviceId: id },
      orderBy: { id: "asc" },
    });
    const [parts, costs] = await Promise.all([
      servicePartsFor([id]).then((map) => map.get(id) ?? []),
      partsCostByService([id]),
    ]);
    return NextResponse.json({
      ...service,
      saleItems,
      parts,
      partsCost: costs.has(id) ? costs.get(id)! : null,
    });
  } catch (err) {
    console.error(`GET /api/services/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Failed to fetch service" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const body = await req.json();

    // Money on a fully paid slip (due 0): the settled advance is frozen, and
    // the bill may only RISE. One deliberate exception: a fault found later
    // needs a new part, so the bill rises and the customer can pay that extra
    // charge at the counter by raising জমা in the same save. The advance may
    // never fall, and may never move unless the bill also rises — otherwise a
    // settled slip's money would be silently rewritten. validateServiceUpdate
    // still rejects an advance above the new bill (overpay), and Returned rows
    // are frozen everywhere below.
    const parseMoney = (raw: unknown): number | null => {
      if (raw === undefined || raw === null) return null;
      const parsed = parseBnNumber(raw);
      return parsed === null ? null : Math.floor(parsed);
    };
    const bodyRecord = body as Record<string, unknown>;
    const billSent = bodyRecord?.totalBill !== undefined && bodyRecord?.totalBill !== null;
    const advanceSent = bodyRecord?.advance !== undefined && bodyRecord?.advance !== null;
    const nextBill = parseMoney(bodyRecord?.totalBill);
    const nextAdvance = parseMoney(bodyRecord?.advance);
    const billLowered = nextBill !== null && nextBill < existing.totalBill;
    const advanceLowered = nextAdvance !== null && nextAdvance < existing.advance;
    const advanceChanged = nextAdvance !== null && nextAdvance !== existing.advance;
    const paidTogether =
      nextBill !== null &&
      nextBill > existing.totalBill &&
      nextAdvance !== null &&
      nextAdvance > existing.advance;
    if (
      existing.due === 0 &&
      existing.status !== "Returned" &&
      (billLowered ||
        (billSent && nextBill === null) ||
        advanceLowered ||
        (advanceSent && nextAdvance === null) ||
        (advanceChanged && !paidTogether))
    ) {
      return NextResponse.json(
        {
          error:
            "পরিশোধিত স্লিপে জমা বদলাতে হলে বিলও বাড়াতে হবে — জমা শুধু বাড়ানো যাবে",
        },
        { status: 400 }
      );
    }

    // A product anchor's money is derived from its sale lines. Direct bill
    // edits would desync the stock ledger and the receipt.
    if (existing.entryKind === "PRODUCT") {
      const locked = ["totalBill", "advance", "status", "saleRef"];
      if (locked.some((key) => body?.[key] !== undefined)) {
        return NextResponse.json(
          { error: "প্রোডাক্ট বিক্রয়ের বিল লাইন এডিট থেকে বদলান" },
          { status: 400 }
        );
      }
      // A bill holder is not a repair: parts belong to device rows only.
      if (body?.parts !== undefined) {
        return NextResponse.json(
          { error: "প্রোডাক্ট বিক্রির স্লিপে পার্টস যোগ করা যাবে না" },
          { status: 400 }
        );
      }
    }
    // A returned job's parts are frozen like its bill: refund bookkeeping and
    // the supplier ledger must stay reproducible. The paid marker itself is
    // still allowed through the dedicated ledger endpoint.
    if (existing.status === "Returned" && body?.parts !== undefined) {
      return NextResponse.json(
        { error: "ফেরত দেওয়া কাজের পার্টস বদলানো যাবে না" },
        { status: 409 }
      );
    }
    const activeTechnicians = await activeTechnicianNames();
    // Keep an edited row's own technician valid even after that person was
    // deactivated. Without this, saving an old job would force a reassignment
    // or fail, even though the form still offers the inactive name.
    const allowedTechnicians = Array.from(
      new Set(
        existing.technician
          ? [...activeTechnicians, existing.technician]
          : activeTechnicians
      )
    );
    if (allowedTechnicians.length === 0) {
      return NextResponse.json(
        { error: "প্রথমে একজন টেকনিশিয়ান যোগ করুন।" },
        { status: 400 }
      );
    }
    const data = validateServiceUpdate(
      body,
      {
        totalBill: existing.totalBill,
        advance: existing.advance,
        status: existing.status,
      },
      { allowedTechnicians, cipher: await getCipherConfig() }
    );

    // Itemized parts are not a Service column: they are replaced atomically
    // alongside the row, in the same transaction as any product-line edits.
    const { parts, ...serviceData } = data;

    // Actual handover time follows the status: first move into Delivered
    // stamps it, reopening the job clears it so a stale date is never printed.
    if (serviceData.status !== undefined) {
      serviceData.deliveredAt =
        serviceData.status === "Delivered"
          ? existing.deliveredAt ?? new Date()
          : null;
    }

    // Product lines travel with the same request when a visit is edited, so
    // the row update and the stock ledger commit together.
    const rawProducts = (body as Record<string, unknown>)?.products;
    const productLines =
      rawProducts === undefined ? null : parseProductLines(rawProducts);
    if (productLines) {
      const rawAnchorId = Number(
        (body as Record<string, unknown>)?.anchorId
      );
      const anchorId =
        Number.isInteger(rawAnchorId) && rawAnchorId > 0
          ? rawAnchorId
          : existing.entryKind === "PRODUCT"
            ? id
            : null;
      if (!anchorId) {
        return NextResponse.json(
          { error: "প্রোডাক্ট লাইনের এন্ট্রি পাওয়া যায়নি" },
          { status: 400 }
        );
      }
      const anchor = await prisma.service.findUnique({ where: { id: anchorId } });
      if (!anchor || anchor.entryKind !== "PRODUCT") {
        return NextResponse.json(
          { error: "প্রোডাক্ট লাইনের এন্ট্রি পাওয়া যায়নি" },
          { status: 400 }
        );
      }
      if (existing.groupId && anchor.groupId !== existing.groupId) {
        return NextResponse.json(
          { error: "প্রোডাক্ট লাইন এই ভিজিটের নয়" },
          { status: 400 }
        );
      }
      await withStockTransaction(async (tx) => {
        await tx.service.update({ where: { id }, data: serviceData });
        if (parts !== undefined) {
          await replaceServiceParts(tx, id, parts);
        }
        await editProductLines(tx, anchorId, productLines);
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.service.update({ where: { id }, data: serviceData });
        if (parts !== undefined) {
          await replaceServiceParts(tx, id, parts);
        }
      });
    }
    const updated = await prisma.service.findUnique({ where: { id } });
    const [savedParts, savedCosts] = await Promise.all([
      servicePartsFor([id]).then((map) => map.get(id) ?? []),
      partsCostByService([id]),
    ]);
    return NextResponse.json({
      ...updated,
      parts: savedParts,
      partsCost: savedCosts.has(id) ? savedCosts.get(id)! : null,
    });
  } catch (err: unknown) {
    console.error(`PUT /api/services/${params.id} failed:`, err);
    if (err instanceof PartConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (isServiceValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to update service" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    const scope = req.nextUrl.searchParams.get("scope");
    if (scope === "group" && existing.groupId) {
      // Archiving a whole visit takes its product lines back to stock too.
      const ids = await withStockTransaction(async (tx) => {
        const rows = await tx.service.findMany({
          where: { groupId: existing.groupId!, archived: false },
          select: { id: true, entryKind: true },
          orderBy: { id: "asc" },
        });
        for (const row of rows) {
          if (row.entryKind === "PRODUCT") {
            await archiveProductEntry(tx, row.id);
          }
        }
        await tx.service.updateMany({
          where: { groupId: existing.groupId!, archived: false },
          data: { archived: true },
        });
        return rows.map((row) => row.id);
      });
      return NextResponse.json({
        ok: true,
        groupId: existing.groupId,
        ids,
      });
    }
    // Soft delete: record is hidden from lists/stats but restorable. A product
    // anchor additionally puts its goods back into stock (and marks the lines
    // ARCHIVE) so a later restore can deduct them again.
    await withStockTransaction(async (tx) => {
      if (existing.entryKind === "PRODUCT" && !existing.archived) {
        await archiveProductEntry(tx, id);
      }
      await tx.service.update({ where: { id }, data: { archived: true } });
    });
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`DELETE /api/services/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Failed to delete service" },
      { status: 500 }
    );
  }
}
