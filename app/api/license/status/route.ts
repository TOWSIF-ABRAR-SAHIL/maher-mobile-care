import { NextResponse } from "next/server";
import { getLicenseStatus } from "@/lib/licensing/license-status";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getLicenseStatus());
}
