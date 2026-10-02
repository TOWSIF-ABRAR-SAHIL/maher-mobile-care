import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaDateKey, dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import { TECHNICIANS, parseBnNumber } from "@/lib/utils";
import type { StatsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

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
    const { start, end } = dhakaRangeBounds(date, date);

    const rows = await prisma.service.findMany({
      where: { archived: false, serviceDate: { gte: start, lte: end } },
      select: { technician: true, totalBill: true, due: true, expenseAmount: true, shopExpense: true },
    });

    const techStats = TECHNICIANS.map((t) => {
      const mine = rows.filter((r) => r.technician === t);
      return {
        technician: t,
        count: mine.length,
        bill: mine.reduce((s, r) => s + r.totalBill, 0),
      };
    });

    const payload: StatsResponse = {
      date,
      techStats,
      today: {
        count: rows.length,
        bill: rows.reduce((s, r) => s + r.totalBill, 0),
        due: rows.reduce((s, r) => s + r.due, 0),
        expense: rows.reduce((s, r) => s + r.expenseAmount, 0),
        codeCount: rows.filter(
          (r) => (r.shopExpense ?? "").trim() !== "" && parseBnNumber(r.shopExpense) === null
        ).length,
      },
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/stats failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
