import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  dhakaDateKey,
  dhakaRangeBounds,
  isDateKey,
} from "@/lib/dhaka";
import {
  isServiceValidationError,
  validateServiceCreate,
} from "@/lib/service-validation";

// Next 14 caches GET route handlers by default — stats must stay fresh.
export const dynamic = "force-dynamic";

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
    const validated = validateServiceCreate(body);
    const { serviceDateKey: _serviceDateKey, ...serviceData } = validated;
    void _serviceDateKey;
    const created = await prisma.service.create({ data: serviceData });
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    console.error("POST /api/services failed:", err);
    if (isServiceValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to create service" },
      { status: 500 }
    );
  }
}
