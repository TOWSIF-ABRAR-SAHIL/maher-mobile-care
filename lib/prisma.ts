import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";
import { resolveDatabaseFile } from "./db-path";

/** Minimal shape of the raw better-sqlite3 client held by the adapter. */
interface PragmaClient {
  pragma(source: string, options?: { simple?: boolean }): unknown;
}

interface ConnectionState {
  path: string;
  client: PrismaClient;
}

export interface SqliteResilienceStatus {
  journalMode: string;
  synchronous: number | null;
  busyTimeout: number | null;
  quickCheck: "pending" | "ok" | "error";
  quickCheckError?: string;
}

const globalForPrisma = globalThis as unknown as {
  maherConnection?: ConnectionState;
  maherPrismaProxy?: PrismaClient;
  maherSqliteResilience?: SqliteResilienceStatus;
};

// Hot reloads in dev reuse the same diagnostics so /api/health always reports
// the state of the live connection, not a fresh "pending" snapshot.
const sqliteResilience: SqliteResilienceStatus =
  globalForPrisma.maherSqliteResilience ?? {
    journalMode: "pending",
    synchronous: null,
    busyTimeout: null,
    quickCheck: "pending",
  };
globalForPrisma.maherSqliteResilience = sqliteResilience;

function resetResilience() {
  sqliteResilience.journalMode = "pending";
  sqliteResilience.synchronous = null;
  sqliteResilience.busyTimeout = null;
  sqliteResilience.quickCheck = "pending";
  delete sqliteResilience.quickCheckError;
}

/** Read-only copy for the local readiness probe. */
export function sqliteResilienceStatus(): SqliteResilienceStatus {
  return { ...sqliteResilience };
}

function scalarPragma(
  client: PragmaClient,
  name: string,
  options?: { simple?: boolean }
): unknown {
  const value = client.pragma(name, options);
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Applied to the adapter's own connection — not a second, separate handle —
 * before Prisma issues its first query. WAL plus a 5s busy timeout is what lets
 * SQLite replay a half-written WAL after a forced Windows shutdown instead of
 * failing the first query with "database is locked".
 */
function hardenConnection(client: PragmaClient) {
  client.pragma("journal_mode = WAL", { simple: true });
  client.pragma("synchronous = NORMAL", { simple: true });
  client.pragma("busy_timeout = 5000", { simple: true });

  sqliteResilience.journalMode = String(
    scalarPragma(client, "journal_mode", { simple: true }) ?? "unknown"
  ).toLowerCase();
  sqliteResilience.synchronous = Number(
    scalarPragma(client, "synchronous", { simple: true })
  );
  sqliteResilience.busyTimeout = Number(
    scalarPragma(client, "busy_timeout", { simple: true })
  );
}

/**
 * quick_check is cheap but still reads every page, so it runs on the next event
 * loop turn rather than in the middle of connection setup/first query. Reading
 * the WAL during this check is enough for SQLite to checkpoint a stale journal
 * left by a power cut; no journal file is ever deleted by hand.
 */
function scheduleQuickCheck(client: PragmaClient) {
  sqliteResilience.quickCheck = "pending";
  delete sqliteResilience.quickCheckError;
  setImmediate(() => {
    try {
      const result = scalarPragma(client, "quick_check", { simple: true });
      const first = Array.isArray(result) ? result[0] : result;
      const text =
        first && typeof first === "object" && "quick_check" in first
          ? String((first as { quick_check: unknown }).quick_check)
          : String(first ?? "unknown");
      sqliteResilience.quickCheck =
        text.trim().toLowerCase() === "ok" ? "ok" : "error";
      if (sqliteResilience.quickCheck === "error") {
        sqliteResilience.quickCheckError = text.slice(0, 200);
      }
    } catch (error) {
      sqliteResilience.quickCheck = "error";
      sqliteResilience.quickCheckError =
        error instanceof Error ? error.message : String(error);
    }
  });
}

function createClient(file: string): PrismaClient {
  // Database selection is shared through lib/db-path, so API routes, scripts,
  // and Prisma configuration can never diverge silently.
  const adapter = new PrismaBetterSqlite3({ url: `file:${file}` });
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const connected = await connect();
    const client = (connected as unknown as { client?: PragmaClient }).client;
    if (client && typeof client.pragma === "function") {
      hardenConnection(client);
      scheduleQuickCheck(client);
    }
    return connected;
  };
  return new PrismaClient({ adapter });
}

/**
 * Re-resolve on every access. Resolving reads one tiny local JSON file, and it
 * lets a successful location migration switch the LIVE connection over on the
 * very next API call — no restart window where new jobs still land on C:.
 */
function activeClient(): PrismaClient {
  const wanted = resolveDatabaseFile();
  let state = globalForPrisma.maherConnection;
  if (!state) {
    state = { path: wanted, client: createClient(wanted) };
    globalForPrisma.maherConnection = state;
  }
  if (state.path !== wanted) {
    try {
      void state.client.$disconnect();
    } catch {
      /* old handle may already be closed */
    }
    resetResilience();
    state = { path: wanted, client: createClient(wanted) };
    globalForPrisma.maherConnection = state;
  }
  return state.client;
}

/**
 * Stable proxy: every importer keeps the same binding even though the real
 * client underneath is replaced after a database move. Methods are bound to the
 * current client so Prisma's internal `this` never points at the proxy.
 */
export const prisma: PrismaClient =
  globalForPrisma.maherPrismaProxy ??
  (globalForPrisma.maherPrismaProxy = new Proxy(
    {},
    {
      get(_target, prop) {
        const client = activeClient();
        const value = Reflect.get(client, prop, client);
        return typeof value === "function" ? value.bind(client) : value;
      },
      has(_target, prop) {
        return Reflect.has(activeClient(), prop);
      },
    }
  ) as PrismaClient);
