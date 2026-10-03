import { basename } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveDatabaseFile } from "@/lib/db-path";

export const dynamic = "force-dynamic";

/**
 * Local readiness probe. The automated test harness uses the database filename
 * to prove it is talking to the throwaway test database, not live shop data.
 *
 * `dbPath` and `tables` are what make this usable as a real diagnostic. The
 * launcher has to tell "the right server is already running" apart from "some
 * other copy of MAHER is answering on this port", and only an absolute path
 * can answer that. Reporting just the basename hides exactly the detail that
 * matters when several extracted copies exist, which is how a stale server from
 * a deleted folder ends up serving a shop that no longer has any data.
 *
 * This stays on localhost with no authentication, so the path reveals nothing
 * a local user could not already read from the file system.
 */
export async function GET() {
  const dbPath = resolveDatabaseFile();

  // A readiness probe must never fail because the database is unhappy: the
  // server is still listening and support needs to see that, so failures are
  // reported in the body rather than turned into an HTTP error.
  let tables: Record<string, boolean> | "unknown" = "unknown";
  let tableError: string | undefined;
  try {
    const found = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `;
    const names = new Set(found.map((row) => row.name));
    tables = { Service: names.has("Service"), Technician: names.has("Technician") };
  } catch (err) {
    tableError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: true,
    service: "maher-mobile-care",
    dbFile: basename(dbPath),
    dbPath,
    tables,
    ...(tableError ? { tableError } : {}),
    node: process.version,
    platform: process.platform,
    startedAt: new Date().toISOString(),
  });
}
