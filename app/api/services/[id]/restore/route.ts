import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { restoreProductEntry, withStockTransaction } from "@/lib/stock";
import { InventoryConflictError } from "@/lib/inventory";

export const dynamic = "force-dynamic";

/** Bring an archived (soft-deleted) service back into lists/stats. */
export async function POST(
  _req: NextRequest,
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

    await withStockTransaction(async (tx) => {
      // A product entry put its goods back on archive; restoring means the
      // sale is live again, so those lines are deducted once more.
      if (existing.entryKind === "PRODUCT") {
        await restoreProductEntry(tx, id);
      }
      await tx.service.update({ where: { id }, data: { archived: false } });
    });
    return NextResponse.json({ ok: true, id });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    if (err instanceof InventoryConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error(`POST /api/services/${params.id}/restore failed:`, err);
    return NextResponse.json(
      { error: "Failed to restore service" },
      { status: 500 }
    );
  }
}
