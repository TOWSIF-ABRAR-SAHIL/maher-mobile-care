import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_TEXT = 120;
const MAX_SUGGESTIONS = 20;

/**
 * GET /api/services/solutions?model=&problem=
 *
 * One-tap suggestions for the "কী করা হলো (সমাধান)" field: past solutions for
 * the same model + problem. Both keys are required — a model-only or
 * problem-only match would mix unrelated jobs. Internal only.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const model = (sp.get("model") ?? "").trim().slice(0, MAX_TEXT);
    const problem = (sp.get("problem") ?? "").trim().slice(0, MAX_TEXT);
    if (!model || !problem) {
      return NextResponse.json({ solutions: [] });
    }

    const rows = await prisma.service.findMany({
      where: {
        archived: false,
        entryKind: "DEVICE",
        model,
        problem,
        solution: { not: null },
      },
      select: { solution: true },
      orderBy: { id: "desc" },
      take: 50,
    });

    const seen = new Set<string>();
    const solutions: string[] = [];
    for (const row of rows) {
      const text = (row.solution ?? "").trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      solutions.push(text);
      if (solutions.length >= MAX_SUGGESTIONS) break;
    }

    return NextResponse.json({ solutions });
  } catch (err) {
    console.error("GET /api/services/solutions failed:", err);
    return NextResponse.json({ solutions: [] });
  }
}
