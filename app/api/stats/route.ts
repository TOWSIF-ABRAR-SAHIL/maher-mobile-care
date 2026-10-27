import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaDateKey, dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import { FALLBACK_TECHNICIANS, parseBnNumber } from "@/lib/utils";
import { cardRows } from "@/lib/technicians";
import type { StatsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const dateParam = sp.get("date");
    const from = sp.get("from");
    const to = sp.get("to");
    const all = sp.get("all") === "1";
    if (dateParam !== null && !isDateKey(dateParam)) {
      return NextResponse.json(
        { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    // Day (legacy), range (?from&to) and whole-ledger (?all=1) share ONE
    // aggregation path — only the date window differs.
    let date: string;
    let range: { from: string; to: string } | undefined;
    let bounds: { start: Date; end: Date } | null = null;
    if (all) {
      date = dhakaDateKey(new Date());
    } else if (from !== null || to !== null) {
      if (!from || !to || !isDateKey(from) || !isDateKey(to)) {
        return NextResponse.json(
          { error: "শুরু ও শেষ তারিখ দিন (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      if (from > to) {
        return NextResponse.json(
          { error: "শুরুর তারিখ শেষের তারিখের আগে" },
          { status: 400 }
        );
      }
      bounds = dhakaRangeBounds(from, to);
      range = { from, to };
      date = to;
    } else {
      date = dateParam || dhakaDateKey(new Date());
      bounds = dhakaRangeBounds(date, date);
    }

    const rows = await prisma.service.findMany({
      where: {
        archived: false,
        ...(bounds ? { serviceDate: { gte: bounds.start, lte: bounds.end } } : {}),
      },
      select: {
        technician: true,
        totalBill: true,
        advance: true,
        due: true,
        status: true,
        expenseAmount: true,
        expenseWrittenOff: true,
        damageLoss: true,
        refundAmount: true,
        shopExpense: true,
      },
    });
    const activeRows = rows.filter((r) => r.status !== "Returned");
    const returnedRows = rows.filter((r) => r.status === "Returned");

    const specs = await cardRows(activeRows.map((r) => r.technician));
    const techStats = specs.map(({ technician, isActive }) => {
      // Case-insensitive so a card total can never drift from the day total
      // just because a historical row was typed in a different case.
      const mine = activeRows.filter(
        (r) => r.technician.toUpperCase() === technician.toUpperCase()
      );
      return {
        technician,
        isActive,
        count: mine.length,
        bill: mine.reduce((s, r) => s + r.totalBill, 0),
      };
    });

    const payload: StatsResponse = {
      date,
      ...(range ? { range } : {}),
      techStats,
      today: {
        count: activeRows.length,
        bill: activeRows.reduce((s, r) => s + r.totalBill, 0),
        due: activeRows.reduce((s, r) => s + r.due, 0),
        advance: activeRows.reduce((s, r) => s + r.advance, 0),
        // A returned job whose parts were unused/returned never cost the shop;
        // keep the row for audit but skip its amount in every report.
        expense: rows.reduce(
          (s, r) => s + (r.expenseWrittenOff ? 0 : r.expenseAmount),
          0
        ),
        damageLoss: rows.reduce((s, r) => s + r.damageLoss, 0),
        refund: returnedRows.reduce((s, r) => s + r.refundAmount, 0),
        returnedCount: returnedRows.length,
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
