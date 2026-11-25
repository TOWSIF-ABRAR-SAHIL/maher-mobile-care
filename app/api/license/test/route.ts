import { NextResponse } from "next/server";
import { getLicenseStatus } from "@/lib/licensing/license-status";
import { patchLicenseStateForTest } from "@/lib/licensing/license-store";

export const dynamic = "force-dynamic";

/** Never reachable in a shop build: only the isolated licensing suite sets this. */
function enabled(): boolean {
  return process.env.MAHER_LICENSE_TEST_MODE === "1";
}

export async function GET() {
  if (!enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: getLicenseStatus() });
}

export async function POST(request: Request) {
  if (!enabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const patch = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const state = patchLicenseStateForTest({
    reset: patch.reset === true,
    clearLicense: patch.clearLicense === true,
    trialEndsAt:
      typeof patch.trialEndsAt === "string" || typeof patch.trialEndsAt === "number"
        ? (patch.trialEndsAt as string | number)
        : patch.trialEndsAt === null
          ? null
          : undefined,
    lastSeenTimestamp:
      typeof patch.lastSeenTimestamp === "number" && Number.isFinite(patch.lastSeenTimestamp)
        ? patch.lastSeenTimestamp
        : undefined,
  });
  return NextResponse.json({
    ok: true,
    state: {
      lastSeenTimestamp: state.lastSeenTimestamp,
      trialEndsAt: state.trialEndsAt,
      hasLicense: !!state.license,
    },
    status: getLicenseStatus(),
  });
}
