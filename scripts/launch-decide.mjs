/**
 * Decides what the launcher should do about whatever is already answering on
 * the port. Kept separate from launch.mjs so the rules can be unit tested: this
 * logic caused a real support problem, where a stale server from a previously
 * deleted folder was reused instead of replaced, so the shop opened with an
 * empty database and no way out.
 *
 * The bug in one sentence: "a MAHER server is already running" was treated as
 * "the right MAHER server is already running".
 */

/** Windows paths are case-insensitive and separators get normalised both ways. */
export function samePath(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const norm = (p) => p.trim().replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/**
 * @param health    Parsed /api/health payload of whatever is on the port.
 * @param stranger  True if something answered that is not MAHER at all.
 * @param expectedDbPath  Absolute shop.db this launcher is meant to serve.
 * @param tablesOk  Whether the shop tables actually read on that server.
 * @returns {"reuse" | "takeover" | "refuse" | "start"}
 */
export function decideAction({ health, stranger, expectedDbPath, tablesOk }) {
  // Someone else's program owns the port. Never touch it.
  if (stranger) return "refuse";

  if (!health || health.service !== "maher-mobile-care") return "start";

  // Same installation and the data is readable: nothing to do.
  if (samePath(health.dbPath, expectedDbPath) && tablesOk) return "reuse";

  // It is MAHER, but not this copy: a server left behind by an older run, an
  // extracted copy that was deleted, or a damaged database. Replacing it is the
  // only way the shop can open, and the launcher owns these servers, so this is
  // never an unrelated program.
  return "takeover";
}