/* Lane E: return/refund + technician damage-loss ledger.
 * Runs against the throwaway database supplied by scripts/run-tests.js — never
 * the live shop DB. */
const Database = require("better-sqlite3");
const path = require("node:path");
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const DAMAGE_DONE = uniqueName("DamageDone");
const RETURN_JOB = uniqueName("ReturnJob");
const UI_JOB = uniqueName("UiAdjust");
const RETURN_SECRET = "RETURN_DAMAGE_SECRET";
const DONE_SECRET = "DONE_DAMAGE_SECRET";
const UI_SECRET = "UI_DAMAGE_SECRET";

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;

async function createService(page, payload) {
  const res = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

async function getServices(page, date = TODAY) {
  const res = await api(page, `/api/services?date=${date}`);
  if (!res.ok) throw new Error(`services failed: ${JSON.stringify(res.body)}`);
  return res.body.services;
}

async function closeTopDialog(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { polling: 100, timeout: 8000 }
  );
}

async function setTextarea(page, id, value) {
  await page.$eval(
    `#${id}`,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );

  // A fresh suite DB has an empty roster.
  const roster = (await api(page, "/api/technicians")).body;
  if (!roster.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) throw new Error("NURUL setup failed: " + JSON.stringify(added.body));
  }

  const completed = await createService(page, {
    customerName: DAMAGE_DONE,
    phone: "01700000881",
    model: "Damage Model",
    technician: "NURUL",
    problem: "Damage probe",
    totalBill: 1500,
    advance: 1500,
    status: "Completed",
    damageLoss: 500,
    damageNote: DONE_SECRET,
    serviceDate: TODAY,
  });
  const toReturn = await createService(page, {
    customerName: RETURN_JOB,
    phone: "01700000882",
    model: "Return Model",
    technician: "NURUL",
    problem: "Return probe",
    totalBill: 1600,
    advance: 1200,
    status: "In-Progress",
    serviceDate: TODAY,
  });
  check(
    "E1",
    "create accepts damageLoss/damageNote without touching the bill",
    completed.damageLoss === 500 &&
      completed.damageNote === DONE_SECRET &&
      completed.totalBill === 1500 &&
      completed.due === 0,
    JSON.stringify({ loss: completed.damageLoss, due: completed.due })
  );

  const refunded = await api(page, `/api/services/${toReturn.id}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "সমাধান হয়নি" }),
  });
  check(
    "E2",
    "refund closes the job, returns the full advance and clears due",
    refunded.ok &&
      refunded.body.status === "Returned" &&
      refunded.body.refundAmount === 1200 &&
      refunded.body.due === 0 &&
      !!refunded.body.returnedAt,
    JSON.stringify({
      status: refunded.body.status,
      refund: refunded.body.refundAmount,
      due: refunded.body.due,
    })
  );

  // Deliberately use Node's fetch (not page.evaluate) for an expected 400:
  // Chrome would log the failed resource and our zero-JS-error guard would
  // mistake the expected rejection for an app bug.
  const secondRefundResponse = await fetch(
    `${BASE}/api/services/${toReturn.id}/refund`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  check(
    "E3",
    "second refund is rejected",
    secondRefundResponse.status === 400,
    String(secondRefundResponse.status)
  );

  const returnedDamage = await api(page, `/api/services/${toReturn.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ damageLoss: 500, damageNote: RETURN_SECRET }),
  });
  check(
    "E4",
    "damage loss can be added to a returned job; bill/due stay locked",
    returnedDamage.ok &&
      returnedDamage.body.damageLoss === 500 &&
      returnedDamage.body.totalBill === 1600 &&
      returnedDamage.body.advance === 1200 &&
      returnedDamage.body.due === 0 &&
      returnedDamage.body.status === "Returned",
    JSON.stringify({
      loss: returnedDamage.body.damageLoss,
      due: returnedDamage.body.due,
      status: returnedDamage.body.status,
    })
  );

  const daily = (await api(page, `/api/stats?date=${TODAY}`)).body;
  check(
    "E5",
    "daily stats exclude returned bill while keeping its damage loss",
    daily.today.count === 1 &&
      daily.today.returnedCount === 1 &&
      daily.today.bill === 1500 &&
      daily.today.advance === 1500 &&
      daily.today.due === 0 &&
      daily.today.refund === 1200 &&
      daily.today.damageLoss === 1000,
    JSON.stringify(daily.today)
  );

  const monthly = (
    await api(page, `/api/stats/monthly?from=${TODAY}&to=${TODAY}`)
  ).body;
  check(
    "E6",
    "monthly profit = active bill − normal expense − damage loss",
    monthly.summary.count === 1 &&
      monthly.summary.returnedCount === 1 &&
      monthly.summary.bill === 1500 &&
      monthly.summary.advance === 1500 &&
      monthly.summary.expense === 0 &&
      monthly.summary.damageLoss === 1000 &&
      monthly.summary.refund === 1200 &&
      monthly.summary.profit === 500,
    JSON.stringify(monthly.summary)
  );

  const dues = (await api(page, "/api/services/dues")).body;
  check(
    "E7",
    "returned job is absent from the dues list",
    dues.services.every((s) => s.id !== toReturn.id) &&
      dues.services.every((s) => s.status !== "Returned"),
    JSON.stringify({ count: dues.count, returned: toReturn.id })
  );

  const uiJob = await createService(page, {
    customerName: UI_JOB,
    phone: "01700000883",
    model: "UI Adjust Model",
    technician: "NURUL",
    problem: "UI adjustment probe",
    totalBill: 1200,
    advance: 1200,
    status: "Completed",
    serviceDate: TODAY,
  });

  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await waitDailyRow(page, DAMAGE_DONE, true);
  await waitDailyRow(page, RETURN_JOB, true);
  await waitDailyRow(page, UI_JOB, true);

  // Receipt must explain the return without leaking the internal loss.
  await clickDailyRowButton(page, RETURN_JOB, "বিল প্রিন্ট");
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  const receiptText = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.textContent || ""
  );
  check(
    "E8",
    "customer receipt shows the refund and never the damage secret",
    receiptText.includes("কাজটি সম্পন্ন হয়নি") &&
      receiptText.includes("ফেরত দেওয়া হয়েছে") &&
      receiptText.includes("1,200") &&
      !receiptText.includes(RETURN_SECRET) &&
      !receiptText.includes("ড্যামেজ"),
    receiptText.slice(0, 260)
  );
  await closeTopDialog(page);

  // UI: record a loss, then refund the same row through the combined dialog.
  await clickDailyRowButton(page, UI_JOB, "ফেরত / ড্যামেজ ক্ষতি");
  await page.waitForSelector('[data-testid="service-adjust-dialog"]', {
    timeout: 8000,
  });
  await page.click('[data-testid="adjust-damage-tab"]');
  await typeInto(page, "adjust-damage-loss", "300");
  await setTextarea(page, "adjust-damage-note", UI_SECRET);
  await page.click('[data-testid="adjust-damage-save"]');
  await waitToast(page, "ড্যামেজ ক্ষতি সেভ হয়েছে");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="service-adjust-dialog"]'),
    { polling: 100, timeout: 8000 }
  );
  const afterLoss = (await getServices(page)).find((s) => s.id === uiJob.id);
  check(
    "E9",
    "UI saves a damage loss",
    afterLoss?.damageLoss === 300 && afterLoss?.damageNote === UI_SECRET,
    JSON.stringify({ loss: afterLoss?.damageLoss })
  );

  await clickDailyRowButton(page, UI_JOB, "ফেরত / ড্যামেজ ক্ষতি");
  await page.waitForSelector('[data-testid="service-adjust-dialog"]', {
    timeout: 8000,
  });
  await page.click('[data-testid="adjust-refund-confirm"]');
  await waitToast(page, "ফেরত দেওয়া হয়েছে");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="service-adjust-dialog"]'),
    { polling: 100, timeout: 8000 }
  );
  const afterRefund = (await getServices(page)).find((s) => s.id === uiJob.id);
  check(
    "E10",
    "UI refund returns the full advance and keeps the damage loss",
    afterRefund?.status === "Returned" &&
      afterRefund?.refundAmount === 1200 &&
      afterRefund?.due === 0 &&
      afterRefund?.damageLoss === 300,
    JSON.stringify({
      status: afterRefund?.status,
      refund: afterRefund?.refundAmount,
      loss: afterRefund?.damageLoss,
    })
  );

  // Archiving a returned job also removes its refund/expense/damage from every
  // report. The confirmation must say so before the user commits.
  await clickDailyRowButton(page, UI_JOB, "ডিলিট");
  await page.waitForSelector('[role="alertdialog"]', {
    polling: 100,
    timeout: 8000,
  });
  const archiveText = await page.evaluate(
    () => document.querySelector('[role="alertdialog"]')?.textContent || ""
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.includes("বাতিল"))
      .click()
  );
  await page.waitForFunction(
    () => !document.querySelector('[role="alertdialog"]'),
    { polling: 100, timeout: 5000 }
  );
  const stillActive = (await getServices(page)).find((s) => s.id === uiJob.id);
  check(
    "E10b",
    "archive warning says a returned job's refund/expense/damage leave reports",
    archiveText.includes("রিফান্ড, খরচ ও ড্যামেজ ক্ষতিও") &&
      archiveText.includes("রিপোর্ট") &&
      stillActive?.archived === false,
    JSON.stringify({ archiveText: archiveText.slice(-160), archived: stillActive?.archived })
  );

  const afterUiDaily = (await api(page, `/api/stats?date=${TODAY}`)).body;
  check(
    "E11",
    "UI refunds are reflected in daily stats",
    afterUiDaily.today.count === 1 &&
      afterUiDaily.today.returnedCount === 2 &&
      afterUiDaily.today.bill === 1500 &&
      afterUiDaily.today.advance === 1500 &&
      afterUiDaily.today.refund === 2400 &&
      afterUiDaily.today.damageLoss === 1300,
    JSON.stringify(afterUiDaily.today)
  );

  // CSV backup must carry the new internal columns.
  const csv = await page.evaluate(async () => {
    const res = await fetch("/api/backup");
    return await res.text();
  });
  const csvHeader = csv.split(/\r?\n/)[0] || "";
  check(
    "E12",
    "CSV backup includes refund/damage columns",
    ["damageLoss", "damageNote", "returnedAt", "refundAmount", "refundNote"].every(
      (h) => csvHeader.includes(h)
    ),
    csvHeader.slice(0, 240)
  );

  // New snapshot round-trip: mutate a row, restore, and verify the ledger.
  const snap = await api(page, "/api/backup", { method: "POST" });
  if (!snap.ok) throw new Error("backup snapshot failed: " + JSON.stringify(snap.body));
  // Simulate a pre-v1.1.3 backup: a numeric shopExpense with a stale amount.
  // Restore must convert it to a canonical code, not leave the number visible.
  const snapPath = path.join(process.env.MAHER_BACKUP_DIR, snap.body.file);
  const snapDb = new Database(snapPath);
  try {
    snapDb
      .prepare("UPDATE Service SET shopExpense = ?, expenseAmount = ? WHERE id = ?")
      .run("1500", 0, completed.id);
  } finally {
    snapDb.close();
  }
  const mutate = await api(page, `/api/services/${completed.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ damageLoss: 999 }),
  });
  if (!mutate.ok) throw new Error("mutation failed: " + JSON.stringify(mutate.body));
  const restored = await api(page, "/api/backup/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: snap.body.file }),
  });
  const restoredRows = await getServices(page);
  const restoredDone = restoredRows.find((s) => s.id === completed.id);
  const restoredReturn = restoredRows.find((s) => s.id === toReturn.id);
  check(
    "E13",
    "snapshot restore preserves refund/damage columns and converts legacy numbers",
    restored.ok &&
      restored.body.normalizedExpenses >= 1 &&
      restoredDone?.damageLoss === 500 &&
      restoredDone?.shopExpense === "*J#" &&
      restoredDone?.expenseAmount === 1500 &&
      restoredReturn?.status === "Returned" &&
      restoredReturn?.refundAmount === 1200 &&
      restoredReturn?.damageLoss === 500,
    JSON.stringify({
      ok: restored.ok,
      normalized: restored.body.normalizedExpenses,
      doneExpense: restoredDone?.shopExpense,
      doneAmount: restoredDone?.expenseAmount,
      doneLoss: restoredDone?.damageLoss,
      refund: restoredReturn?.refundAmount,
      returnLoss: restoredReturn?.damageLoss,
    })
  );

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 300));
  await clickDailyRowButton(page, DAMAGE_DONE, "ফেরত / ড্যামেজ ক্ষতি");
  await page.waitForSelector('[data-testid="service-adjust-dialog"]', {
    timeout: 8000,
  });
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  check(
    "E14",
    "adjustment dialog does not overflow a 390px viewport",
    mobileOverflow === false,
    String(mobileOverflow)
  );
  await closeTopDialog(page);

  check(
    "Z",
    "zero JS errors",
    errors.length === 0,
    errors.slice(0, 3).join(" | ")
  );

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-E CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
