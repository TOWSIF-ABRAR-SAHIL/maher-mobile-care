import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { optionalNote } from "@/lib/service-validation";
import { RETURNED_STATUS } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/services/[id]/refund
 *
 * Closes an unfinished job as Returned and returns the full advance. The
 * original bill/advance stay on the row for audit; `due` becomes zero so the
 * customer can never appear in the dues list again. Stats exclude Returned
 * rows from revenue and technician performance.
 */
export async function POST(
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
    if (existing.archived) {
      return NextResponse.json(
        { error: "আর্কাইভ করা কাজ ফেরত দেওয়া যাবে না" },
        { status: 400 }
      );
    }
    if (existing.status === RETURNED_STATUS) {
      return NextResponse.json(
        { error: "এই কাজ আগেই ফেরত দেওয়া হয়েছে" },
        { status: 400 }
      );
    }

    const body = await req.json().catch(() => ({}));
    let note: string | null = null;
    try {
      note = optionalNote(body?.note, "ফেরত নোট");
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "ফেরত নোট সঠিক নয়" },
        { status: 400 }
      );
    }

    const updated = await prisma.service.update({
      where: { id },
      data: {
        status: RETURNED_STATUS,
        returnedAt: new Date(),
        refundAmount: existing.advance,
        refundNote: note,
        due: 0,
      },
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`POST /api/services/${params.id}/refund failed:`, err);
    return NextResponse.json(
      { error: "ফেরত দেওয়া যায়নি" },
      { status: 500 }
    );
  }
}
