import { NextResponse } from "next/server";
import {
  LICENSE_ERROR_MESSAGES,
  verifyLicenseToken,
} from "@/lib/licensing/crypto";
import { activateLicense } from "@/lib/licensing/license-store";
import { getLicenseStatus } from "@/lib/licensing/license-status";
import { getMachineId } from "@/lib/licensing/machine-id";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const current = getLicenseStatus();
  if (current.status === "CLOCK_TAMPERED") {
    return NextResponse.json(
      { ok: false, error: current.message },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (!key) {
    return NextResponse.json(
      { ok: false, error: LICENSE_ERROR_MESSAGES.FORMAT },
      { status: 400 }
    );
  }

  const verified = verifyLicenseToken(key, { machineId: getMachineId() });
  if (!verified.ok || !verified.payload) {
    const reason = verified.reason ?? "FORMAT";
    return NextResponse.json(
      { ok: false, error: LICENSE_ERROR_MESSAGES[reason] },
      { status: 400 }
    );
  }

  activateLicense(key, verified.payload);
  return NextResponse.json({ ok: true, status: getLicenseStatus() });
}
