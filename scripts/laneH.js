/* Lane H: Phase 1 — per-device সমাধান (solution) + per-visit শর্ত (condition).
 *
 * Runs only on the throwaway DB supplied by run-tests.js. Covers:
 *   1. create/edit both fields (blank clears)   · 2. 500-char boundary
 *   3. history search by model/problem/solution · 4. date-range + short query
 *   5. archived rows are excluded               · 6. suggestions endpoint
 *   7. receipt prints শর্ত but never solution
 *   8. combined slip prints শর্ত once from the group
 *   9. grouped visits copy the condition to every device row
 *  10. an old snapshot without the new columns still restores (NULL)
 *  11. the header search still ignores the internal solution text
 */
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  uniqueName,
  waitDailyRow,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const BACKUP_DIR = process.env.MAHER_BACKUP_DIR;

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function basePayload(name, model) {
  return {
    customerName: name,
    phone: "01700000970",
    technician: "NURUL",
    model,
    problem: "Phase1 test",
    totalBill: "500",
    advance: "0",
    status: "In-Progress",
    shopCost: "",
    serviceDate: TODAY,
  };
}

const createJob = (page, payload) =>
  api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

const updateJob = (page, id, patch) =>
  api(page, `/api/services/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

async function history(page, query) {
  return api(page, `/api/services/history?${query}`);
}

async function addRoster(page) {
  const roster = (await api(page, "/api/technicians")).body;
  if (!roster.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) throw new Error("NURUL setup failed");
  }
}

async function typeArea(page, selector, value) {
  await page.$eval(
    selector,
    (el, v) => {
      el.focus();
      Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

async function reloadList(page) {
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 300, timeout: 30000 }
  );
}

async function openReceiptFor(page, name) {
  return page.evaluate((rowName) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    if (!section) return false;
    const rows = [
      ...section.querySelectorAll("tbody tr"),
      ...section.querySelectorAll('[data-testid^="service-card-"]'),
    ];
    const row = rows.find(
      (r) =>
        r.getAttribute("data-customer") === rowName ||
        (r.textContent || "").includes(rowName)
    );
    const button = row?.querySelector("button[title='বিল প্রিন্ট']");
    if (!button) return false;
    button.click();
    return true;
  }, name);
}

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 1000 });
  const errors = trackErrors(page);

  await page.goto(`${BASE}/service`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 500, timeout: 30000 }
  );
  await addRoster(page);

  /* ------------------------------------------------------------------ */
  /* H1: create stores both fields; edit sets and clears them            */
  /* ------------------------------------------------------------------ */
  const NAME1 = uniqueName("SolCond");
  const created = await createJob(page, {
    ...basePayload(NAME1, "Sol Model"),
    solution: "ডিসপ্লে পরিবর্তন করা হয়েছে",
    condition: "ডেটা নষ্ট হলে দোকান দায়ী নয়",
  });
  check(
    "H1a",
    "create stores solution + condition and returns them",
    created.ok &&
      created.body.solution === "ডিসপ্লে পরিবর্তন করা হয়েছে" &&
      created.body.condition === "ডেটা নষ্ট হলে দোকান দায়ী নয়",
    JSON.stringify({
      status: created.status,
      solution: created.body.solution,
      condition: created.body.condition,
    })
  );

  const edited = await updateJob(page, created.body.id, {
    solution: "নতুন সমাধান",
    condition: "নতুন শর্ত",
  });
  const cleared = await updateJob(page, created.body.id, {
    solution: "",
    condition: "",
  });
  check(
    "H1b",
    "edit replaces both fields, then a blank edit clears them to NULL",
    edited.ok &&
      edited.body.solution === "নতুন সমাধান" &&
      edited.body.condition === "নতুন শর্ত" &&
      cleared.ok &&
      cleared.body.solution === null &&
      cleared.body.condition === null,
    JSON.stringify({
      edited: [edited.body.solution, edited.body.condition],
      cleared: [cleared.body.solution, cleared.body.condition],
    })
  );

  /* ------------------------------------------------------------------ */
  /* H2: 500-char boundary; 501 rejected on create and edit              */
  /* ------------------------------------------------------------------ */
  const MAX = "ক".repeat(500);
  const OVER = "ক".repeat(501);
  const atLimit = await createJob(page, {
    ...basePayload(uniqueName("MaxLen"), "Max Model"),
    solution: MAX,
    condition: MAX,
  });
  const overCreate = await createJob(page, {
    ...basePayload(uniqueName("OverLen"), "Over Model"),
    solution: OVER,
    condition: OVER,
  });
  const overSolution = await createJob(page, {
    ...basePayload(uniqueName("OverSol"), "Over Model"),
    solution: OVER,
  });
  const overCondition = await createJob(page, {
    ...basePayload(uniqueName("OverCond"), "Over Model"),
    condition: OVER,
  });
  const overEdit = await updateJob(page, created.body.id, { solution: OVER });
  check(
    "H2",
    "500 chars accepted; 501 rejected on create and edit",
    atLimit.ok &&
      atLimit.body.solution.length === 500 &&
      atLimit.body.condition.length === 500 &&
      overCreate.status === 400 &&
      overSolution.status === 400 &&
      overCondition.status === 400 &&
      overEdit.status === 400 &&
      String(overSolution.body.error || "").includes("বেশি"),
    JSON.stringify({
      atLimit: atLimit.status,
      overCreate: overCreate.status,
      overSolution: overSolution.status,
      overCondition: overCondition.status,
      overEdit: overEdit.status,
    })
  );

  /* ------------------------------------------------------------------ */
  /* H3: history searches model, problem and solution                    */
  /* ------------------------------------------------------------------ */
  const token = `${Date.now()}${Math.floor(Math.random() * 100) }`;
  const HIST_MODEL = `HistModel${token}`;
  const HIST_PROBLEM = `HistProblem${token}`;
  const HIST_SOLUTION = `HistSolution${token}`;
  const histRow = await createJob(page, {
    ...basePayload(uniqueName("Hist"), HIST_MODEL),
    problem: HIST_PROBLEM,
    solution: HIST_SOLUTION,
  });
  const byModel = await history(page, `q=${encodeURIComponent(HIST_MODEL)}`);
  const byProblem = await history(
    page,
    `q=${encodeURIComponent(HIST_PROBLEM)}`
  );
  const bySolution = await history(
    page,
    `q=${encodeURIComponent(HIST_SOLUTION)}`
  );
  const contains = (res, id) =>
    res.ok && (res.body.services || []).some((s) => s.id === id);
  check(
    "H3",
    "history finds a row by model, problem and solution text",
    contains(byModel, histRow.body.id) &&
      contains(byProblem, histRow.body.id) &&
      contains(bySolution, histRow.body.id),
    JSON.stringify({
      model: byModel.body.total,
      problem: byProblem.body.total,
      solution: bySolution.body.total,
    })
  );

  /* ------------------------------------------------------------------ */
  /* H4: date range filter and the 2-char minimum                        */
  /* ------------------------------------------------------------------ */
  const rangeToken = `Range${token}`;
  const OLD_DAY = shiftDay(TODAY, -7);
  const rangeRow = await createJob(page, {
    ...basePayload(uniqueName("Range"), `RangeModel${rangeToken}`),
    solution: `RangeSolution${rangeToken}`,
    serviceDate: OLD_DAY,
  });
  const inRange = await history(
    page,
    `q=${encodeURIComponent(rangeToken)}&from=${OLD_DAY}&to=${OLD_DAY}`
  );
  const outOfRange = await history(
    page,
    `q=${encodeURIComponent(rangeToken)}&from=${TODAY}&to=${TODAY}`
  );
  const shortQuery = await history(page, "q=a");
  const halfRange = await history(page, `q=${encodeURIComponent(rangeToken)}&from=${OLD_DAY}`);
  check(
    "H4",
    "date range includes/excludes correctly; short query is empty; half range is 400",
    contains(inRange, rangeRow.body.id) &&
      !contains(outOfRange, rangeRow.body.id) &&
      shortQuery.ok &&
      shortQuery.body.total === 0 &&
      halfRange.status === 400,
    JSON.stringify({
      inRange: inRange.body.total,
      outOfRange: outOfRange.body.total,
      short: shortQuery.body.total,
      half: halfRange.status,
    })
  );

  /* ------------------------------------------------------------------ */
  /* H5: archived rows disappear from the history                        */
  /* ------------------------------------------------------------------ */
  const ARCH_NAME = uniqueName("HistArch");
  const archToken = `Arch${token}`;
  const archRow = await createJob(page, {
    ...basePayload(ARCH_NAME, `ArchModel${token}`),
    solution: `ArchSolution${token}`,
  });
  const archDel = await api(page, `/api/services/${archRow.body.id}`, {
    method: "DELETE",
  });
  const afterArchive = await history(
    page,
    `q=${encodeURIComponent(archToken)}`
  );
  check(
    "H5",
    "history excludes an archived row even when the text matches",
    archDel.ok &&
      afterArchive.ok &&
      !contains(afterArchive, archRow.body.id),
    JSON.stringify({ del: archDel.status, total: afterArchive.body.total })
  );

  /* ------------------------------------------------------------------ */
  /* H6: header search still ignores solution-only text                  */
  /* ------------------------------------------------------------------ */
  const SEARCH_TOKEN = `SearchOnly${token}`;
  const searchRow = await createJob(page, {
    ...basePayload(uniqueName("SearchOnly"), `PlainModel${token}`),
    solution: `Solution${SEARCH_TOKEN}`,
  });
  const headerSearch = await api(
    page,
    `/api/services/search?q=${encodeURIComponent(SEARCH_TOKEN)}`
  );
  check(
    "H6",
    "header search does not match solution-only text (unchanged behaviour)",
    searchRow.ok &&
      headerSearch.ok &&
      headerSearch.body.count === 0 &&
      (headerSearch.body.services || []).length === 0,
    JSON.stringify({ status: headerSearch.status, body: headerSearch.body.count })
  );

  /* ------------------------------------------------------------------ */
  /* H7: suggestions come from the same model + problem only             */
  /* ------------------------------------------------------------------ */
  const suggToken = `Sugg${token}`;
  const SUGG_MODEL = `SuggModel${suggToken}`;
  const SUGG_PROBLEM = `SuggProblem${suggToken}`;
  await createJob(page, {
    ...basePayload(uniqueName("Sugg1"), SUGG_MODEL),
    problem: SUGG_PROBLEM,
    solution: `SuggOne${suggToken}`,
  });
  await createJob(page, {
    ...basePayload(uniqueName("Sugg2"), SUGG_MODEL),
    problem: SUGG_PROBLEM,
    solution: `SuggTwo${suggToken}`,
  });
  const suggestions = await api(
    page,
    `/api/services/solutions?model=${encodeURIComponent(
      SUGG_MODEL
    )}&problem=${encodeURIComponent(SUGG_PROBLEM)}`
  );
  const wrongKey = await api(
    page,
    `/api/services/solutions?model=${encodeURIComponent(
      SUGG_MODEL
    )}&problem=OtherProblem`
  );
  const list = suggestions.body.solutions || [];
  check(
    "H7",
    "solution suggestions return past notes for the same model + problem",
    suggestions.ok &&
      list.includes(`SuggOne${suggToken}`) &&
      list.includes(`SuggTwo${suggToken}`) &&
      wrongKey.ok &&
      (wrongKey.body.solutions || []).length === 0,
    JSON.stringify({ count: list.length, wrong: wrongKey.body.solutions })
  );

  /* ------------------------------------------------------------------ */
  /* H8: grouped visits copy the visit condition to every device row     */
  /* ------------------------------------------------------------------ */
  const GROUP_NAME = uniqueName("GroupCond");
  const GROUP_COND = `GroupCondition${token}`;
  const batch = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: GROUP_NAME,
      phone: "01700000971",
      technician: "NURUL",
      serviceDate: TODAY,
      condition: GROUP_COND,
      devices: [
        {
          model: `GroupModelA${token}`,
          problem: "প্রথম",
          solution: `GroupSolA${token}`,
          totalBill: "150",
        },
        {
          model: `GroupModelB${token}`,
          problem: "দ্বিতীয়",
          solution: `GroupSolB${token}`,
          totalBill: "250",
        },
      ],
    }),
  });
  const groupRows = (batch.body.services || [])
    .filter((s) => s.entryKind === "DEVICE")
    .sort((a, b) => a.id - b.id);
  check(
    "H8",
    "one visit stores the same condition on every device and keeps its own solution",
    batch.ok &&
      groupRows.length === 2 &&
      groupRows.every((r) => r.condition === GROUP_COND) &&
      groupRows[0].solution === `GroupSolA${token}` &&
      groupRows[1].solution === `GroupSolB${token}`,
    JSON.stringify({
      conditions: groupRows.map((r) => r.condition),
      solutions: groupRows.map((r) => r.solution),
    })
  );

  /* ------------------------------------------------------------------ */
  /* H9: single receipt prints শর্ত and never the solution               */
  /* ------------------------------------------------------------------ */
  const RECEIPT_NAME = uniqueName("ReceiptCond");
  const RECEIPT_COND = `ReceiptCondition${token}`;
  const RECEIPT_SOL = `ReceiptSolution${token}`;
  await createJob(page, {
    ...basePayload(RECEIPT_NAME, `ReceiptModel${token}`),
    solution: RECEIPT_SOL,
    condition: RECEIPT_COND,
  });
  await reloadList(page);
  await waitDailyRow(page, RECEIPT_NAME, true);
  const singleOpened = await openReceiptFor(page, RECEIPT_NAME);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(500);
  const singleReceipt = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      text: dialog?.textContent || "",
      conditionBlocks: dialog?.querySelectorAll(
        '[data-testid="receipt-condition"]'
      ).length,
    };
  });
  check(
    "H9",
    "single receipt shows the শর্ত block and never the internal solution",
    singleOpened &&
      singleReceipt.conditionBlocks === 1 &&
      singleReceipt.text.includes(RECEIPT_COND) &&
      !singleReceipt.text.includes(RECEIPT_SOL),
    JSON.stringify({
      opened: singleOpened,
      blocks: singleReceipt.conditionBlocks,
      hasCondition: singleReceipt.text.includes(RECEIPT_COND),
      leaksSolution: singleReceipt.text.includes(RECEIPT_SOL),
    })
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    polling: 200,
    timeout: 8000,
  });

  /* ------------------------------------------------------------------ */
  /* H10: combined slip prints শর্ত once, never the solutions            */
  /* ------------------------------------------------------------------ */
  await reloadList(page);
  await waitDailyRow(page, GROUP_NAME, true);
  const bundleOpened = await openReceiptFor(page, GROUP_NAME);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.waitForFunction(
    () => (document.body.textContent || "").includes("একসাথে সব ডিভাইসের বিল"),
    { polling: 300, timeout: 10000 }
  );
  await sleep(500);
  const bundleReceipt = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      text: dialog?.textContent || "",
      conditionBlocks: dialog?.querySelectorAll(
        '[data-testid="receipt-condition"]'
      ).length,
    };
  });
  check(
    "H10",
    "combined slip prints the group শর্ত exactly once, never the solutions",
    bundleOpened &&
      bundleReceipt.conditionBlocks === 1 &&
      bundleReceipt.text.includes(GROUP_COND) &&
      !bundleReceipt.text.includes(`GroupSolA${token}`) &&
      !bundleReceipt.text.includes(`GroupSolB${token}`),
    JSON.stringify({
      opened: bundleOpened,
      blocks: bundleReceipt.conditionBlocks,
      hasCondition: bundleReceipt.text.includes(GROUP_COND),
    })
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    polling: 200,
    timeout: 8000,
  });

  /* ------------------------------------------------------------------ */
  /* H11: schema has two optional TEXT columns                           */
  /* ------------------------------------------------------------------ */
  const schemaDb = new Database(process.env.MAHER_DB_PATH, { readonly: true });
  const cols = schemaDb.prepare("PRAGMA table_info(Service)").all();
  schemaDb.close();
  const solutionCol = cols.find((c) => c.name === "solution");
  const conditionCol = cols.find((c) => c.name === "condition");
  check(
    "H11",
    "Service.solution and Service.condition are optional TEXT columns",
    solutionCol?.type === "TEXT" &&
      solutionCol?.notnull === 0 &&
      conditionCol?.type === "TEXT" &&
      conditionCol?.notnull === 0,
    JSON.stringify({ solutionCol, conditionCol })
  );

  /* ------------------------------------------------------------------ */
  /* H12: an old snapshot without the new columns still restores         */
  /* ------------------------------------------------------------------ */
  if (!BACKUP_DIR) throw new Error("MAHER_BACKUP_DIR is required");
  const oldName = "maher-20000102-000000-001.db";
  const oldAbs = path.join(BACKUP_DIR, oldName);
  const OLD_ID = 4242;
  const oldDb = new Database(oldAbs);
  try {
    oldDb.exec(
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
    oldDb
      .prepare(
        `INSERT INTO Service (id, customerName, phone, model, technician,
           problem, totalBill, advance, due, status, shopExpense,
           expenseAmount, serviceDate, archived, createdAt, updatedAt)
         VALUES (?, 'OldSnapshotRow', '01000000766', 'M', 'NURUL', 'p',
                 100, 0, 100, 'Pending', '', 0, ?, 0, ?, ?)`
      )
      .run(
        OLD_ID,
        `${TODAY}T06:00:00.000Z`,
        `${TODAY}T06:00:00.000Z`,
        `${TODAY}T06:00:00.000Z`
      );
  } finally {
    oldDb.close();
  }
  const restored = await api(page, "/api/backup/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: oldName }),
  });
  const afterRestore = await api(page, `/api/services?date=${TODAY}`);
  const oldRow = (afterRestore.body.services || []).find(
    (s) => s.id === OLD_ID
  );
  check(
    "H12",
    "old snapshot without solution/condition restores safely (both NULL)",
    restored.ok &&
      !!oldRow &&
      oldRow.customerName === "OldSnapshotRow" &&
      oldRow.solution === null &&
      oldRow.condition === null,
    JSON.stringify({
      status: restored.status,
      error: restored.body.error,
      solution: oldRow?.solution,
      condition: oldRow?.condition,
    })
  );

  const unexpectedErrors = errors.filter(
    (e) => !/Failed to load resource.*400 \(Bad Request\)/.test(e)
  );
  check(
    "Z",
    "zero unexpected JS errors",
    unexpectedErrors.length === 0,
    unexpectedErrors.slice(0, 3).join(" | ")
  );

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-H CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
