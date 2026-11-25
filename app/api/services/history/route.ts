import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dhakaRangeBounds, isDateKey } from "@/lib/dhaka";
import { phoneDigits } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

/**
 * GET /api/services/history?q=&from=&to=&limit=&offset=
 *
 * The "সমাধান খাতা" search: model + problem + the internal solution note,
 * across all dates. Archived rows and product-sale anchors are excluded
 * (they carry no repair work). The result list is capped and reports the
 * full count so the dialog can show "আরও আছে".
 *
 * This endpoint is intentionally NOT used by the header search, which must
 * never look at the internal solution text.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const phoneQuery = phoneDigits(sp.get("phone") ?? "");
    const localPhoneQuery =
      phoneQuery.startsWith("880") && phoneQuery.length > 3
        ? `0${phoneQuery.slice(3)}`
        : phoneQuery;
    const query = (sp.get("q") ?? "").trim().slice(0, 80);
    const empty = {
      query,
      from: null as string | null,
      to: null as string | null,
      total: 0,
      shown: 0,
      hasMore: false,
      services: [],
    };
    if (phoneQuery.length > 0) {
      const from = (sp.get("from") ?? "").trim();
      const to = (sp.get("to") ?? "").trim();
      if ((from && !to) || (!from && to) || (from && (!isDateKey(from) || !isDateKey(to)))) {
        return NextResponse.json(
          { error: "সঠিক শুরু ও শেষ তারিখ দিন (YYYY-MM-DD)" },
          { status: 400 }
        );
      }
      if (from && from > to) {
        return NextResponse.json(
          { error: "শুরুর তারিখ শেষের তারিখের আগে" },
          { status: 400 }
        );
      }
      const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
      const offset = Math.max(Number(sp.get("offset")) || 0, 0);
      const phoneCandidates = new Set([phoneQuery, localPhoneQuery]);
      if (phoneQuery.startsWith("880") && phoneQuery.length > 3) {
        phoneCandidates.add(`0${phoneQuery.slice(3)}`);
      }
      if (phoneQuery.startsWith("0") && phoneQuery.length > 1) {
        phoneCandidates.add(`880${phoneQuery.slice(1)}`);
      }
      const bounds = from ? dhakaRangeBounds(from, to) : null;
      const candidates = await prisma.service.findMany({
        where: {
          archived: false,
          entryKind: "DEVICE",
          OR: [...phoneCandidates].map((candidate) => ({
            phone: { contains: candidate },
          })),
          ...(bounds ? { serviceDate: { gte: bounds.start, lte: bounds.end } } : {}),
        },
        orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
      });
      const services = candidates.filter(
        (service) => phoneDigits(service.phone) === localPhoneQuery
      );
      return NextResponse.json({
        query: localPhoneQuery,
        phone: localPhoneQuery,
        from: from || null,
        to: to || null,
        total: services.length,
        offset,
        shown: services.slice(offset, offset + limit).length,
        hasMore: offset + limit < services.length,
        services: services.slice(offset, offset + limit),
      });
    }
    if (query.length < 2) {
      return NextResponse.json(empty);
    }

    const from = (sp.get("from") ?? "").trim();
    const to = (sp.get("to") ?? "").trim();
    // Both bounds travel together; a half-open range is a client bug.
    if ((from && !to) || (!from && to)) {
      return NextResponse.json(
        { error: "শুরু ও শেষ তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (from && (!isDateKey(from) || !isDateKey(to))) {
      return NextResponse.json(
        { error: "সঠিক তারিখ দিন (YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (from && from > to) {
      return NextResponse.json(
        { error: "শুরুর তারিখ শেষের তারিখের আগে" },
        { status: 400 }
      );
    }

    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);
    const bounds = from ? dhakaRangeBounds(from, to) : null;

    const where = {
      archived: false,
      entryKind: "DEVICE",
      OR: [
        { model: { contains: query } },
        { problem: { contains: query } },
        { solution: { contains: query } },
      ],
      ...(bounds
        ? { serviceDate: { gte: bounds.start, lte: bounds.end } }
        : {}),
    };

    const [total, services] = await Promise.all([
      prisma.service.count({ where }),
      prisma.service.findMany({
        where,
        orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      query,
      from: from || null,
      to: to || null,
      total,
      offset,
      shown: services.length,
      hasMore: offset + services.length < total,
      services,
    });
  } catch (err) {
    console.error("GET /api/services/history failed:", err);
    return NextResponse.json(
      { error: "সমাধান খাতা খোঁজা যায়নি" },
      { status: 500 }
    );
  }
}
