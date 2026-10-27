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
import { activeTechnicianNames } from "@/lib/technicians";

// Next 14 caches GET route handlers by default — stats must stay fresh.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // ?groupId=… → every device row from one customer visit, for the
    // combined receipt/payment slip. Archived rows are never printed.
    const groupId = req.nextUrl.searchParams.get("groupId");
    if (groupId !== null) {
      if (!groupId.trim() || groupId.length > 80) {
        return NextResponse.json({ error: "ভুল গ্রুপ আইডি" }, { status: 400 });
      }
      const services = await prisma.service.findMany({
        where: { groupId: groupId.trim(), archived: false },
        orderBy: { id: "asc" },
      });
      return NextResponse.json({ groupId: groupId.trim(), services });
    }
    // ?archived=true → every archived record (all dates, for restore view).
    if (req.nextUrl.searchParams.get("archived") === "true") {
      const services = await prisma.service.findMany({
        where: { archived: true },
        orderBy: { id: "desc" },
      });
      return NextResponse.json({ archived: true, services });
    }
    // v1.3 multi-date scopes: ?from&to (range) or ?all=1. Capped rendering
    // plus a SQL count() aggregate keeps a huge window cheap; day mode below
    // stays byte-identical for every existing caller.
    const sp = req.nextUrl.searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    const all = sp.get("all") === "1";
    if (all || from !== null || to !== null) {
      if (!all) {
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
      }
      // Page size 300 (client default), never above 1000.
      const limit = Math.min(Math.max(Number(sp.get("limit")) || 300, 1), 1000);
      const offset = Math.max(Number(sp.get("offset")) || 0, 0);
      const bounds = all ? null : dhakaRangeBounds(from!, to!);
      const where = {
        archived: false,
        ...(bounds ? { serviceDate: { gte: bounds.start, lte: bounds.end } } : {}),
      };
      const [total, services] = await Promise.all([
        prisma.service.count({ where }),
        prisma.service.findMany({
          where,
          // Newest day first so a multi-date view opens on recent work.
          orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
          skip: offset,
          take: limit,
        }),
      ]);
      return NextResponse.json({
        mode: all ? "all" : "range",
        ...(all ? {} : { from, to }),
        total,
        offset,
        shown: services.length,
        hasMore: offset + services.length < total,
        services,
      });
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
    // v1.1: the accepted technician names come from the database, so a
    // left-the-shop technician can no longer be booked.
    const allowedTechnicians = await activeTechnicianNames();
    if (allowedTechnicians.length === 0) {
      return NextResponse.json(
        { error: "প্রথমে একজন টেকনিশিয়ান যোগ করুন।" },
        { status: 400 }
      );
    }
    const validated = validateServiceCreate(body, { allowedTechnicians });
    const { serviceDateKey: _serviceDateKey, ...serviceData } = validated;
    void _serviceDateKey;
    const created = await prisma.service.create({
      data: {
        ...serviceData,
        // Handover time is server-owned; a product sale is delivered at save.
        deliveredAt:
          serviceData.status === "Delivered" ? new Date() : null,
      },
    });
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
