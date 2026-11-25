import { NextRequest, NextResponse } from "next/server";
import {
  bulkSetServicePartPaid,
  PartConflictError,
} from "@/lib/parts-data";

export const dynamic = "force-dynamic";

/**
 * POST /api/service-parts/bulk — mark many lines Paid/Unpaid in one commit.
 *
 * Body: `{ ids?: number[], supplierKey?: string, from?, to?, paid, note? }`.
 * Ids are capped at 100; a supplier-wide change above 500 rows is refused as a
 * whole so the ledger can never be half-updated.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "ভুল ডেটা" }, { status: 400 });
    }
    if (typeof body.paid !== "boolean") {
      return NextResponse.json(
        { error: "Paid অবস্থা সঠিকভাবে দিন" },
        { status: 400 }
      );
    }
    const ids = Array.isArray(body.ids)
      ? body.ids
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isInteger(value) && value > 0)
      : [];
    const result = await bulkSetServicePartPaid({
      ids,
      supplierKey:
        body.supplierKey == null ? null : String(body.supplierKey),
      from: body.from == null ? null : String(body.from),
      to: body.to == null ? null : String(body.to),
      paid: body.paid,
      note: body.note == null ? null : String(body.note),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof PartConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Error) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("POST /api/service-parts/bulk failed:", err);
    return NextResponse.json(
      { error: "পার্টস খাতা বদলানো যায়নি" },
      { status: 500 }
    );
  }
}
