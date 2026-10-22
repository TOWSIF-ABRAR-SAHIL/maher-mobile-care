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
      "old snapshot without partsShop/refund/damage columns restores safely",
      restored.ok &&
        !!highId &&
        highId.customerName === "HighIdRow" &&
        highId.partsShop === null &&
        highId.returnedAt === null &&
        highId.refundAmount === 0 &&
        highId.refundNote === null &&
        highId.damageLoss === 0 &&
        highId.damageNote === null,
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

    // ---- EC: secret-keypad expense decoding + parts shop ----------------
    // The server decoder is authoritative; the UI badge is only a preview.
    const codeShop = unique("CodeShop");
    const codeCases = [
      // [input, decoded amount, exact stored value]
      ["*J#", 1500, "*J#"],
      ["T#", 800, "T#"],
      ["GJ+", 450, "GJ+"],
      ["gj+", 450, "gj+"], // lowercase codes stay as typed
      ["1500", 1500, "*J#"], // plain numbers become canonical codes
      ["1234", 1234, "*ADG"],
      ["1000", 1000, "*+#"],
      ["*M#", 1600, "*M#"],
      ["*B#", 1200, "*B#"], // B is still a valid alias for 2
    ];
    let firstCodeId = null;
    for (const [raw, expected, stored] of codeCases) {
      const res = await api("/api/services", json({
        customerName: unique("ExpenseCode"),
        phone: "01000000333",
        model: "Code Model",
        technician: "NURUL",
        problem: "Code decoding",
        totalBill: 2000,
        advance: 0,
        status: "Pending",
        shopExpense: raw,
        partsShop: codeShop,
        serviceDate: TODAY,
      }));
      if (res.ok) {
        createdIds.push(res.body.id);
        firstCodeId ??= res.body.id;
      }
      check(
        "EC1",
        `shop input ${JSON.stringify(raw)} decodes to ${expected}, stored as ${JSON.stringify(stored)}`,
        res.ok &&
          res.body.shopExpense === stored &&
          res.body.expenseAmount === expected &&
          res.body.partsShop === codeShop,
        JSON.stringify(res.body && {
          stored: res.body.shopExpense,
          amount: res.body.expenseAmount,
          shop: res.body.partsShop,
          error: res.body.error,
        })
      );
    }

    const invalidCode = await api("/api/services", json({
      customerName: unique("BadCode"),
      phone: "01000000334",
      model: "M",
      technician: "NURUL",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "AB$",
      partsShop: "",
      serviceDate: TODAY,
    }));
    check(
      "EC2",
      "unsupported code characters are rejected",
      invalidCode.status === 400 &&
        String(invalidCode.body.error || "").includes("গোপন কোড"),
      `${invalidCode.status} ${JSON.stringify(invalidCode.body.error || "")}`
    );

    const longCode = await api("/api/services", json({
      customerName: unique("LongCode"),
      phone: "01000000335",
      model: "M",
      technician: "NURUL",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "A".repeat(25),
      partsShop: "",
      serviceDate: TODAY,
    }));
    check(
      "EC3",
      "overlong code is rejected",
      longCode.status === 400 &&
        String(longCode.body.error || "").includes("গোপন কোড"),
      `${longCode.status} ${JSON.stringify(longCode.body.error || "")}`
    );

    const longShop = await api("/api/services", json({
      customerName: unique("LongShop"),
      phone: "01000000336",
      model: "M",
      technician: "NURUL",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      partsShop: "x".repeat(101),
      serviceDate: TODAY,
    }));
    check(
      "EC4",
      "overlong parts-shop name is rejected",
      longShop.status === 400 &&
        String(longShop.body.error || "").includes("পার্টস"),
      `${longShop.status} ${JSON.stringify(longShop.body.error || "")}`
    );

    const updatedCode = await api(
      `/api/services/${firstCodeId}`,
      put({
        shopExpense: "T#",
        partsShop: "Updated Parts Shop",
      })
    );
    check(
      "EC5",
      "update re-decodes the code and replaces the parts shop",
      updatedCode.ok &&
        updatedCode.body.shopExpense === "T#" &&
        updatedCode.body.expenseAmount === 800 &&
        updatedCode.body.partsShop === "Updated Parts Shop",
      JSON.stringify(updatedCode.body && {
        raw: updatedCode.body.shopExpense,
        amount: updatedCode.body.expenseAmount,
        shop: updatedCode.body.partsShop,
      })
    );

    const numericUpdate = await api(
      `/api/services/${firstCodeId}`,
      put({ shopExpense: "1234" })
    );
    check(
      "EC5b",
      "update also converts a plain number to a canonical code",
      numericUpdate.ok &&
        numericUpdate.body.shopExpense === "*ADG" &&
        numericUpdate.body.expenseAmount === 1234,
      JSON.stringify({
        stored: numericUpdate.body.shopExpense,
        amount: numericUpdate.body.expenseAmount,
        error: numericUpdate.body.error,
      })
    );

    const shops = await api("/api/parts-shops");
    check(
      "EC6",
      "parts-shop suggestions expose distinct used names",
      shops.ok &&
        shops.body.shops.includes(codeShop) &&
        shops.body.shops.includes("Updated Parts Shop"),
      JSON.stringify(shops.body.shops || shops.body.error || null)
    );

    const codeCsv = await fetch(`${BASE}/api/backup`).then((r) => r.text());
    const csvLines = codeCsv.split(/\r?\n/);
    const csvHeader = csvLines[0] || "";
    const codeCsvLine = csvLines.find((line) => line.includes("*M#"));
    check(
      "EC7",
      "CSV includes numeric expenseAmount and partsShop columns",
      csvHeader.includes("expenseAmount") &&
        csvHeader.includes("partsShop") &&
        !!codeCsvLine &&
        codeCsvLine.includes(",1600,") &&
        codeCsvLine.includes(codeShop),
      JSON.stringify({ header: csvHeader.slice(0, 180), row: codeCsvLine?.slice(0, 220) })
    );

    // ---- TC: v1.1 dynamic technicians -----------------------------------
    // The technician list is database-backed now, so the seeded four must be
    // present and the rules (unique, normalized, last-active, cascade) must
    // hold at the API level.
    const techList = await api("/api/technicians");
    const seededNames = ["NURUL", "RONI", "ASRAFUL", "NAYEM"];
    check(
      "TC1",
      "seeded technicians are active after migration",
      techList.ok &&
        seededNames.every((n) =>
          techList.body.technicians.some((t) => t.name === n && t.isActive)
        ),
      JSON.stringify(techList.body.technicians || techList.body.error || null)
    );

    const blankTech = await api("/api/technicians", json({ name: "   " }));
    check(
      "TC2",
      "blank technician name rejected",
      blankTech.status === 400,
      `${blankTech.status} ${JSON.stringify(blankTech.body.error || "")}`
    );

    const dupTech = await api("/api/technicians", json({ name: "nurul" }));
    check(
      "TC3",
      "duplicate name rejected case-insensitively and normalized",
      dupTech.status === 400 &&
        String(dupTech.body.error || "").includes("ইতিমধ্যে"),
      `${dupTech.status} ${JSON.stringify(dupTech.body.error || "")}`
    );

    const addedTech = await api("/api/technicians", json({ name: "  rakib  " }));
    check(
      "TC4",
      "new technician stored normalized (trim + uppercase)",
      addedTech.ok && addedTech.body.technician?.name === "RAKIB",
      JSON.stringify(addedTech.body.technician || addedTech.body.error || null)
    );
    const rakibId = addedTech.body.technician?.id;

    const badTechId = await api("/api/technicians/not-an-id", { method: "DELETE" });
    check(
      "TC5",
      "malformed technician id returns 400",
      badTechId.status === 400,
      String(badTechId.status)
    );
    const missingTech = await api("/api/technicians/2147483647", {
      method: "DELETE",
    });
    check("TC6", "unknown technician id returns 404", missingTech.status === 404, String(missingTech.status));

    // A service row keeps its technician name after deactivation, and the
    // daily stats still include that (inactive) technician as a card.
    const rakibService = await api("/api/services", json({
      customerName: unique("TechRow"),
      phone: "01000000666",
      model: "M",
      technician: "RAKIB",
      problem: "P",
      totalBill: 900,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }));
    if (rakibService.ok) createdIds.push(rakibService.body.id);
    const deactivated = await api(`/api/technicians/${rakibId}`, { method: "DELETE" });
    check("TC7", "soft-delete deactivates (not hard delete)", deactivated.ok, String(deactivated.status));
    const afterDeactivate = await api("/api/technicians?all=true");
    const rakibRow = (afterDeactivate.body.technicians || []).find(
      (t) => t.name === "RAKIB"
    );
    check(
      "TC8",
      "deactivated technician kept with isActive=false",
      !!rakibRow && rakibRow.isActive === false,
      JSON.stringify(rakibRow || null)
    );
    const dayAfter = await api(`/api/services?date=${TODAY}`);
    const oldRowStillNamed = (dayAfter.body.services || []).some(
      (s) => s.customerName.startsWith("TechRow") && s.technician === "RAKIB"
    );
    check("TC9", "old service row still shows the technician name", oldRowStillNamed);

    const statsAfter = await api(`/api/stats?date=${TODAY}`);
    const inactiveCard = (statsAfter.body.techStats || []).find(
      (t) => t.technician === "RAKIB"
    );
    check(
      "TC10",
      "inactive technician with today's work still gets a card (isActive=false)",
      !!inactiveCard && inactiveCard.isActive === false && inactiveCard.count === 1,
      JSON.stringify(inactiveCard || null)
    );
    const cardSum = (statsAfter.body.techStats || []).reduce((s, t) => s + t.count, 0);
    check(
      "TC11",
      "cards always reconcile with the day's job count",
      cardSum === statsAfter.body.today.count,
      `cards ${cardSum} vs today ${statsAfter.body.today.count}`
    );

    const inactiveCreate = await api("/api/services", json({
      customerName: unique("BadTech"),
      phone: "01000000777",
      model: "M",
      technician: "RAKIB",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }));
    check(
      "TC12",
      "service cannot be created with an inactive technician",
      inactiveCreate.status === 400,
      String(inactiveCreate.status)
    );

    // Cascade rename: the affected count is reported first, and only an
    // explicit confirmCascade performs the historical rewrite.
    const newName = `RENAMED${Date.now().toString().slice(-6)}`;
    const preview = await api(`/api/technicians/${rakibId}`, put({ name: newName }));
    check(
      "TC13",
      "rename with affected rows returns 409 + count, writes nothing",
      preview.status === 409 &&
        preview.body.affected === 1 &&
        (await api("/api/technicians?all=true")).body.technicians.some(
          (t) => t.name === "RAKIB"
        ),
      `${preview.status} ${JSON.stringify(preview.body)}`
    );
    const confirmed = await api(
      `/api/technicians/${rakibId}`,
      put({ name: newName, confirmCascade: true })
    );
    const afterRenameRows = (await api(`/api/services?date=${TODAY}`)).body.services || [];
    check(
      "TC14",
      "confirmed rename cascades to historical service rows",
      confirmed.ok &&
        confirmed.body.updatedServices === 1 &&
        afterRenameRows.some((s) => s.customerName.startsWith("TechRow") && s.technician === newName) &&
        !afterRenameRows.some((s) => s.customerName.startsWith("TechRow") && s.technician === "RAKIB"),
      `${confirmed.status} ${JSON.stringify(confirmed.body)}`
    );

    // Renaming a technician who has no rows must not ask for a confirm.
    const noRows = await api("/api/technicians", json({ name: "SOLO" }));
    const soloRename = await api(
      `/api/technicians/${noRows.body.technician.id}`,
      put({ name: `SOLO${Date.now().toString().slice(-4)}` })
    );
    check(
      "TC15",
      "rename with 0 affected rows succeeds without confirm",
      soloRename.ok && soloRename.body.updatedServices === 0,
      `${soloRename.status} ${JSON.stringify(soloRename.body)}`
    );

    // The last active technician must never be removable.
    const allNow = await api("/api/technicians");
    for (const t of allNow.body.technicians.filter((x) => x.name !== "NURUL")) {
      await api(`/api/technicians/${t.id}`, { method: "DELETE" });
    }
    const onlyLeft = await api("/api/technicians");
    const nurul = onlyLeft.body.technicians[0];
    const lastDelete = await api(`/api/technicians/${nurul.id}`, { method: "DELETE" });
    check(
      "TC16",
      "deleting the last active technician is blocked",
      lastDelete.status === 400 &&
        String(lastDelete.body.error || "").includes("কমপক্ষে"),
      `${lastDelete.status} ${JSON.stringify(lastDelete.body.error || "")}`
    );
    // Put the seeded list back so later checks see a normal shop.
    for (const n of ["RONI", "ASRAFUL", "NAYEM"]) {
      await api("/api/technicians", json({ name: n }));
    }

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
