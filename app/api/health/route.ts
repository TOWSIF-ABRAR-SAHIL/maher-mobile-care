import { basename } from "node:path";
import { NextResponse } from "next/server";
import { resolveDatabaseFile } from "@/lib/db-path";

export const dynamic = "force-dynamic";

/**
 * Local readiness probe. The automated test harness uses the database filename
 * to prove it is talking to the throwaway test database, not live shop data.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "maher-mobile-care",
    dbFile: basename(resolveDatabaseFile()),
  });
}
