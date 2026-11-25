import { NextResponse } from "next/server";
import {
  LICENSE_ERROR_MESSAGES,
  verifyLicenseToken,
} from "@/lib/licensing/crypto";
import { getMachineId } from "@/lib/licensing/machine-id";
import { LICENSE_TYPE_LABEL } from "@/lib/licensing/types";

export const dynamic = "force-dynamic";

/**
 * Read-only pre-validation for the renewal dialog. The signature is checked
 * with the embedded public key on this machine; nothing is stored until the
 * customer presses "সক্রিয় করুন", so a preview can never unlock the app.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const verified = verifyLicenseToken(key, { machineId: getMachineId() });
  if (!verified.ok || !verified.payload) {
    const reason = verified.reason ?? "FORMAT";
    return NextResponse.json(
      {
        ok: false,
        // The dialog turns MACHINE into an amber "other PC" chip and every
        // other rejection into the red invalid-key chip.
        reason,
        error: LICENSE_ERROR_MESSAGES[reason],
      },
      { status: 400 }
    );
  }
  const { shopName, type, expiresAt } = verified.payload;
  return NextResponse.json({
    ok: true,
    shopName,
    type,
    label: LICENSE_TYPE_LABEL[type],
    expiresAt,
  });
}
