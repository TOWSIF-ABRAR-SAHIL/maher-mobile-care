/* API regression suite for the throwaway test database.
 * Run directly only against MAHER_TEST_URL (npm test sets it).
 */
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const { requireTestEnv } = require("./test-support");

// Hard stop: this suite archives and restores rows, so it must never be
// pointed at the live shop server that happens to sit on port 3000.
requireTestEnv();

const BASE = process.env.MAHER_TEST_URL;
const EXPECTED_DB = process.env.MAHER_TEST_DB_FILE;
const BACKUP_DIR = process.env.MAHER_BACKUP_DIR;
const failures = [];

function dhakaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function unique(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function check(id, name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures.push(id);
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

function json(body) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function put(body) {
  return { ...json(body), method: "PUT" };
}

async function main() {
  const createdIds = [];
  try {
    const TODAY = dhakaToday();
    const health = await api("/api/health");
    check(
      "H1",
      "health reports the throwaway test database",
      health.ok && health.body.dbFile === EXPECTED_DB,
      JSON.stringify(health.body)
    );

    const invalidCreates = [
      ["V1", { customerName: "", phone: "01", model: "M", technician: "NURUL", problem: "P" }],
      ["V2", { customerName: "X", phone: "01", model: "M", technician: "HACKER", problem: "P" }],
      ["V3", { customerName: "X", phone: "01", model: "M", technician: "NURUL", problem: "P", totalBill: -5 }],
      ["V4", { customerName: "X", phone: "01", model: "M", technician: "NURUL", problem: "P", serviceDate: "not-a-date" }],
    ];
    for (const [id, payload] of invalidCreates) {
      const res = await api("/api/services", json(payload));
      check(id, `invalid create rejected (${JSON.stringify(payload).slice(0, 45)})`, res.status === 400, String(res.status));
    }

    const missingUpdate = await api("/api/services/2147483647", put({ status: "Completed" }));
    check("N1", "missing update returns 404", missingUpdate.status === 404, String(missingUpdate.status));
    const missingRestore = await api("/api/backup/restore", json({ file: "maher-20000101-000000-001.db" }));
    check("N2", "missing snapshot returns 404", missingRestore.status === 404, String(missingRestore.status));
    const badId = await api("/api/services/not-an-id", { method: "DELETE" });
    check("N3", "malformed id returns 400", badId.status === 400, String(badId.status));

    const markerName = unique("ApiMark");
    const overpayBody = {
      customerName: markerName,
      phone: "01000000444",
      model: "M",
      technician: "ASRAFUL",
      problem: "P",
      totalBill: 5000,
      advance: 7000,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    };
    const overpay = await api("/api/services", json(overpayBody));
    check(
      "W1",
      "overpay rejected (advance > bill)",
      overpay.status === 400 && String(overpay.body.error || "").includes("বেশি"),
      `${overpay.status} ${JSON.stringify(overpay.body.error || "")}`
    );
    const overpayRow = (await api(`/api/services?date=${TODAY}`)).body.services.find(
      (s) => s.customerName === markerName
    );
    check("W1b", "overpay stored nothing", !overpayRow, JSON.stringify(overpayRow || null));

    const marker = await api("/api/services", json({ ...overpayBody, advance: 5000 }));
    check(
      "W1c",
      "exact payment allowed (due 0)",
      marker.ok && marker.body.due === 0 && marker.body.advance === 5000,
      JSON.stringify(marker.body && marker.body.due)
    );
    if (marker.ok) createdIds.push(marker.body.id);
    const markerOverpay = await api(
      `/api/services/${marker.body.id}`,
      put({ advance: 9999 })
    );
    check(
      "W1d",
      "overpay update rejected, advance unchanged",
      markerOverpay.status === 400 &&
        (await api(`/api/services?date=${TODAY}`)).body.services.find(
          (s) => s.id === marker.body.id
        ).advance === 5000,
      String(markerOverpay.status)
    );
    const before = (await api(`/api/services?date=${TODAY}`)).body.services.find((s) => s.customerName === markerName);
    const badStatus = await api(`/api/services/${marker.body.id}`, put({ status: "Nope" }));
    const afterBad = (await api(`/api/services?date=${TODAY}`)).body.services.find((s) => s.customerName === markerName);
    check(
      "W2",
      "invalid update rejected without changing the row",
      badStatus.status === 400 &&
        afterBad &&
        afterBad.status === before.status &&
        afterBad.totalBill === before.totalBill,
      String(badStatus.status)
    );

    const dueName = unique("ApiDue");
    const dueRow = await api("/api/services", json({
      customerName: dueName,
      phone: "01700000044",
      model: "Due Model",
      technician: "RONI",
      problem: "Due problem",
      totalBill: 1200,
      advance: 200,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }));
    if (dueRow.ok) createdIds.push(dueRow.body.id);
    const dues = await api("/api/services/dues");
    check(
      "D1",
      "all-dates dues endpoint includes the test row and total",
      dues.ok &&
        dues.body.services.some((s) => s.customerName === dueName) &&
        dues.body.totalDue >= 1000,
      JSON.stringify(dues.body && { count: dues.body.count, totalDue: dues.body.totalDue })
    );
    // ---- D2: total must be an uncapped aggregate over ALL due rows ----
    // The list is capped at 500 for the browser, but the headline total has to
    // stay 100% accurate, so it must come from SQL SUM() over every due row.
    const dbFile = process.env.MAHER_DB_PATH;
    if (!dbFile) throw new Error("MAHER_DB_PATH is required for the dues-total test");
    const bulk = new Database(dbFile);
    const BULK = 505;
    const PER = 7;
    try {
      const insert = bulk.prepare(
        `INSERT INTO Service
           (customerName, phone, model, technician, problem, totalBill, advance,
            due, status, shopExpense, expenseAmount, serviceDate, archived,
            createdAt, updatedAt)
         VALUES (?, '01000000999', 'BulkModel', 'NURUL', 'bulk', ?, 0, ?,
                 'Pending', '', 0, ?, 0, ?, ?)`
      );
      const stamp = "2026-01-15T06:00:00.000Z";
      const run = bulk.transaction(() => {
        for (let i = 0; i < BULK; i += 1) {
          insert.run(`BulkDue${i}`, PER, PER, stamp, stamp, stamp);
        }
      });
      run();
    } finally {
      bulk.close();
    }
    const bulkDues = await api("/api/services/dues");
    const bulkExpected = BULK * PER + 1000; // + the earlier ApiDue row
    check(
      "D2",
      "dues total aggregates all rows beyond the 500 list cap",
      bulkDues.ok &&
        bulkDues.body.services.length === 500 &&
        bulkDues.body.hasMore === true &&
        bulkDues.body.totalDue === bulkExpected,
      JSON.stringify({
        listed: bulkDues.body.services.length,
        hasMore: bulkDues.body.hasMore,
        totalDue: bulkDues.body.totalDue,
        expected: bulkExpected,
      })
    );
    check(
      "D3",
      "dues count reflects all matching rows, not the page",
      bulkDues.body.count === BULK + 1,
      JSON.stringify({ count: bulkDues.body.count, expected: BULK + 1 })
    );

    const search = await api(`/api/services/search?q=${encodeURIComponent(dueName.slice(0, 12))}`);
    check(
      "S1",
      "all-dates search finds the test row",
      search.ok && search.body.services.some((s) => s.customerName === dueName),
      JSON.stringify(search.body && search.body.count)
    );
    const shortSearch = await api("/api/services/search?q=a");
    check("S2", "one-character search returns nothing", shortSearch.ok && shortSearch.body.count === 0);

    const formulaName = "=1+1";
    const formulaRow = await api("/api/services", json({
      customerName: formulaName,
      phone: "01000000555",
      model: "CSV Model",
      technician: "NURUL",
      problem: "CSV formula guard",
      totalBill: 10,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }));
    if (formulaRow.ok) createdIds.push(formulaRow.body.id);
    const csv = await fetch(`${BASE}/api/backup`).then((r) => r.text());
    check("C1", "CSV neutralizes formula cells", csv.includes(`"'${formulaName}"`), "guarded cell");

    if (!BACKUP_DIR) throw new Error("MAHER_BACKUP_DIR is required for the malformed-restore test");
    const malformed = "safety-20000101-000000-001.db";
    const malformedAbs = path.join(BACKUP_DIR, malformed);
    const malformedDb = new Database(malformedAbs);
    try {
      malformedDb.exec("CREATE TABLE Service (id INTEGER PRIMARY KEY, customerName TEXT)");
      malformedDb.exec("INSERT INTO Service (id, customerName) VALUES (1, 'Broken')");
    } finally {
      malformedDb.close();
    }
    const rejected = await api("/api/backup/restore", json({ file: malformed }));
    check(
      "R1",
      "snapshot missing columns is rejected before any delete",
      rejected.status === 400 && String(rejected.body.error || "").includes("archived"),
      JSON.stringify(rejected.body)
    );
    fs.unlinkSync(malformedAbs);

    // ---- R2: restore must keep the AUTOINCREMENT counter ahead of max(id) ----
    // Otherwise the next entry reuses an old id that a paper receipt may still
    // reference ("বিল নং"), silently pointing at a different customer.
    const HIGH_ID = 9001;
    const craftedName = "maher-20000101-000000-001.db";
    const craftedAbs = path.join(BACKUP_DIR, craftedName);
    const crafted = new Database(craftedAbs);
    try {
      crafted.exec(
        `CREATE TABLE Service (
           id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
           customerName TEXT NOT NULL, phone TEXT NOT NULL, model TEXT NOT NULL,
           technician TEXT NOT NULL, problem TEXT NOT NULL,
           totalBill INTEGER NOT NULL DEFAULT 0, advance INTEGER NOT NULL DEFAULT 0,
           due INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending',
           shopExpense TEXT, expenseAmount INTEGER NOT NULL DEFAULT 0,
           serviceDate DATETIME NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
           createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL)`
      );
      crafted
        .prepare(
          `INSERT INTO Service (id, customerName, phone, model, technician,
             problem, totalBill, advance, due, status, shopExpense,
             expenseAmount, serviceDate, archived, createdAt, updatedAt)
           VALUES (9001, 'HighIdRow', '01000000777', 'M', 'NURUL', 'p',
                   100, 0, 100, 'Pending', '', 0, ?, 0, ?, ?)`
        )
        .run(`${TODAY}T06:00:00.000Z`, `${TODAY}T06:00:00.000Z`, `${TODAY}T06:00:00.000Z`);
    } finally {
      crafted.close();
    }

    const restored = await api("/api/backup/restore", json({ file: craftedName }));
    const afterRestore = await api(`/api/services?date=${TODAY}`);
    const highId = afterRestore.body.services.find((s) => s.id === HIGH_ID);
    check(
      "R2",
      "crafted snapshot restores the high-id row",
      restored.ok && !!highId && highId.customerName === "HighIdRow",
      `${restored.status} ${JSON.stringify(restored.body.error || "")}`
    );

    const nextCreate = await api("/api/services", json({
      customerName: unique("AfterRestore"),
      phone: "01000000888",
      model: "M",
      technician: "NURUL",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }));
    check(
      "R3",
      "next id after restore is greater than the restored max(id)",
      nextCreate.ok && nextCreate.body.id > HIGH_ID,
      `got id ${nextCreate.body && nextCreate.body.id}, restored max(id) ${HIGH_ID}`
    );

    const badRange = await api("/api/stats/monthly?from=2026-10-01&to=2026-09-01");
    check("M1", "inverted report range returns 400", badRange.status === 400, String(badRange.status));
    const impossible = await api("/api/stats/monthly?from=2026-02-30&to=2026-02-30");
    check("M2", "impossible report date returns 400", impossible.status === 400, String(impossible.status));
    const badDaily = await api("/api/stats?date=nope");
    check("M3", "malformed daily date returns 400", badDaily.status === 400, String(badDaily.status));
    const badFallback = await api("/api/stats/monthly?date=nope");
    check(
      "M4",
      "malformed fallback report date returns 400",
      badFallback.status === 400,
      String(badFallback.status)
    );
    const impossibleFallback = await api("/api/stats/monthly?date=2026-02-31");
    check(
      "M5",
      "impossible fallback report date returns 400",
      impossibleFallback.status === 400,
      String(impossibleFallback.status)
    );
  } finally {
    for (const id of createdIds) {
      try {
        await api(`/api/services/${id}`, { method: "DELETE" });
      } catch {
        /* test-database cleanup is best effort */
      }
    }
  }

  if (failures.length > 0) {
    console.error(`API SUITE FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("API SUITE PASSED");
}

main().catch((e) => {
  console.error("API SUITE CRASH:", e.message);
  process.exit(1);
});
