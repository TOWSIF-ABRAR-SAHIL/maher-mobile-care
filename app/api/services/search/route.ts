import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeBdPhone } from "@/lib/contact";

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
    const digits = query.replace(/\D/g, "");
    const normalizedPhone = normalizeBdPhone(query);
    const phoneCandidates = new Set(digits ? [digits, normalizedPhone] : [query]);
    if (normalizedPhone.startsWith("880") && normalizedPhone.length > 3) {
      phoneCandidates.add(`0${normalizedPhone.slice(3)}`);
    }
    if (normalizedPhone.startsWith("0") && normalizedPhone.length > 1) {
      phoneCandidates.add(`880${normalizedPhone.slice(1)}`);
    }
    const services = await prisma.service.findMany({
      where: {
        archived: false,
        OR: [
          ...(Number.isInteger(id)
            ? [{ id: { equals: id } }]
            : []),
          { customerName: { contains: query } },
          ...[...phoneCandidates]
            .filter(Boolean)
            .map((candidate) => ({ phone: { contains: candidate } })),
          { model: { contains: query } },
          { problem: { contains: query } },
          { customerAddress: { contains: query } },
          { warranty: { contains: query } },
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
