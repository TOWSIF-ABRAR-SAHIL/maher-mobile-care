import { NextRequest, NextResponse } from "next/server";
import {
  TechnicianError,
  createTechnician,
  listTechnicians,
} from "@/lib/technicians";

export const dynamic = "force-dynamic";

/** GET /api/technicians → active technicians (?all=true also lists inactive). */
export async function GET(req: NextRequest) {
  try {
    const includeInactive =
      req.nextUrl.searchParams.get("all") === "true";
    const technicians = await listTechnicians(includeInactive);
    return NextResponse.json({ count: technicians.length, technicians });
  } catch (err) {
    console.error("GET /api/technicians failed:", err);
    return NextResponse.json(
      { error: "টেকনিশিয়ান তালিকা আনা যায়নি" },
      { status: 500 }
    );
  }
}

/** POST /api/technicians → add a technician (name is trimmed + uppercased). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const technician = await createTechnician(body?.name);
    return NextResponse.json({ technician }, { status: 201 });
  } catch (err) {
    if (err instanceof TechnicianError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/technicians failed:", err);
    return NextResponse.json(
      { error: "টেকনিশিয়ান যোগ করা যায়নি" },
      { status: 500 }
    );
  }
}
