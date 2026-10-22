import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Rows returned to the browser at once. The headline total is aggregated
 *  separately in SQL so it stays correct no matter how large the list grows. */
const LIST_LIMIT = 500;

/**
 * GET /api/services/dues → every active record with money outstanding.
 *
 * `count` and `totalDue` are SQL aggregates over ALL matching rows, so the
 * collection figure the shop reads is never truncated by `LIST_LIMIT`.
 * `services` is the newest-first page for rendering; `hasMore` tells the UI
 * when older unpaid rows exist beyond that page.
 */
export async function GET() {
  try {
    const where = {
      archived: false,
      status: { not: "Returned" },
      due: { gt: 0 },
    };
    const [services, totals] = await Promise.all([
      prisma.service.findMany({
        where,
        orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
        take: LIST_LIMIT,
      }),
      prisma.service.aggregate({
        where,
        _count: { _all: true },
        _sum: { due: true },
      }),
    ]);
    const count = totals._count._all;
    return NextResponse.json({
      count,
      totalDue: totals._sum.due ?? 0,
      hasMore: count > services.length,
      listed: services.length,
      services,
    });
  } catch (err) {
    console.error("GET /api/services/dues failed:", err);
    return NextResponse.json(
      { error: "বাকি তালিকা আনা যায়নি" },
      { status: 500 }
    );
  }
}
