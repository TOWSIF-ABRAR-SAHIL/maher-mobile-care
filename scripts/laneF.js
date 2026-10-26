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
/** ISO timestamp from the API → its Dhaka calendar day ("YYYY-MM-DD"). */
const isoDay = (value) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";
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

/** One entry per customer visit: grouped devices live inside a single row. */
function visitRows(page, customer) {
  return page.evaluate(
    (sel, name) =>
      [...document.querySelectorAll(`${sel} tbody tr`)]
        .filter((tr) => tr.getAttribute("data-customer") === name)
        .map((tr) => ({
          testid: tr.getAttribute("data-testid") || "",
          devices: Number(tr.getAttribute("data-devices") || 0),
          deviceLines: tr.querySelectorAll('[data-testid^="visit-device-"]')
            .length,
          total:
            tr.querySelector('[data-testid^="visit-total-"]')?.textContent || "",
          text: tr.textContent || "",
        })),
    '[data-testid="daily-services"]',
    customer
  );
}

/** Mobile card equivalent of visitRows(). */
function visitCards(page, customer) {
  return page.evaluate(
    (sel, name) =>
      [...document.querySelectorAll(`${sel} [data-testid^="visit-card-"]`)]
        .filter((card) => card.getAttribute("data-customer") === name)
        .map((card) => ({
          testid: card.getAttribute("data-testid") || "",
          id: card.querySelector('[data-testid^="visit-id-"]')?.textContent?.trim() || "",
          deviceLines: card.querySelectorAll('[data-testid^="visit-device-"]')
            .length,
          text: card.textContent || "",
        })),
    '[data-testid="daily-services"]',
    customer
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

  // ---- F14: the expected delivery date is per device, not per visit ----
  const PER_DEVICE = uniqueName("PerDeviceDate");
  const perDevice = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: PER_DEVICE,
      phone: "01700000904",
      technician: "NURUL",
      serviceDate: TODAY,
      // Older callers still send one shared date; a device-level date wins and
      // a device without one inherits the shared value.
      deliveryDate: shiftDay(TODAY, 3),
      devices: [
        {
          model: "Date A",
          problem: "প্রথম ডিভাইস",
          status: "In-Progress",
          totalBill: 100,
          deliveryDate: shiftDay(TODAY, 5),
        },
        {
          model: "Date B",
          problem: "দ্বিতীয় ডিভাইস",
          status: "In-Progress",
          totalBill: 200,
        },
      ],
    }),
  });
  const perDeviceRows = Array.isArray(perDevice.body.services)
    ? perDevice.body.services
    : [];
  check(
    "F14",
    "batch create keeps a delivery date per device with a shared fallback",
    perDevice.ok &&
      perDeviceRows.length === 2 &&
      isoDay(perDeviceRows[0].deliveryDate) === shiftDay(TODAY, 5) &&
      isoDay(perDeviceRows[1].deliveryDate) === shiftDay(TODAY, 3),
    JSON.stringify({
      ok: perDevice.ok,
      dates: perDeviceRows.map((r) => isoDay(r.deliveryDate)),
      expected: [shiftDay(TODAY, 5), shiftDay(TODAY, 3)],
    })
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
  // Each device card owns a date input, defaulted to the selected entry day.
  const formDefaults = await page.evaluate(() => ({
    device1: document.querySelector("#svc-delivery-date")?.value || "",
    inDeviceCard: !!document.querySelector('[data-testid="device-delivery-0"]'),
    insideDeviceCard: !!document.querySelector(
      '[data-testid="device-1"] #svc-delivery-date'
    ),
  }));
  await typeInto(page, "svc-name", UI_GROUP);
  await typeInto(page, "svc-phone", "01700000903");
  await typeInto(page, "svc-model", "UI Primary");
  await typeInto(page, "svc-problem", "প্রথম ডিভাইস");
  await typeInto(page, "svc-bill", "1500");
  await typeInto(page, "svc-delivery-date", shiftDay(TODAY, 4));
  // The form has a sticky bottom save bar. A minimal scroll would leave the
  // add button under it, so centre the button before the real mouse click.
  await page.$eval('[data-testid="add-device"]', (el) =>
    el.scrollIntoView({ block: "center" })
  );
  await page.click('[data-testid="add-device"]');
  await page.waitForSelector("#svc-device-1-model", { timeout: 5000 });
  const secondDeviceDefault = await page.$eval(
    "#svc-device-1-delivery-date",
    (el) => el.value
  );
  await typeInto(page, "svc-device-1-model", "UI Secondary");
  await typeInto(page, "svc-device-1-problem", "দ্বিতীয় ডিভাইস");
  await typeInto(page, "svc-device-1-bill", "800");
  await typeInto(page, "svc-device-1-delivery-date", shiftDay(TODAY, 6));
  // Money, status and shop cost are entered once for the whole visit.
  await typeInto(page, "svc-adv", "500");
  await typeInto(page, "svc-expense", "*J#");
  await typeInto(page, "svc-parts-shop", "Group Parts");
  const uiMoney = await page.evaluate(() => ({
    total: document.querySelector("#svc-total-bill")?.value,
    due: document.querySelector("#svc-due")?.value,
    perDeviceMoney:
      !!document.querySelector("#svc-device-1-adv") ||
      !!document.querySelector("#svc-device-1-expense") ||
      !!document.querySelector("#svc-device-1-status"),
  }));
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
    "UI form saves numbered devices with one shared advance and auto total",
    uiRows.length === 2 &&
      uiRows[0].groupId === uiRows[1].groupId &&
      uiRows[0].model === "UI Primary" &&
      uiRows[1].model === "UI Secondary" &&
      uiRows[0].totalBill === 1500 &&
      uiRows[1].totalBill === 800 &&
      uiRows.every((r) => r.status === "In-Progress") &&
      uiRows[0].advance === 500 &&
      uiRows[1].advance === 0 &&
      uiRows[0].due === 1000 &&
      uiRows[1].due === 800 &&
      uiRows.reduce((sum, r) => sum + r.due, 0) === 1800 &&
      uiRows[0].expenseAmount === 1500 &&
      uiRows[1].expenseAmount === 0 &&
      uiRows[0].partsShop === "Group Parts" &&
      uiRows[1].partsShop === null &&
      uiMoney.total === "2300" &&
      uiMoney.due === "1,800" &&
      !uiMoney.perDeviceMoney,
    JSON.stringify({
      count: uiRows.length,
      models: uiRows.map((r) => r.model),
      bills: uiRows.map((r) => r.totalBill),
      advances: uiRows.map((r) => r.advance),
      dues: uiRows.map((r) => r.due),
      expenses: uiRows.map((r) => r.expenseAmount),
      shops: uiRows.map((r) => r.partsShop),
      group: uiRows[0]?.groupId === uiRows[1]?.groupId,
      uiMoney,
    })
  );

  check(
    "F15",
    "each device has its own delivery date, defaulted to the entry day",
    formDefaults.device1 === TODAY &&
      formDefaults.inDeviceCard &&
      formDefaults.insideDeviceCard &&
      secondDeviceDefault === TODAY &&
      isoDay(uiRows[0].deliveryDate) === shiftDay(TODAY, 4) &&
      isoDay(uiRows[1].deliveryDate) === shiftDay(TODAY, 6),
    JSON.stringify({
      formDefaults,
      secondDeviceDefault,
      dates: uiRows.map((r) => isoDay(r.deliveryDate)),
      expected: [shiftDay(TODAY, 4), shiftDay(TODAY, 6)],
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
  const receiptMeta = await page.evaluate(() => {
    const bundle = document.querySelector(
      '[role="dialog"] [data-receipt-group]'
    );
    const text = bundle?.textContent || "";
    return {
      billNo: text.match(/বিল নং:\s*(#[0-9]+)/)?.[1] || "",
      hasBillList: text.includes(", #"),
      perDeviceDates: (text.match(/প্রত্যাশিত ডেলিভারি:/g) || []).length,
      headerDate: text.includes("ডেলিভারির তারিখ"),
    };
  });
  check(
    "F16",
    "combined slip prints ONE bill number and each device's own delivery date",
    receiptMeta.billNo === `#${uiRows[0].id}` &&
      !receiptMeta.hasBillList &&
      receiptMeta.perDeviceDates === 2 &&
      !receiptMeta.headerDate,
    JSON.stringify({ ...receiptMeta, expectedBill: `#${uiRows[0].id}` })
  );
  await closeDialog(page);

  // ---- F17: a grouped visit never flashes a single-device slip first ----
  let slowGroupRequests = 0;
  const slowGroupFetch = (request) => {
    if (request.url().includes("/api/services?groupId=")) {
      slowGroupRequests += 1;
      setTimeout(() => request.continue().catch(() => {}), 500);
    } else {
      request.continue().catch(() => {});
    }
  };
  await page.setRequestInterception(true);
  page.on("request", slowGroupFetch);
  await page.evaluate(() => {
    window.__sawSingleReceipt = false;
    const scan = () => {
      if (
        document.querySelector(
          '[role="dialog"] [data-receipt]:not([data-receipt-group])'
        )
      ) {
        window.__sawSingleReceipt = true;
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    window.__receiptObserver = observer;
  });
  await clickDailyRowButton(page, UI_GROUP, "বিল প্রিন্ট");
  await page.waitForFunction(
    () => !!document.querySelector('[role="dialog"] [data-receipt-group]'),
    { polling: 50, timeout: 15000 }
  );
  const flash = await page.evaluate(() => {
    window.__receiptObserver?.disconnect();
    return {
      sawSingle: window.__sawSingleReceipt === true,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
    };
  });
  page.off("request", slowGroupFetch);
  await page.setRequestInterception(false);
  check(
    "F17",
    "a 2-device visit opens straight as one slip (no single-device flash)",
    slowGroupRequests === 1 && !flash.sawSingle && flash.dialogs === 1,
    JSON.stringify({ slowGroupRequests, ...flash })
  );

  // ---- F18: toasts never print on a customer bill ----
  await page.emulateMediaType("print");
  const toastPrint = await page.evaluate(() => {
    const section = document.querySelector("[data-sonner-toaster]");
    if (!section) return { present: false, hidden: true };
    for (let node = section; node; node = node.parentElement) {
      if (getComputedStyle(node).display === "none") {
        return { present: true, hidden: true };
      }
    }
    return { present: true, hidden: false };
  });
  await page.emulateMediaType("screen");
  check(
    "F18",
    "print paper hides toasts (never on a customer bill)",
    toastPrint.hidden,
    JSON.stringify(toastPrint)
  );
  await closeDialog(page);

  // ---- F8: one list entry per visit, devices listed inside it ----
  const uiVisit = await visitRows(page, UI_GROUP);
  check(
    "F8",
    "one daily entry for a 2-device visit; both devices listed inside",
    uiVisit.length === 1 &&
      uiVisit[0].devices === 2 &&
      uiVisit[0].deviceLines === 2 &&
      uiVisit[0].text.includes("UI Primary") &&
      uiVisit[0].text.includes("UI Secondary") &&
      uiVisit[0].text.includes("২টি ডিভাইস"),
    JSON.stringify({
      rows: uiVisit.length,
      devices: uiVisit[0]?.devices,
      lines: uiVisit[0]?.deviceLines,
    })
  );

  // ---- F9: one visit entry; group total + each device's own money ----
  const uiVisitText = uiVisit[0]?.text ?? "";
  const deviceMoneyCount = await page.evaluate(
    (sel, name) => {
      const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
        (tr) => tr.getAttribute("data-customer") === name
      );
      return row
        ? row.querySelectorAll('[data-testid^="visit-dev-money-"]').length
        : -1;
    },
    '[data-testid="daily-services"]',
    UI_GROUP
  );
  check(
    "F9",
    "one visit entry: group total 2,300/1,800 plus each device's own 1,500 and 800",
    uiVisit.length === 1 &&
      uiVisitText.split(UI_GROUP).length - 1 === 1 &&
      uiVisit[0].total.includes("2,300") &&
      uiVisit[0].total.includes("1,800") &&
      uiVisitText.includes("৳1,500") &&
      uiVisitText.includes("৳800") &&
      deviceMoneyCount === 2,
    JSON.stringify({ total: uiVisit[0]?.total, deviceMoneyCount })
  );

  // ---- F13: one visit ID, numbered device lines, organised total strip ----
  const visitLabels = await page.evaluate(
    (sel, name) => {
      const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
        (tr) => tr.getAttribute("data-customer") === name
      );
      if (!row) return { error: "visit row missing" };
      const strip = row.querySelector('[data-testid^="visit-summary-"]');
      return {
        id: row.querySelector('[data-testid^="visit-id-"]')?.textContent?.trim() || "",
        labels: [...row.querySelectorAll('[data-testid^="visit-dev-num-"]')].map(
          (el) => el.textContent.trim()
        ),
        strip: strip?.textContent?.trim() || "",
        oldHint: (row.textContent || "").includes("প্রতি ডিভাইসের হিসাব নিচে"),
      };
    },
    '[data-testid="daily-services"]',
    UI_GROUP
  );
  check(
    "F13",
    "one visit ID, each device numbered, total strip organised",
    /^#\d+$/.test(visitLabels.id) &&
      visitLabels.labels.length === 2 &&
      visitLabels.labels[0].includes("ডিভাইস ১") &&
      visitLabels.labels[1].includes("ডিভাইস ২") &&
      visitLabels.strip.includes("ভিজিটের মোট") &&
      !visitLabels.oldHint,
    JSON.stringify(visitLabels)
  );

  // ---- F20: device lines sit exactly under their own column titles ----
  const alignment = await page.evaluate(
    (sel, name) => {
      const section = document.querySelector(sel);
      if (!section) return { error: "section missing" };
      const heads = [...section.querySelectorAll("thead th")];
      const row = [...section.querySelectorAll("tbody tr")].find(
        (tr) => tr.getAttribute("data-customer") === name
      );
      if (!row) return { error: "visit row missing" };
      // ID + কাস্টমার sit outside the spanning cell; the last five columns are
      // the ones the device grid must mirror.
      const expected = heads
        .slice(-5)
        .map((th) => th.getBoundingClientRect().x);
      const lines = [...row.querySelectorAll('[data-testid^="visit-device-"]')];
      const diffs = lines.map((line) =>
        [...line.children].map((cell, i) =>
          Math.abs(cell.getBoundingClientRect().x - expected[i])
        )
      );
      const total = row.querySelector('[data-testid^="visit-total-"]');
      const totalDiff = total
        ? Math.abs(total.parentElement.getBoundingClientRect().x - expected[2])
        : 999;
      return {
        expected: expected.map((x) => Math.round(x)),
        diffs,
        totalDiff,
        lines: lines.length,
      };
    },
    '[data-testid="daily-services"]',
    UI_GROUP
  );
  check(
    "F20",
    "each device line is aligned under its own table column",
    !alignment.error &&
      alignment.lines === 2 &&
      alignment.diffs.length === 2 &&
      alignment.diffs.every((line) => line.every((d) => d <= 1.5)) &&
      alignment.totalDiff <= 1.5,
    JSON.stringify(alignment)
  );

  // ---- F21: the visit header folds and unfolds its device lines ----
  const readVisit = () =>
    page.evaluate(
      (sel, name) => {
        const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
          (tr) => tr.getAttribute("data-customer") === name
        );
        if (!row) return { error: "visit row missing" };
        const toggle = row.querySelector('[data-testid^="visit-toggle-"]');
        return {
          lines: row.querySelectorAll('[data-testid^="visit-device-"]').length,
          expanded: toggle?.getAttribute("aria-expanded") ?? null,
          totals: row.textContent.includes("2,300"),
          customer: row.textContent.includes(name),
        };
      },
      '[data-testid="daily-services"]',
      UI_GROUP
    );
  const clickToggle = () =>
    page.evaluate(
      (sel, name) => {
        const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
          (tr) => tr.getAttribute("data-customer") === name
        );
        const btn = row?.querySelector('[data-testid^="visit-toggle-"]');
        if (!btn) return false;
        btn.click();
        return true;
      },
      '[data-testid="daily-services"]',
      UI_GROUP
    );
  const foldOpen = await readVisit();
  const clickedClosed = await clickToggle();
  await new Promise((r) => setTimeout(r, 350));
  const foldClosed = await readVisit();
  const clickedOpen = await clickToggle();
  await new Promise((r) => setTimeout(r, 350));
  const foldBack = await readVisit();
  check(
    "F21",
    "visit header folds/unfolds its device lines and keeps the group total",
    foldOpen.lines === 2 &&
      foldOpen.expanded === "true" &&
      clickedClosed &&
      foldClosed.lines === 0 &&
      foldClosed.expanded === "false" &&
      foldClosed.totals &&
      foldClosed.customer &&
      clickedOpen &&
      foldBack.lines === 2 &&
      foldBack.expanded === "true",
    JSON.stringify({ foldOpen, foldClosed, foldBack })
  );


  const deviceEdit = await page.evaluate(
    (sel, name) => {
      const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
        (tr) => tr.getAttribute("data-customer") === name
      );
      if (!row) return { error: "visit row missing" };
      const lines = [...row.querySelectorAll('[data-testid^="visit-device-"]')];
      const second = lines[1];
      if (!second) return { error: "second device line missing" };
      const edit = second.querySelector("button[title='এডিট']");
      if (!edit) return { error: "device edit missing" };
      edit.click();
      return { lines: lines.length };
    },
    '[data-testid="daily-services"]',
    UI_GROUP
  );
  if (!deviceEdit.error) {
    await page.waitForFunction(
      () => document.querySelector("#svc-model")?.value === "UI Secondary",
      { polling: 100, timeout: 8000 }
    );
    await page.evaluate(() => {
      const cancel = [...document.querySelectorAll("form button")].find((b) =>
        b.textContent.trim() === "বাতিল"
      );
      if (cancel) cancel.click();
    });
  }
  check(
    "F10",
    "each device line has its own status chip and edit opens that device",
    deviceEdit.lines === 2 && !deviceEdit.error,
    JSON.stringify(deviceEdit)
  );

  // ---- F12: mobile shows one card per visit too ----
  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', {
    timeout: 30000,
  });
  const mobileVisit = await visitCards(page, UI_GROUP);
  check(
    "F12",
    "mobile: one card for the 2-device visit with numbered device lines",
    mobileVisit.length === 1 &&
      mobileVisit[0].deviceLines === 2 &&
      /^#\d+$/.test(mobileVisit[0].id || "") &&
      mobileVisit[0].text.includes("UI Primary") &&
      mobileVisit[0].text.includes("UI Secondary") &&
      mobileVisit[0].text.includes("ডিভাইস ১") &&
      mobileVisit[0].text.includes("ডিভাইস ২") &&
      mobileVisit[0].text.includes("ভিজিটের মোট"),
    JSON.stringify({
      cards: mobileVisit.length,
      lines: mobileVisit[0]?.deviceLines,
      id: mobileVisit[0]?.id,
    })
  );
  await page.setViewport({ width: 1366, height: 900 });

  // ---- F11: a status filter keeps the whole visit, with a hint ----
  const MIXED_GROUP = uniqueName("MixedGroup");
  const mixed = await api(page, "/api/services/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: MIXED_GROUP,
      phone: "01700000911",
      technician: "NURUL",
      serviceDate: TODAY,
      devices: [
        { model: "Mixed A", problem: "প্রথম", status: "Delivered", totalBill: 500 },
        { model: "Mixed B", problem: "দ্বিতীয়", status: "Delivered", totalBill: 500 },
        { model: "Mixed C", problem: "তৃতীয়", status: "Pending", totalBill: 400 },
      ],
    }),
  });
  if (!mixed.ok) {
    throw new Error("mixed group create failed: " + JSON.stringify(mixed.body));
  }
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"] tbody tr', {
    timeout: 30000,
  });
  const chip = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-testid="daily-services"] button')]
      .find((b) => b.textContent.trim().startsWith("ডেলিভারি"));
    if (!btn) return null;
    const text = btn.textContent.trim();
    btn.click();
    return text;
  });
  await new Promise((r) => setTimeout(r, 400));
  const mixedRows = await visitRows(page, MIXED_GROUP);
  const hint = await page.evaluate(
    (sel, name) => {
      const row = [...document.querySelectorAll(`${sel} tbody tr`)].find(
        (tr) => tr.getAttribute("data-customer") === name
      );
      return (
        row
          ?.querySelector('[data-testid="visit-filter-hint"]')
          ?.textContent?.trim() || ""
      );
    },
    '[data-testid="daily-services"]',
    MIXED_GROUP
  );
  check(
    "F11",
    "status chip counts visits; filtering keeps every device and hints the match",
    !!chip &&
      /ডেলিভারি \((?:2|২)\)/.test(chip) &&
      mixedRows.length === 1 &&
      mixedRows[0].deviceLines === 3 &&
      mixedRows[0].text.includes("Mixed A") &&
      mixedRows[0].text.includes("Mixed C") &&
      hint.includes("২টি ডিভাইস মিলেছে"),
    JSON.stringify({ chip, rows: mixedRows.length, lines: mixedRows[0]?.deviceLines, hint })
  );

  // ---- F19: the dues list shows one row per visit with ONE slip ----
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const button = document.querySelector('[data-testid="open-dues"]');
    if (!button) throw new Error("dues button missing");
    button.click();
  });
  await page.waitForSelector('[data-testid="dues-dialog"]', { timeout: 15000 });
  await page.waitForFunction(
    (name) =>
      [
        ...document.querySelectorAll(
          '[data-testid="dues-dialog"] [data-testid^="due-visit-"]:not([data-testid^="due-visit-card-"])'
        ),
      ].some((el) => el.textContent?.includes(name)),
    { polling: 200, timeout: 15000 },
    UI_GROUP
  );
  const duesRow = await page.evaluate((name) => {
    const rows = [
      ...document.querySelectorAll(
        '[data-testid="dues-dialog"] [data-testid^="due-visit-"]:not([data-testid^="due-visit-card-"])'
      ),
    ].filter((el) => el.textContent?.includes(name));
    const row = rows[0];
    return {
      rows: rows.length,
      devices: Number(row?.getAttribute("data-devices") || 0),
      text: row?.textContent || "",
      receipts: row
        ? [...row.querySelectorAll("button")].filter(
            (b) => b.getAttribute("title") === "বিল প্রিন্ট"
          ).length
        : 0,
    };
  }, UI_GROUP);
  await page.evaluate((name) => {
    const row = [
      ...document.querySelectorAll(
        '[data-testid="dues-dialog"] [data-testid^="due-visit-"]:not([data-testid^="due-visit-card-"])'
      ),
    ].find((el) => el.textContent?.includes(name));
    row?.querySelector('button[title="বিল প্রিন্ট"]')?.click();
  }, UI_GROUP);
  await page.waitForFunction(
    () => !!document.querySelector('[role="dialog"] [data-receipt-group]'),
    { polling: 100, timeout: 15000 }
  );
  const duesSlip = await page.evaluate(() => {
    const text =
      document.querySelector('[role="dialog"] [data-receipt-group]')
        ?.textContent || "";
    return {
      text,
      hasBillList: text.includes(", #"),
    };
  });
  await closeDialog(page);
  check(
    "F19",
    "dues list: one row per visit, summed money, one receipt button",
    duesRow.rows === 1 &&
      duesRow.devices === 2 &&
      duesRow.receipts === 1 &&
      duesRow.text.includes("UI Primary") &&
      duesRow.text.includes("UI Secondary") &&
      duesRow.text.includes("2,300") &&
      duesRow.text.includes("1,800") &&
      duesRow.text.includes("2টি ডিভাইসের মোট") &&
      !duesSlip.hasBillList &&
      duesSlip.text.includes("UI Primary") &&
      duesSlip.text.includes("UI Secondary"),
    JSON.stringify({
      rows: duesRow.rows,
      devices: duesRow.devices,
      receipts: duesRow.receipts,
      hasBillList: duesSlip.hasBillList,
    })
  );

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
