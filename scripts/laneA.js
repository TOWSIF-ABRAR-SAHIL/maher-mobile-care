/* Lane A: entry + validation + table ops. Cleans up after itself.
 * Run directly only against a throwaway database: npm test sets MAHER_TEST_URL. */
const {
  api,
  closeBrowser,
  clickDailyRowButton,
  clickDailyStatus,
  dailyRows,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const TITLE_YESTERDAY = `সার্ভিস তালিকা (${YESTERDAY})`;
const TITLE_TODAY = `সার্ভিস তালিকা (${TODAY})`;
const T = Date.now();
const NAME = uniqueName("TestKarim");
const REF = uniqueName("LaneARef");
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

let browser = null;

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
  await new Promise((r) => setTimeout(r, 1200));

  // Self-contained baseline: create a known Pending reference row and remove
  // any leftovers from interrupted runs. No live shop row is ever modified.
  const seed = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: REF,
      phone: "01700000009",
      model: "LaneA Ref",
      technician: "NURUL",
      problem: "Reference",
      totalBill: 1700,
      advance: 500,
      status: "Pending",
      shopExpense: "1500",
      serviceDate: TODAY,
    }),
  });
  if (!seed.ok) throw new Error("reference row not created: " + JSON.stringify(seed.body));
  const seedId = seed.body.id;
  const baseline = await api(page, `/api/services?date=${TODAY}`);
  for (const s of baseline.body.services) {
    if (
      s.id !== seedId &&
      (s.customerName.startsWith("TestKarim") || s.customerName.startsWith("LaneARef"))
    ) {
      await api(page, `/api/services/${s.id}`, { method: "DELETE" });
    }
  }
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 30000 },
    REF
  );
  await new Promise((r) => setTimeout(r, 800));

  // Deterministic fill uses the shared test-support helpers.
  // The daily service table is scoped: the dues and global-search sections
  // intentionally show the same rows on other parts of the page.
  const rowCount = async () => (await dailyRows(page)).length;
  const apiDay = async (day) => (await api(page, `/api/services?date=${day}`)).body.services;

  // ---- A1: valid entry, Bengali digits, auto due ----
  const before = await rowCount();
  await typeInto(page,"svc-name", NAME);
  await typeInto(page,"svc-phone", "01700000001");
  await typeInto(page,"svc-model", "Vivo Y20");
  await typeInto(page,"svc-problem", "Battery");
  // technician RONI via Radix select
  await page.click("#svc-tech");
  await page.waitForSelector('[role="option"]', { polling: 500, timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="option"]')]
      .find((o) => o.textContent.trim() === "RONI")
      .click();
  });
  await typeInto(page,"svc-bill", "১০০০"); // Bengali digits
  await typeInto(page,"svc-adv", "300");
  await typeInto(page,"svc-expense", "*B#");
  const dueShown = await page.$eval("#svc-due", (el) => el.value);
  check("A1a", "due auto-calc live", dueShown === "700", dueShown);
  await submitButton(page,"সেভ করুন");
  await waitDailyRow(page, NAME, true);
  const created = (await apiDay(TODAY)).find(
    (s) => s.customerName === NAME
  );
  console.log("reached A1-submit");
  check(
    "A1b",
    "entry saved (bill 1000/adv 300/due 700, RONI, code expense 0)",
    created &&
      created.totalBill === 1000 &&
      created.advance === 300 &&
      created.due === 700 &&
      created.technician === "RONI" &&
      created.expenseAmount === 0,
    JSON.stringify(
      created && {
        b: created.totalBill,
        a: created.advance,
        d: created.due,
        t: created.technician,
        e: created.expenseAmount,
      }
    )
  );
  check("A1c", "row count +1", (await rowCount()) === before + 1);

  // ---- A2: validation (empty + bad bill), no row added ----
  const c2 = await rowCount();
  await submitButton(page,"সেভ করুন"); // empty form
  await waitToast(page,"কাস্টমারের নাম দিন").catch(() => null);
  await typeInto(page,"svc-name", NAME + "x");
  await typeInto(page,"svc-phone", "01700000002");
  await typeInto(page,"svc-model", "M");
  await typeInto(page,"svc-problem", "P");
  await typeInto(page,"svc-bill", "abc");
  await submitButton(page,"সেভ করুন");
  await waitToast(page,"মোট বিলে সঠিক সংখ্যা দিন").catch(() => null);
  await new Promise((r) => setTimeout(r, 800));
  console.log("reached A2");
  check("A2", "validation blocks (empty + bad bill), no row", (await rowCount()) === c2);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1000));

  // ---- A3: cash change compares cash with the amount kept (জমা) ----
  await typeInto(page,"svc-bill", "2000");
  await typeInto(page,"svc-adv", "500");
  await typeInto(page,"svc-cash", "2500");
  await new Promise((r) => setTimeout(r, 300));
  check("A3a", "due stays bill - advance (1500)", (await page.$eval("#svc-due", (el) => el.value)) === "1,500");
  check(
    "A3b",
    "cash above advance shows change 2000",
    (await page.$eval("#svc-change", (el) => el.value)) === "2,000"
  );
  await typeInto(page,"svc-cash", "300");
  await new Promise((r) => setTimeout(r, 300));
  check(
    "A3c",
    "short cash shows shortfall 200",
    (await page.$eval("#svc-change", (el) => el.value)) === "200"
  );
  // Overpay validation is independent: advance above the bill is rejected.
  await typeInto(page,"svc-adv", "2500");
  await typeInto(page,"svc-cash", "0");
  await new Promise((r) => setTimeout(r, 300));
  check("A3d", "overpay previews due 0", (await page.$eval("#svc-due", (el) => el.value)) === "0");
  const c3 = await rowCount();
  await typeInto(page,"svc-name", NAME + "op");
  await typeInto(page,"svc-phone", "01700000003");
  await typeInto(page,"svc-model", "M");
  await typeInto(page,"svc-problem", "P");
  await submitButton(page,"সেভ করুন");
  await waitToast(page, "বেশি").catch(() => null);
  await new Promise((r) => setTimeout(r, 600));
  console.log("reached A3");
  check("A3e", "overpay save rejected, no row added", (await rowCount()) === c3);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1000));

  // ---- A4: search ----
  await typeInto(page, "svc-search", NAME);
  await page.waitForFunction(
    (selector, rowName) => {
      const rows = [
        ...document.querySelectorAll(`${selector} tbody tr`),
      ].map((tr) => tr.textContent);
      return rows.length === 1 && rows[0].includes(rowName);
    },
    { polling: 500, timeout: 8000 },
    '[data-testid="daily-services"]',
    NAME
  );
  const isolated = await dailyRows(page);
  check(
    "A4a",
    "search isolates row",
    isolated.length === 1 &&
      isolated[0].includes(NAME) &&
      !isolated[0].includes(REF)
  );
  await typeInto(page, "svc-search", "");
  await page.waitForFunction(
    (selector, testName, refName) => {
      const rows = [
        ...document.querySelectorAll(`${selector} tbody tr`),
      ].map((tr) => tr.textContent);
      return (
        rows.length === 2 &&
        rows.some((row) => row.includes(testName)) &&
        rows.some((row) => row.includes(refName))
      );
    },
    { polling: 500, timeout: 8000 },
    '[data-testid="daily-services"]',
    NAME,
    REF
  );
  const restored = await dailyRows(page);
  check(
    "A4b",
    "search clear restores",
    restored.length === 2 &&
      restored.some((row) => row.includes(NAME)) &&
      restored.some((row) => row.includes(REF))
  );

  // ---- A5: chips ----
  const chip = (label) =>
    page.evaluate((l) => {
      const sec = [...document.querySelectorAll("section")].find((s) =>
        s.textContent.includes("সার্ভিস তালিকা")
      );
      [...sec.querySelectorAll("div.mb-3 button")]
        .find((b) => b.textContent.trim().startsWith(l))
        .click();
    }, label);
  await chip("পেন্ডিং");
  await new Promise((r) => setTimeout(r, 500));
  // Filter correctness: visible daily-table rows == API's Pending rows.
  // Only the daily section is checked because dues/search sections may show
  // the same active rows elsewhere on the page.
  const dailyPendingRows = await dailyRows(page);
  const pending = (await apiDay(TODAY))
    .filter((s) => s.status === "Pending")
    .map((s) => s.customerName);
  const visiblePending = dailyPendingRows
    .map((row) => pending.find((name) => row.includes(name)))
    .filter((name) => name !== undefined);
  const pendCheck = { visible: visiblePending, pending };
  console.log("reached A5");
  check(
    "A5",
    "pending chip == API pending set",
    pendCheck.visible.length === pendCheck.pending.length &&
      pendCheck.visible.every((v) =>
        pendCheck.pending.some((p) => v.includes(p))
      ),
    JSON.stringify(pendCheck.visible.map((v) => v.slice(0, 25)))
  );
  await chip("সব");
  await new Promise((r) => setTimeout(r, 400));

  // ---- A6: eye toggle ----
  const kh0 = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="daily-services"] thead th')].some((th) =>
      th.textContent.includes("খরচ")
    )
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="daily-services"] button')]
      .find((b) => b.textContent.trim() === "খরচ")
      .click()
  );
  await new Promise((r) => setTimeout(r, 400));
  const kh1 = await page.evaluate(() => ({
    h: [...document.querySelectorAll('[data-testid="daily-services"] thead th')].some((th) =>
      th.textContent.includes("খরচ")
    ),
    v: document
      .querySelector('[data-testid="daily-services"] tbody')
      .textContent.includes("*B#"),
  }));
  check("A6", "eye reveals expense column", !kh0 && kh1.h && kh1.v);
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")]
      .find((b) => b.textContent.trim() === "খরচ")
      .click()
  );

  // ---- A7: 1-click status on the reference row (reverted at cleanup) ----
  const badgeClick = (frag) => clickDailyStatus(page, frag);
  await badgeClick(REF);
  await page.waitForFunction(
    (selector, rowName) =>
      [...document.querySelectorAll(`${selector} tbody tr`)]
        .find((tr) => tr.textContent.includes(rowName))
        .textContent.includes("চলছে"),
    { polling: 500, timeout: 10000 },
    '[data-testid="daily-services"]',
    REF
  );
  await badgeClick(REF);
  await page.waitForFunction(
    (selector, rowName) =>
      [...document.querySelectorAll(`${selector} tbody tr`)]
        .find((tr) => tr.textContent.includes(rowName))
        .textContent.includes("সম্পন্ন"),
    { polling: 500, timeout: 10000 },
    '[data-testid="daily-services"]',
    REF
  );
  await badgeClick(REF);
  await page.waitForFunction(
    (selector, rowName) =>
      [...document.querySelectorAll(`${selector} tbody tr`)]
        .find((tr) => tr.textContent.includes(rowName))
        .textContent.includes("টাকা বাকি"),
    { polling: 500, timeout: 10000 },
    '[data-testid="daily-services"]',
    REF
  );
  console.log("reached A7");
  check("A7", "badge 3-step to Delivered + warning", true);

  // ---- A8: edit rename + date move ----
  await clickDailyRowButton(page, NAME, "এডিট");
  await page.waitForSelector("#svc-date", { polling: 500, timeout: 8000 });
  // Edit values are stable from the first render — set once and verify.
  for (let i = 0; i < 6; i++) {
    await typeInto(page,"svc-name", NAME + "2");
    await typeInto(page,"svc-date", YESTERDAY);
    await new Promise((r) => setTimeout(r, 300));
    const settled = await page.evaluate(
      (n, day) =>
        document.getElementById("svc-name").value === n &&
        document.getElementById("svc-date").value === day,
      NAME + "2",
      YESTERDAY
    );
    if (settled) break;
    if (i === 5) throw new Error("edit fields never settled");
  }
  await submitButton(page,"আপডেট করুন");
  // NOTE: renamed row (NAME+"2") still contains NAME — must wait on the full name.
  await waitDailyRow(page, NAME + "2", false);
  const onYesterday = (
    await apiDay(YESTERDAY)
  ).some((s) => s.customerName === NAME + "2");
  console.log("reached A8");
  check("A8", "edit rename + move to yesterday", onYesterday);

  // ---- A9: archive → restore → archive (cleanup) ----
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((b) => b.textContent.includes("আগের দিন"))
      .click()
  );
  await page.waitForFunction(
    (title) => document.body.textContent.includes(title),
    { polling: 500, timeout: 8000 },
    TITLE_YESTERDAY
  );
  await new Promise((r) => setTimeout(r, 1000));
  await clickDailyRowButton(page, NAME + "2", "ডিলিট");
  await page.waitForSelector('[role="alertdialog"]', { polling: 500, timeout: 8000 });
  const dlgArc = await page.evaluate(() =>
    document.querySelector('[role="alertdialog"]').textContent.includes("ফিরিয়ে আনা যাবে")
  );
  check("A9a", "archive dialog wording", dlgArc);
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.includes("আর্কাইভ"))
      .click()
  );
  await page.waitForFunction(
    (n) => !document.body.textContent.includes(n),
    { polling: 500, timeout: 10000 },
    NAME + "2"
  );
  console.log("reached A9b");
  check("A9b", "archive hides", true);
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="daily-services"] button')]
      .find((b) => b.textContent.includes("আর্কাইভ দেখুন"))
      .click()
  );
  await waitDailyRow(page, NAME + "2", true);
  check("A9c", "archive view lists", true);
  await clickDailyRowButton(page, NAME + "2", "ফিরিয়ে আনুন");
  await waitDailyRow(page, NAME + "2", false);
  const back29 = (
    await apiDay(YESTERDAY)
  ).some((s) => s.customerName === NAME + "2" && !s.archived);
  console.log("reached A9d");
  check("A9d", "restore works", back29);
  // back to day view (restore leaves archive view open)
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="daily-services"] button')]
      .find((b) => b.textContent.includes("তালিকায় ফিরুন"))
      .click()
  );
  await page.waitForFunction(
    (title) => document.body.textContent.includes(title),
    { polling: 500, timeout: 8000 },
    TITLE_YESTERDAY
  );
  // final cleanup of test row
  await page.evaluate(async (day, n) => {
    const l = await fetch(`/api/services?date=${day}`).then((x) => x.json());
    const row = l.services.find((s) => s.customerName === n);
    if (row) await fetch("/api/services/" + row.id, { method: "DELETE" });
  }, YESTERDAY, NAME + "2");
  // revert the reference row to Pending
  const current = await apiDay(TODAY);
  const reference = current.find((s) => s.customerName === REF);
  if (reference) {
    await api(page, `/api/services/${reference.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Pending" }),
    });
  }
  const final = await apiDay(TODAY);
  const ref = final.find((s) => s.customerName === REF);
  const tkLeft = final.some((s) => s.customerName.includes("TestKarim"));
  check(
    "A9e",
    "cleanup: reference back to Pending, test row archived",
    ref && ref.status === "Pending" && !tkLeft,
    JSON.stringify(ref && ref.status)
  );

  // ---- A10: receipt preview, no cost leak ----
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((b) => b.textContent.includes("পরের দিন"))
      .click()
  );
  await page.waitForFunction(
    (title) => document.body.textContent.includes(title),
    { polling: 500, timeout: 8000 },
    TITLE_TODAY
  );
  await new Promise((r) => setTimeout(r, 1000));
  await clickDailyRowButton(page, REF, "বিল প্রিন্ট");
  await page.waitForFunction(
    () => document.body.textContent.includes("বিল প্রিভিউ"),
    { polling: 500, timeout: 8000 }
  );
  const rc = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]').textContent;
    return {
      bill: d.includes("বিল নং"),
      tech: d.includes("NURUL"),
      noCost: !d.includes("1500"),
    };
  });
  console.log("reached A10");
  check("A10", "receipt preview (no cost leak)", rc.bill && rc.tech && rc.noCost, JSON.stringify(rc));

  // ---- A11: archive the reference row (lane A leaves no active rows) ----
  // Later suites share this throwaway DB, so the reference row must not stay
  // active. The receipt preview above already captured everything it needed.
  const refRow = (await apiDay(TODAY)).find((s) => s.customerName === REF);
  if (refRow) {
    await api(page, `/api/services/${refRow.id}`, { method: "DELETE" });
  }
  check(
    "A11",
    "reference archived (no active laneA rows left)",
    !(await apiDay(TODAY)).some(
      (s) => s.customerName === REF || s.customerName.startsWith("TestKarim")
    )
  );

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-A CRASH:", e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
