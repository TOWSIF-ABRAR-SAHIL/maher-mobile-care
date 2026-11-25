import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  editProductLines,
  parseProductLines,
  withStockTransaction,
} from "@/lib/stock";
import {
  InventoryConflictError,
  isInventoryValidationError,
} from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** PUT /api/services/:id/lines { lines } — edit the product lines of an anchor. */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ভুল আইডি" }, { status: 400 });
    }
    const existing = await prisma.service.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "এন্ট্রি পাওয়া যায়নি" }, { status: 404 });
    }
    if (existing.entryKind !== "PRODUCT") {
      return NextResponse.json(
        { error: "এই এন্ট্রিতে প্রোডাক্ট লাইন নেই" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => null);
    const lines = parseProductLines(body?.lines);
    if (lines.length === 0) {
      return NextResponse.json(
        { error: "অন্তত একটি প্রোডাক্ট লাইন দিন" },
        { status: 400 }
      );
    }

    await withStockTransaction((tx) => editProductLines(tx, id, lines));

    const [service, saleItems] = await Promise.all([
      prisma.service.findUnique({ where: { id } }),
      prisma.saleItem.findMany({
        where: { serviceId: id },
        orderBy: { id: "asc" },
      }),
    ]);
    return NextResponse.json({ ok: true, service, saleItems });
  } catch (err) {
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error(`PUT /api/services/${params.id}/lines failed:`, err);
    return NextResponse.json({ error: "লাইন সেভ করা যায়নি" }, { status: 500 });
  }
}
