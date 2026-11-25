import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { InventoryConflictError } from "@/lib/inventory";
import {
  deleteServicePart,
  PartConflictError,
  resolveServicePart,
  setServicePartPaid,
} from "@/lib/parts-data";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * PATCH /api/service-parts/:id — whole-line resolution or Paid marker.
 *
 * A `partStatus` body applies the four-way resolution atomically; otherwise the
 * old Paid toggle is used. Neither is a payment: no supplier allocation and no
 * `Service.due` change. Unpaid needs a reason (append-only history); Paid on a
 * legacy row needs an explicit date + confirmation.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল পার্টস" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));

    // Four-way resolution wins when sent; the old Paid toggle stays intact.
    if (body?.partStatus !== undefined) {
      const updated = await resolveServicePart(id, {
        partStatus: body.partStatus,
        resolutionNote: body.resolutionNote,
        categoryName: body.categoryName,
        productName: body.productName,
        sellingPrice: body.sellingPrice,
        targetProductId: body.targetProductId,
      });
      if (!updated) {
        return NextResponse.json(
          { error: "পার্টস লাইন পাওয়া যায়নি" },
          { status: 404 }
        );
      }
      return NextResponse.json({ part: updated });
    }

    if (typeof body?.paid !== "boolean") {
      return NextResponse.json(
        { error: "Paid অবস্থা সঠিকভাবে দিন" },
        { status: 400 }
      );
    }
    const updated = await setServicePartPaid(id, {
      paid: body.paid,
      note: body.note == null ? null : String(body.note),
      purchaseDate:
        body.purchaseDate == null ? null : String(body.purchaseDate),
      confirmUnknownDate: body.confirmUnknownDate === true,
    });
    if (!updated) {
      return NextResponse.json(
        { error: "পার্টস লাইন পাওয়া যায়নি" },
        { status: 404 }
      );
    }
    return NextResponse.json({ part: updated });
  } catch (err) {
    if (err instanceof PartConflictError || err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(`PATCH /api/service-parts/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "পার্টস লাইন বদলানো যায়নি" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/service-parts/:id — remove one line.
 *
 * A returned job's parts are frozen (409) and money evidence (paid/history)
 * can never be erased. Legacy unknown-date rows require confirmation + reason.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল পার্টস" }, { status: 400 });
    }
    const part = await prisma.servicePart.findUnique({ where: { id } });
    if (!part) {
      return NextResponse.json(
        { error: "পার্টস লাইন পাওয়া যায়নি" },
        { status: 404 }
      );
    }
    const service = await prisma.service.findUnique({
      where: { id: part.serviceId },
      select: { status: true, archived: true },
    });
    if (service?.status === "Returned") {
      return NextResponse.json(
        { error: "ফেরত দেওয়া কাজের পার্টস মোছা যাবে না" },
        { status: 409 }
      );
    }
    const body = await req.json().catch(() => ({}));
    await deleteServicePart(id, {
      confirmUnknownDate: body?.confirmUnknownDate === true,
      note: body?.note == null ? null : String(body.note),
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof PartConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error(`DELETE /api/service-parts/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "পার্টস লাইন মোছা যায়নি" },
      { status: 500 }
    );
  }
}
