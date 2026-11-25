import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** GET /api/products/:id/movements?limit=50 — append-only stock ledger. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: "ভুল প্রোডাক্ট" }, { status: 400 });
    }
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit")) || 50, 1),
      500
    );
    const [product, movements] = await Promise.all([
      prisma.product.findUnique({
        where: { id },
        select: { id: true, name: true, stock: true },
      }),
      prisma.stockMovement.findMany({
        where: { productId: id },
        orderBy: { id: "desc" },
        take: limit,
      }),
    ]);
    if (!product) {
      return NextResponse.json(
        { error: "প্রোডাক্ট পাওয়া যায়নি" },
        { status: 404 }
      );
    }
    return NextResponse.json({ product, movements });
  } catch (err) {
    console.error(`GET /api/products/${params.id}/movements failed:`, err);
    return NextResponse.json(
      { error: "স্টক লেজার লোড করা যায়নি" },
      { status: 500 }
    );
  }
}
