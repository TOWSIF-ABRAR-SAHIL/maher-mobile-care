import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serviceDateFromKey } from "@/lib/dhaka";
import {
  STATUSES,
  TECHNICIANS,
  computeDue,
  parseBnNumber,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

function toInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a number ≥ 0`);
  }
  return Math.floor(n);
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
    const data: Record<string, unknown> = {};

    if (body.customerName !== undefined) {
      const v = String(body.customerName).trim();
      if (!v) throw new Error("কাস্টমারের নাম আবশ্যক");
      data.customerName = v;
    }
    if (body.phone !== undefined) {
      const v = String(body.phone).trim();
      if (!v) throw new Error("মোবাইল নম্বর আবশ্যক");
      data.phone = v;
    }
    if (body.model !== undefined) {
      const v = String(body.model).trim();
      if (!v) throw new Error("মোবাইলের মডেল আবশ্যক");
      data.model = v;
    }
    if (body.technician !== undefined) {
      const v = String(body.technician).trim();
      if (!(TECHNICIANS as readonly string[]).includes(v)) {
        throw new Error("সঠিক টেকনিশিয়ান বাছুন");
      }
      data.technician = v;
    }
    if (body.problem !== undefined) {
      const v = String(body.problem).trim();
      if (!v) throw new Error("সমস্যা লিখুন");
      data.problem = v;
    }
    if (body.status !== undefined) {
      const v = String(body.status);
      if (!(STATUSES as readonly string[]).includes(v)) {
        throw new Error("সঠিক অবস্থা বাছুন");
      }
      data.status = v;
    }
    if (body.serviceDate !== undefined) {
      // Wrong-day entries can be moved without delete + recreate.
      data.serviceDate = serviceDateFromKey(String(body.serviceDate));
    }

    const totalBill =
      body.totalBill !== undefined
        ? toInt(body.totalBill, "মোট বিল")
        : existing.totalBill;
    const advance =
      body.advance !== undefined ? toInt(body.advance, "জমা") : existing.advance;
    data.totalBill = totalBill;
    data.advance = advance;
    // বাকি is always derived — never trusted from the client.
    data.due = computeDue(totalBill, advance);

    if (body.shopExpense !== undefined) {
      const raw = String(body.shopExpense ?? "").trim();
      data.shopExpense = raw ? raw : null;
      data.expenseAmount = parseBnNumber(raw) ?? 0;
    }

    const updated = await prisma.service.update({ where: { id }, data: data as never });
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error(`PUT /api/services/${params.id} failed:`, err);
    if (
      err instanceof Error &&
      /আবশ্যক|বাছুন|লিখুন|must be|Invalid date/.test(err.message)
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
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
