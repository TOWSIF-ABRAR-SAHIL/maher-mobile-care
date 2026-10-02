import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  dhakaDateKey,
  dhakaRangeBounds,
  isDateKey,
  serviceDateFromKey,
} from "@/lib/dhaka";
import {
  STATUSES,
  TECHNICIANS,
  computeDue,
  parseBnNumber,
} from "@/lib/utils";

// Next 14 caches GET route handlers by default — stats must stay fresh.
export const dynamic = "force-dynamic";

function toInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a number ≥ 0`);
  }
  return Math.floor(n);
}

export async function GET(req: NextRequest) {
  try {
    // ?archived=true → every archived record (all dates, for restore view).
    if (req.nextUrl.searchParams.get("archived") === "true") {
      const services = await prisma.service.findMany({
        where: { archived: true },
        orderBy: { id: "desc" },
      });
      return NextResponse.json({ archived: true, services });
    }
    const dateParam = req.nextUrl.searchParams.get("date");
    if (dateParam !== null && !isDateKey(dateParam)) {
      return NextResponse.json(
        { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    const date = dateParam || dhakaDateKey(new Date());
    const { start, end } = dhakaRangeBounds(date, date);
    const services = await prisma.service.findMany({
      where: { archived: false, serviceDate: { gte: start, lte: end } },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({ date, services });
  } catch (err) {
    console.error("GET /api/services failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const customerName = String(body?.customerName ?? "").trim();
    const phone = String(body?.phone ?? "").trim();
    const model = String(body?.model ?? "").trim();
    const technician = String(body?.technician ?? "").trim();
    const problem = String(body?.problem ?? "").trim();
    if (!customerName) throw new Error("কাস্টমারের নাম আবশ্যক");
    if (!phone) throw new Error("মোবাইল নম্বর আবশ্যক");
    if (!model) throw new Error("মোবাইলের মডেল আবশ্যক");
    if (!(TECHNICIANS as readonly string[]).includes(technician)) {
      throw new Error("সঠিক টেকনিশিয়ান বাছুন");
    }
    if (!problem) throw new Error("সমস্যা লিখুন");

    const status =
      body?.status == null || body.status === "" ? "Pending" : String(body.status);
    if (!(STATUSES as readonly string[]).includes(status)) {
      throw new Error("সঠিক অবস্থা বাছুন");
    }

    const totalBill = toInt(body?.totalBill ?? 0, "মোট বিল");
    const advance = toInt(body?.advance ?? 0, "জমা");
    const due = computeDue(totalBill, advance);

    const shopExpenseRaw = String(body?.shopExpense ?? "").trim();
    const shopExpense = shopExpenseRaw ? shopExpenseRaw : null;
    const expenseAmount = parseBnNumber(shopExpenseRaw) ?? 0;

    const serviceDate = serviceDateFromKey(
      body?.serviceDate ? String(body.serviceDate) : dhakaDateKey(new Date())
    );

    const created = await prisma.service.create({
      data: {
        customerName,
        phone,
        model,
        technician,
        problem,
        totalBill,
        advance,
        due,
        status,
        shopExpense,
        expenseAmount,
        serviceDate,
      },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/services failed:", err);
    if (
      err instanceof Error &&
      /আবশ্যক|বাছুন|লিখুন|must be|Invalid date/.test(err.message)
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to create service" },
      { status: 500 }
    );
  }
}
