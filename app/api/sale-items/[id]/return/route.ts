import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { returnProductLine, withStockTransaction } from "@/lib/stock";
import { InventoryConflictError } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** POST /api/sale-items/:id/return { damaged?, kind? } — full-line return. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "ভুল লাইন" }, { status: 400 });
    }
    const body = await req.json().catch(() => ({}));
    const damaged = body?.damaged === true;
    const kind = body?.kind === "CANCEL" ? "CANCEL" : "RETURN";

    const result = await withStockTransaction((tx) =>
      returnProductLine(tx, id, kind, damaged)
    );

    const [service, saleItems] = await Promise.all([
      prisma.service.findUnique({ where: { id: result.serviceId } }),
      prisma.saleItem.findMany({
        where: { serviceId: result.serviceId },
        orderBy: { id: "asc" },
      }),
    ]);
    return NextResponse.json({ ok: true, ...result, service, saleItems });
  } catch (err) {
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`POST /api/sale-items/${params.id}/return failed:`, err);
    return NextResponse.json(
      { error: "ফেরত দেওয়া যায়নি" },
      { status: 500 }
    );
  }
}
