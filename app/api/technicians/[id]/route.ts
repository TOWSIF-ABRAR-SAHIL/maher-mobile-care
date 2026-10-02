import { NextRequest, NextResponse } from "next/server";
import {
  TechnicianError,
  deactivateTechnician,
  reactivateTechnician,
  renameTechnician,
} from "@/lib/technicians";

export const dynamic = "force-dynamic";

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new TechnicianError("Invalid id");
  }
  return id;
}

/**
 * PUT /api/technicians/[id] → rename.
 *
 * Two-step: when the rename would rewrite historical Service rows and the body
 * does not carry `confirmCascade: true`, nothing is written and the response is
 * 409 with the affected count so the UI can ask before touching money records.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    const body = await req.json().catch(() => ({}));
    const result = await renameTechnician(
      id,
      body?.name,
      body?.confirmCascade === true
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof TechnicianError) {
      const affected = (err as TechnicianError & { affected?: number }).affected;
      return NextResponse.json(
        { error: err.message, ...(affected === undefined ? {} : { affected }) },
        { status: err.status }
      );
    }
    console.error(`PUT /api/technicians/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "নাম বদলানো যায়নি" },
      { status: 500 }
    );
  }
}

/** DELETE /api/technicians/[id] → soft-delete (isActive=false). Never hard. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    const technician = await deactivateTechnician(id);
    return NextResponse.json({ ok: true, technician });
  } catch (err) {
    if (err instanceof TechnicianError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`DELETE /api/technicians/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "টেকনিশিয়ান ডিলিট করা যায়নি" },
      { status: 500 }
    );
  }
}

/** POST /api/technicians/[id] → reactivate a previously deleted technician. */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = parseId(params.id);
    const technician = await reactivateTechnician(id);
    return NextResponse.json({ ok: true, technician });
  } catch (err) {
    if (err instanceof TechnicianError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(`POST /api/technicians/${params.id} failed:`, err);
    return NextResponse.json(
      { error: "ফিরিয়ে আনা যায়নি" },
      { status: 500 }
    );
  }
}
