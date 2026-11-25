import { NextRequest, NextResponse } from "next/server";
import {
  PartConflictError,
  servicePartLedger,
  type ServicePartResolutionFilter,
  type ServicePartStatusFilter,
} from "@/lib/parts-data";
import { isInventoryValidationError } from "@/lib/inventory";

export const dynamic = "force-dynamic";

const STATUSES: ServicePartStatusFilter[] = [
  "all",
  "paid",
  "unpaid",
  "legacy",
];

const RESOLUTIONS: ServicePartResolutionFilter[] = [
  "all",
  "USED",
  "MOVED_TO_STOCK",
  "RETURNED",
  "DAMAGED",
  "KEPT_IN_LEDGER",
];

function resolutionParam(value: string | null): ServicePartResolutionFilter {
  const status = String(value ?? "all").trim().toUpperCase();
  return (RESOLUTIONS as string[]).includes(status)
    ? (status as ServicePartResolutionFilter)
    : "all";
}

function statusParam(value: string | null): ServicePartStatusFilter {
  const status = String(value ?? "all").trim().toLowerCase();
  return (STATUSES as string[]).includes(status)
    ? (status as ServicePartStatusFilter)
    : "all";
}

/**
 * GET /api/service-parts — internal purchase ledger.
 *
 * `from`/`to` (YYYY-MM-DD) and `supplier` narrow the window. `status` only
 * filters the visible rows: the summary is always computed from the date +
 * supplier window, so switching tabs can never hide another status's money.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const result = await servicePartLedger({
      from: sp.get("from"),
      to: sp.get("to"),
      supplierKey: sp.get("supplier"),
      status: statusParam(sp.get("status")),
      resolution: resolutionParam(sp.get("resolution")),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PartConflictError || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("GET /api/service-parts failed:", err);
    return NextResponse.json(
      { error: "পার্টস খাতা আনা যায়নি" },
      { status: 500 }
    );
  }
}
