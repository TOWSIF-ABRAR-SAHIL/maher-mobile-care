import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cancelProductEntry, withStockTransaction } from "@/lib/stock";
import { InventoryConflictError } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** POST /api/services/:id/cancel { damaged? } — cancel a product-sale entry. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ভুল আইডি" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const damaged = body?.damaged === true;

    const result = await withStockTransaction((tx) =>
      cancelProductEntry(tx, id, damaged)
    );

    const [service, saleItems] = await Promise.all([
      prisma.service.findUnique({ where: { id } }),
      prisma.saleItem.findMany({
        where: { serviceId: id },
        orderBy: { id: "asc" },
      }),
    ]);
    return NextResponse.json({ ok: true, ...result, service, saleItems });
  } catch (err) {
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`POST /api/services/${params.id}/cancel failed:`, err);
    return NextResponse.json({ error: "বাতিল করা যায়নি" }, { status: 500 });
  }
}
