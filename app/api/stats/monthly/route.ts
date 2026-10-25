import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaDateKey, dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import type { MonthlyResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export async function GET(req: NextRequest) {
  try {
    // Custom range (?from=&to=) for month/custom reports. Falls back to the
    // legacy 30-day window ending on ?date= so old callers keep working.
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    let from: string;
    let to: string;
    if (fromParam !== null || toParam !== null) {
      if (!isDateKey(fromParam) || !isDateKey(toParam)) {
        return NextResponse.json(
          { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      from = fromParam as string;
      to = toParam as string;
      if (from > to) {
        return NextResponse.json(
          { error: "শুরুর তারিখ শেষের তারিখের পরে" },
          { status: 400 }
        );
      }
      const days =
        (Date.UTC(
          Number(to.slice(0, 4)),
          Number(to.slice(5, 7)) - 1,
          Number(to.slice(8, 10))
        ) -
          Date.UTC(
            Number(from.slice(0, 4)),
            Number(from.slice(5, 7)) - 1,
            Number(from.slice(8, 10))
          )) /
        DAY_MS;
      if (days > 366) {
        return NextResponse.json(
          { error: "সর্বোচ্চ ১ বছরের রিপোর্ট" },
          { status: 400 }
        );
      }
    } else {
      const dateParam = req.nextUrl.searchParams.get("date");
      if (dateParam !== null && !isDateKey(dateParam)) {
        return NextResponse.json(
          { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      to = dateParam || dhakaDateKey(new Date());
      from = shiftKey(to, -29); // 30-day window ending on the selected date
    }
    const { start, end } = dhakaRangeBounds(from, to);

    const rows = await prisma.service.findMany({
      where: { archived: false, serviceDate: { gte: start, lte: end } },
      select: {
        totalBill: true,
        advance: true,
        expenseAmount: true,
        expenseWrittenOff: true,
        due: true,
        status: true,
        damageLoss: true,
        refundAmount: true,
      },
    });
    const activeRows = rows.filter((r) => r.status !== "Returned");
    const returnedRows = rows.filter((r) => r.status === "Returned");
    const bill = activeRows.reduce((s, r) => s + r.totalBill, 0);
    const advance = activeRows.reduce((s, r) => s + r.advance, 0);
    // Written-off return costs stay on the row for audit but never hit reports.
    const expense = rows.reduce(
      (s, r) => s + (r.expenseWrittenOff ? 0 : r.expenseAmount),
      0
    );
    const due = activeRows.reduce((s, r) => s + r.due, 0);
    const damageLoss = rows.reduce((s, r) => s + r.damageLoss, 0);
    const refund = returnedRows.reduce((s, r) => s + r.refundAmount, 0);

    const payload: MonthlyResponse = {
      from,
      to,
      summary: {
        count: activeRows.length,
        bill,
        advance,
        expense,
        due,
        profit: bill - expense - damageLoss,
        damageLoss,
        refund,
        returnedCount: returnedRows.length,
      },
    };
    return NextResponse.json(payload);
  } catch (err) {
    console.error("GET /api/stats/monthly failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch monthly summary" },
      { status: 500 }
    );
  }
}
