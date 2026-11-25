import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaDateKey, dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import { effectiveRepairCost, partsCostOf } from "@/lib/parts";
import { partsCostByService } from "@/lib/parts-data";
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
    // ?all=1 is the report's whole-ledger mode: every active row, no window.
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const all = req.nextUrl.searchParams.get("all") === "1";
    let from: string;
    let to: string;
    let bounds: { start: Date; end: Date } | null = null;
    if (all) {
      from = "";
      to = "";
    } else if (fromParam !== null || toParam !== null) {
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
      bounds = dhakaRangeBounds(from, to);
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
      bounds = dhakaRangeBounds(from, to);
    }

    const rows = await prisma.service.findMany({
      where: {
        archived: false,
        ...(bounds ? { serviceDate: { gte: bounds.start, lte: bounds.end } } : {}),
      },
      select: {
        id: true,
        totalBill: true,
        advance: true,
        entryKind: true,
        expenseAmount: true,
        expenseWrittenOff: true,
        due: true,
        status: true,
        damageLoss: true,
        refundAmount: true,
        inspectionFee: true,
      },
    });
    const activeRows = rows.filter((r) => r.status !== "Returned");
    const returnedRows = rows.filter((r) => r.status === "Returned");
    // A fee kept on a returned diagnostic job is labor revenue, not a refund:
    // count it in the window's bill so profit reflects it with no expense.
    const bill =
      activeRows.reduce((s, r) => s + r.totalBill, 0) +
      returnedRows.reduce((s, r) => s + r.inspectionFee, 0);
    const advance = activeRows.reduce((s, r) => s + r.advance, 0);
    // Written-off return costs stay on the row for audit but never hit reports.
    // A device with itemized parts reports their sum instead of the lump code.
    const partsCosts = await partsCostByService(rows.map((r) => r.id));
    const expense = rows.reduce(
      (s, r) => s + effectiveRepairCost(r, partsCostOf(partsCosts, r.id)),
      0
    );
    const due = activeRows.reduce((s, r) => s + r.due, 0);
    const damageLoss = rows.reduce((s, r) => s + r.damageLoss, 0);
    const refund = returnedRows.reduce((s, r) => s + r.refundAmount, 0);

    // Product sales are part of the bill, so their purchase cost is part of
    // the shop's cost. Returned lines are already out of the bill and are
    // skipped here too.
    const activeIds = activeRows.map((r) => r.id);
    const saleLines =
      activeIds.length > 0
        ? await prisma.saleItem.findMany({
            where: { serviceId: { in: activeIds }, returnedAt: null },
            select: { unitCost: true, quantity: true },
          })
        : [];
    const productCost = saleLines.reduce(
      (sum, line) => sum + Math.max(0, line.unitCost) * Math.max(0, line.quantity),
      0
    );

    const payload: MonthlyResponse = {
      from,
      to,
      summary: {
        count: activeRows.filter((r) => r.entryKind !== "PRODUCT").length,
        bill,
        advance,
        expense,
        due,
        profit: bill - expense - damageLoss - productCost,
        productCost,
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
