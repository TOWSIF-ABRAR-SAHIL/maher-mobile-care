import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PRODUCT_INCLUDE, toProductDTO } from "@/lib/inventory-data";
import {
  InventoryConflictError,
  isInventoryValidationError,
} from "@/lib/inventory";
import {
  restockProduct,
  validateRestock,
  withStockTransaction,
} from "@/lib/stock";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** POST /api/products/:id/restock { quantity, purchasePrice?, reason? } */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল প্রোডাক্ট" }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    const input = validateRestock(body);

    await withStockTransaction((tx) => restockProduct(tx, id, input));

    const product = await prisma.product.findUniqueOrThrow({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    return NextResponse.json({ ok: true, product: toProductDTO(product) });
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
    console.error(`POST /api/products/${params.id}/restock failed:`, err);
    return NextResponse.json(
      { error: "স্টক যোগ করা যায়নি" },
      { status: 500 }
    );
  }
}
