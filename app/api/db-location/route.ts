import { NextResponse } from "next/server";
import { basename } from "node:path";
import { dbLocationStatus, resolveDatabaseFile } from "@/lib/db-path";
import { sqliteResilienceStatus } from "@/lib/prisma";

// The dashboard must never cache a stale path after a migration or a fallback.
export const dynamic = "force-dynamic";

/** Read-only diagnostic: where the live connection points and why. */
export async function GET() {
  // Re-resolve so a disconnected drive or an edited pointer is visible on the
  // very next request, not after some unrelated Prisma call refreshes the cache.
  resolveDatabaseFile();
  const location = dbLocationStatus();
  return NextResponse.json({
    location: {
      ...location,
      dbFile: basename(location.activePath),
    },
    sqlite: sqliteResilienceStatus(),
  });
}
