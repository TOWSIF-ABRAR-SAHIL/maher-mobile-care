import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/services/search?q= → active records from all dates.
 * Short queries return an empty list so one digit does not dump the database.
 */
export async function GET(req: NextRequest) {
  try {
    const query = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (query.length < 2) {
      return NextResponse.json({ query, count: 0, services: [] });
    }

    const id = Number(query);
    const services = await prisma.service.findMany({
      where: {
        archived: false,
        OR: [
          ...(Number.isInteger(id)
            ? [{ id: { equals: id } }]
            : []),
          { customerName: { contains: query } },
          { phone: { contains: query } },
          { model: { contains: query } },
          { problem: { contains: query } },
        ],
      },
      orderBy: [{ serviceDate: "desc" }, { id: "desc" }],
      take: 50,
    });
    return NextResponse.json({ query, count: services.length, services });
  } catch (err) {
    console.error("GET /api/services/search failed:", err);
    return NextResponse.json({ error: "খোঁজা যায়নি" }, { status: 500 });
  }
}
