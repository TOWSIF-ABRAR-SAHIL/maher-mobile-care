import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const restored = await prisma.service.update({
      where: { id },
      data: { archived: false },
    });
    return NextResponse.json({ ok: true, id: restored.id });
  } catch (err: any) {
    if (err?.code === "P2025") {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }
    console.error(`POST /api/services/${params.id}/restore failed:`, err);
    return NextResponse.json(
      { error: "Failed to restore service" },
      { status: 500 }
    );
  }
}
