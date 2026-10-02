import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  isServiceValidationError,
  validateServiceUpdate,
} from "@/lib/service-validation";
import { activeTechnicianNames } from "@/lib/technicians";

export const dynamic = "force-dynamic";

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
    const allowedTechnicians = await activeTechnicianNames();
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
      },
      { allowedTechnicians }
    );

    const updated = await prisma.service.update({ where: { id }, data });
    return NextResponse.json(updated);
  } catch (err: unknown) {
    console.error(`PUT /api/services/${params.id} failed:`, err);
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
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    // Soft delete: record is hidden from lists/stats but restorable.
    const archived = await prisma.service.update({
      where: { id },
      data: { archived: true },
    });
    return NextResponse.json({ ok: true, id: archived.id });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    console.error(`DELETE /api/services/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "Failed to delete service" },
      { status: 500 }
    );
  }
}
