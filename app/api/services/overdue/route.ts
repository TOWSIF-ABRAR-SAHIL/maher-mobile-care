import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaDateKey, dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import type { OverdueResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/services/overdue?date=YYYY-MM-DD
 *
 * Delivery backlog as of the requested day: rows whose expected handover date
 * has passed but that are still with the shop. `deliveredAt` is the source of
 * truth for an actual handover; Returned rows are cancelled and excluded.
 * This is intentionally date-independent (all service dates), so it must never
 * be presented as "today's new work".
 */
export async function GET(req: NextRequest) {
  try {
    const dateParam = req.nextUrl.searchParams.get("date");
    if (dateParam !== null && !isDateKey(dateParam)) {
      return NextResponse.json(
        { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const date = dateParam || dhakaDateKey(new Date());
    const { start } = dhakaRangeBounds(date, date);
    const where = {
      archived: false,
      deliveredAt: null,
      status: { not: "Returned" },
      deliveryDate: { not: null, lt: start },
    };

    const [count, totals, oldest] = await Promise.all([
      prisma.service.count({ where }),
      prisma.service.aggregate({ where, _sum: { due: true } }),
      prisma.service.findFirst({
        where,
        orderBy: { deliveryDate: "asc" },
        select: { deliveryDate: true },
      }),
    ]);

    const payload: OverdueResponse = {
      date,
      count,
      totalDue: totals._sum.due ?? 0,
      oldestDeliveryDate: oldest?.deliveryDate
        ? dhakaDateKey(oldest.deliveryDate)
        : null,
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/services/overdue failed:", err);
    return NextResponse.json(
      { error: "ওভারডিউ তালিকা আনা যায়নি" },
      { status: 500 }
    );
  }
}
