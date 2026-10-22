import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/parts-shops
 *
 * Internal suggestion list only. Returns the most-used non-empty parts-shop
 * names, case-insensitively de-duplicated, for the form's datalist. A failure
 * here must never block entry: the form still accepts free text.
 */
export async function GET() {
  try {
    const rows = await prisma.$queryRaw<{ partsShop: string }[]>`
      SELECT TRIM("partsShop") AS "partsShop", COUNT(*) AS n
      FROM "Service"
      WHERE "partsShop" IS NOT NULL AND TRIM("partsShop") <> ''
      GROUP BY TRIM("partsShop") COLLATE NOCASE
      ORDER BY n DESC, "partsShop" COLLATE NOCASE ASC
      LIMIT 100
    `;
    return NextResponse.json({
      shops: rows.map((row) => row.partsShop).filter(Boolean),
    });
  } catch (err) {
    console.error("GET /api/parts-shops failed:", err);
    return NextResponse.json(
      { error: "Failed to fetch parts shops" },
      { status: 500 }
    );
  }
}
