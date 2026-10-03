/* Launcher decision rules.
 *
 * These exist because of a real failure on a client PC: a stale server from an
 * earlier, since-deleted folder was still holding port 3000, and the launcher
 * treated "a MAHER server is answering" as "the right MAHER server is running".
 * It opened the window onto a shop with no data and no way to recover without
 * Task Manager. The rules below are what stop that from happening again, so the
 * cases are pinned down rather than left to the launcher's control flow.
 *
 * Pure logic only: no server, no database, no network.
 */
const assert = require("node:assert");
const { decideAction, samePath } = require("./launch-decide.mjs");

const results = [];
const check = (id, name, fn) => {
  try {
    fn();
    results.push(`PASS [${id}] ${name}`);
  } catch (error) {
    results.push(`FAIL [${id}] ${name} — ${error?.message ?? error}`);
    process.exitCode = 1;
  }
};

const EXPECTED = "C:\\MAHER\\data\\shop.db";
const maher = (dbPath) => ({
  ok: true,
  service: "maher-mobile-care",
  dbFile: dbPath ? dbPath.split(/[\\/]/).pop() : "shop.db",
  dbPath,
});

const decide = (over) =>
  decideAction({ health: null, stranger: false, expectedDbPath: EXPECTED, tablesOk: true, ...over });

// --- the samePath comparison -----------------------------------------------

check("LD-01", "identical Windows paths match", () => {
  assert.strictEqual(samePath(EXPECTED, EXPECTED), true);
});

check("LD-02", "paths from a deleted folder do not match", () => {
  assert.strictEqual(samePath("D:\\New folder (4)\\OLD\\data\\shop.db", EXPECTED), false);
});

check("LD-03", "case and separator differences still match", () => {
  assert.strictEqual(samePath("c:/maher/data/shop.db", "C:\\MAHER\\data\\shop.db"), true);
});

check("LD-04", "a trailing separator does not change the path", () => {
  assert.strictEqual(samePath("C:\\MAHER\\data\\shop.db\\", "C:\\MAHER\\data\\shop.db"), true);
});

check("LD-05", "missing or non-string paths never match", () => {
  assert.strictEqual(samePath(undefined, EXPECTED), false);
  assert.strictEqual(samePath(EXPECTED, null), false);
  assert.strictEqual(samePath("", EXPECTED), false);
});

// --- what to do about what is on the port ----------------------------------

check("LD-10", "nothing on the port means start", () => {
  assert.strictEqual(decide({}), "start");
});

check("LD-11", "the right server with readable tables is reused", () => {
  assert.strictEqual(decide({ health: maher(EXPECTED), tablesOk: true }), "reuse");
});

check("LD-12", "an unrelated program is refused, never touched", () => {
  const action = decide({ health: { service: "something-else" }, stranger: true });
  assert.strictEqual(action, "refuse");
});

check("LD-13", "no health payload but the port answers is still refused", () => {
  assert.strictEqual(decide({ health: null, stranger: true }), "refuse");
});

// --- the regression that shipped -------------------------------------------

check("LD-20", "a server from another folder is replaced, not reused", () => {
  const action = decide({ health: maher("D:\\New folder (4)\\OLD\\MAHER\\data\\shop.db"), tablesOk: false });
  assert.strictEqual(action, "takeover");
});

check("LD-21", "a server on this folder whose tables fail is replaced", () => {
  // Same database, but the shop cannot be read. Reusing it would open an empty
  // window with no explanation, which is the original complaint.
  assert.strictEqual(decide({ health: maher(EXPECTED), tablesOk: false }), "takeover");
});

check("LD-22", "a health payload without dbPath is replaced, not trusted", () => {
  // An older build does not report a path, so identity cannot be established.
  const legacy = { ok: true, service: "maher-mobile-care", dbFile: "shop.db" };
  assert.strictEqual(decide({ health: legacy, tablesOk: true }), "takeover");
});

check("LD-23", "an empty technician list counts as not ready", () => {
  // tablesWork() reports false for an empty roster, so an unreadable shop and a
  // genuinely empty one take the same path here; both are safer to restart.
  assert.strictEqual(decide({ health: maher(EXPECTED), tablesOk: false }), "takeover");
});

check("LD-24", "a stranger on the port wins over everything else", () => {
  const action = decide({
    health: { service: "other-app" },
    stranger: true,
    expectedDbPath: EXPECTED,
    tablesOk: false,
  });
  assert.strictEqual(action, "refuse");
});

for (const line of results) console.log(line);