/* Lane F: multi-device visits, delivery dates, grouped receipt and editing a
 * returned job. Runs only on the throwaway DB supplied by run-tests.js. */
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const GROUP_CUSTOMER = uniqueName("GroupVisit");
const UI_GROUP = uniqueName("UiGroupVisit");
const RETURN_JOB = uniqueName("ReturnEdit");

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;

async function addRoster(page) {
  const roster = (await api(page, "/api/technicians")).body;
  if (!roster.technicians?.some((t) => t.name === "NURUL")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) {
      throw new Error("NURUL setup failed: " + JSON.stringify(added.body));
    }
  }
}

async function createService(page, payload) {
  const res = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function dayServices(page) {
  const res = await api(page, `/api/services?date=${TODAY}`);
  if (!res.ok) throw new Error(`services failed: ${JSON.stringify(res.body)}`);
  return res.body.services;
}

async function closeDialog(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { polling: 100, timeout: 8000 }
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
  await addRoster(page);

  // ---- F1: one visit, two devices, one group ----
  const expectedDelivery = shiftDay(TODAY, 2);
  const batch = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: GROUP_CUSTOMER,
      phone: "01700000901",
      technician: "NURUL",
      serviceDate: TODAY,
      deliveryDate: expectedDelivery,
      devices: [
        {
          model: "Group Redmi",
          problem: "ডিসপ্লে নষ্ট",
          totalBill: "3000",
          advance: "1000",
          status: "In-Progress",
          shopExpense: "*J#",
          partsShop: "Group Parts",
        },
        {
          model: "Group iPhone",
          problem: "ব্যাটারি",
          totalBill: "2000",
          advance: "2000",
          status: "Delivered",
          shopExpense: "*B#",
        },
      ],
    }),
  });
  const groupRows = Array.isArray(batch.body.services)
    ? batch.body.services
    : [];
  const gid = batch.body.groupId;
  check(
    "F1",
    "batch create saves both devices in one group with shared customer/date",
    batch.ok &&
      groupRows.length === 2 &&
      typeof gid === "string" &&
      groupRows.every((r) => r.groupId === gid) &&
      groupRows.every((r) => r.customerName === GROUP_CUSTOMER) &&
      groupRows.every((r) => r.technician === "NURUL") &&
      groupRows[0].model === "Group Redmi" &&
      groupRows[1].model === "Group iPhone" &&
      groupRows[0].deliveredAt === null &&
      !!groupRows[1].deliveredAt &&
      !!groupRows[0].deliveryDate,
    JSON.stringify({
      ok: batch.ok,
      groupId: gid,
      devices: groupRows.map((r) => r.model),
      delivered: groupRows.map((r) => !!r.deliveredAt),
      deliveryDate: groupRows[0]?.deliveryDate,
    })
  );

  const grouped = await api(
    page,
    `/api/services?groupId=${encodeURIComponent(gid)}`
  );
  check(
    "F2",
    "group fetch returns every device row for the combined slip",
    grouped.ok &&
      grouped.body.services?.length === 2 &&
      grouped.body.services[0].id < grouped.body.services[1].id,
    JSON.stringify({ ok: grouped.ok, count: grouped.body.services?.length })
  );

  // ---- F3: deliveredAt follows the status; expected date stays editable ----
  const first = groupRows[0];
  const toDelivered = await api(page, `/api/services/${first.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Delivered" }),
  });
  const reopened = await api(page, `/api/services/${first.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "In-Progress" }),
  });
  const rescheduled = await api(page, `/api/services/${first.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryDate: shiftDay(TODAY, 5) }),
  });
  check(
    "F3",
    "Delivered stamps deliveredAt, reopening clears it, expected date is editable",
    toDelivered.ok &&
      !!toDelivered.body.deliveredAt &&
      reopened.ok &&
      reopened.body.deliveredAt === null &&
      rescheduled.ok &&
      !!rescheduled.body.deliveryDate &&
      rescheduled.body.deliveryDate !== groupRows[0].deliveryDate,
    JSON.stringify({
      delivered: !!toDelivered.body.deliveredAt,
      reopened: reopened.body.deliveredAt,
      deliveryDate: rescheduled.body.deliveryDate,
    })
  );

  // ---- F4: a returned row stays editable without touching the ledger ----
  const returned = await createService(page, {
    customerName: RETURN_JOB,
    phone: "01700000902",
    model: "Return Edit Model",
    technician: "NURUL",
    problem: "Return edit probe",
    totalBill: 1600,
    advance: 700,
    status: "In-Progress",
    shopExpense: "*J#",
    serviceDate: TODAY,
  });
  const refunded = await api(page, `/api/services/${returned.id}/refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expenseAction: "writeoff" }),
  });
  const edited = await api(page, `/api/services/${returned.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: `${RETURN_JOB}Edited`,
      model: "Return Edit Model v2",
      deliveryDate: shiftDay(TODAY, 3),
      damageLoss: 100,
    }),
  });
  const billBlocked = await fetch(`${BASE}/api/services/${returned.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalBill: 999 }),
  });
  const statusBlocked = await fetch(`${BASE}/api/services/${returned.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "Delivered" }),
  });
  check(
    "F4",
    "returned rows accept safe edits but reject bill/advance/status changes",
    refunded.ok &&
      refunded.body.expenseWrittenOff === true &&
      edited.ok &&
      edited.body.model === "Return Edit Model v2" &&
      edited.body.totalBill === 1600 &&
      edited.body.advance === 700 &&
      edited.body.due === 0 &&
      edited.body.status === "Returned" &&
      edited.body.expenseWrittenOff === true &&
      !!edited.body.deliveryDate &&
      edited.body.damageLoss === 100 &&
      billBlocked.status === 400 &&
      statusBlocked.status === 400,
    JSON.stringify({
      edited: edited.ok,
      model: edited.body.model,
      bill: edited.body.totalBill,
      status: edited.body.status,
      writeOff: edited.body.expenseWrittenOff,
      billBlocked: billBlocked.status,
      statusBlocked: statusBlocked.status,
    })
  );

  // ---- F5: UI multi-device entry (primary + one extra device) ----
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  // Wait for the fetched roster to fill the form's technician select.
  await page.waitForFunction(
    () => document.querySelector("#svc-tech")?.textContent?.includes("NURUL"),
    { polling: 200, timeout: 15000 }
  );
  await typeInto(page, "svc-name", UI_GROUP);
  await typeInto(page, "svc-phone", "01700000903");
  await typeInto(page, "svc-model", "UI Primary");
  await typeInto(page, "svc-problem", "প্রথম ডিভাইস");
  await typeInto(page, "svc-bill", "1500");
  await typeInto(page, "svc-adv", "500");
  await typeInto(page, "svc-expense", "*J#");
  await typeInto(page, "svc-delivery-date", shiftDay(TODAY, 4));
  await page.click('[data-testid="add-device"]');
  await page.waitForSelector("#svc-device-1-model", { timeout: 5000 });
  await typeInto(page, "svc-device-1-model", "UI Secondary");
  await typeInto(page, "svc-device-1-problem", "দ্বিতীয় ডিভাইস");
  await typeInto(page, "svc-device-1-bill", "800");
  await typeInto(page, "svc-device-1-adv", "800");
  await typeInto(page, "svc-device-1-expense", "*B#");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type='submit']")].find(
      (b) => b.textContent.includes("সেভ করুন")
    );
    if (!button) throw new Error("save button missing");
    button.click();
  });
  await waitToast(page, "2টি ডিভাইস একসাথে সেভ হয়েছে");
  const uiRows = (await dayServices(page)).filter(
    (s) => s.customerName === UI_GROUP
  );
  check(
    "F5",
    "UI form saves two devices in one group with per-device bills",
    uiRows.length === 2 &&
      uiRows[0].groupId === uiRows[1].groupId &&
      uiRows[0].model === "UI Primary" &&
      uiRows[1].model === "UI Secondary" &&
      uiRows[0].totalBill === 1500 &&
      uiRows[1].totalBill === 800 &&
      uiRows[0].advance === 500 &&
      uiRows[1].advance === 800,
    JSON.stringify({
      count: uiRows.length,
      models: uiRows.map((r) => r.model),
      bills: uiRows.map((r) => r.totalBill),
      group: uiRows[0]?.groupId === uiRows[1]?.groupId,
    })
  );

  // ---- F6: receipt shows both devices on separate rows with totals ----
  await waitDailyRow(page, UI_GROUP, true);
  await clickDailyRowButton(page, UI_GROUP, "বিল প্রিন্ট");
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.waitForFunction(
    (a, b) => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!dialog && !!dialog.textContent?.includes(a) && !!dialog.textContent?.includes(b);
    },
    { polling: 100, timeout: 8000 },
    "UI Primary",
    "UI Secondary"
  );
  const receiptText = await page.evaluate(
    () => document.querySelector('[role="dialog"]')?.textContent || ""
  );
  check(
    "F6",
    "combined receipt lists each device on its own row with a total and no shop cost",
    receiptText.includes("UI Primary") &&
      receiptText.includes("UI Secondary") &&
      receiptText.includes("ডিভাইস: 2টি") &&
      receiptText.includes("মোট") &&
      receiptText.includes("2,300") &&
      !receiptText.includes("*J#") &&
      !receiptText.includes("*B#") &&
      !receiptText.includes("Group Parts"),
    receiptText.slice(0, 300)
  );
  await closeDialog(page);

  // ---- F7: returned-row Edit stays available; ledger fields are locked ----
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, RETURN_JOB, true);
  await clickDailyRowButton(
    page,
    RETURN_JOB,
    "এডিট (বিল/জমা/অবস্থা লক থাকবে)"
  );
  await page.waitForSelector("#svc-bill", { timeout: 8000 });
  const locked = await page.evaluate(() => ({
    bill: document.querySelector("#svc-bill")?.readOnly ?? false,
    advance: document.querySelector("#svc-adv")?.readOnly ?? false,
    outOfRange: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  await typeInto(page, "svc-model", "Return UI Edited");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type='submit']")].find(
      (b) => b.textContent.includes("আপডেট করুন")
    );
    if (!button) throw new Error("update button missing");
    button.click();
  });
  await waitToast(page, "আপডেট হয়েছে");
  const afterUiEdit = (await dayServices(page)).find(
    (s) => s.id === returned.id
  );
  check(
    "F7",
    "returned row Edit is available, bill/advance are read-only and safe edits save",
    locked.bill &&
      locked.advance &&
      !locked.outOfRange &&
      afterUiEdit?.model === "Return UI Edited" &&
      afterUiEdit?.totalBill === 1600 &&
      afterUiEdit?.status === "Returned",
    JSON.stringify({
      locked,
      model: afterUiEdit?.model,
      bill: afterUiEdit?.totalBill,
      status: afterUiEdit?.status,
    })
  );

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
    console.error("LANE-F CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
