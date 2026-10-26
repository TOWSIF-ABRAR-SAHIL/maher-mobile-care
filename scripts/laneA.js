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
const TITLE_YESTERDAY = YESTERDAY;
const TITLE_TODAY = TODAY;
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

  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
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
      partsShop: "LaneA Parts Shop",
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
  // A programmatic option click can leave Radix's portal open; the first
  // outside click would then only dismiss it instead of reaching the form.
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 150));
  await typeInto(page,"svc-bill", "১০০০"); // Bengali digits
  await typeInto(page,"svc-adv", "300");
  await typeInto(page,"svc-expense", "*B#");
  await typeInto(page,"svc-parts-shop", "LaneA Parts Shop");
  const dueShown = await page.$eval("#svc-due", (el) => el.value);
  check("A1a", "due auto-calc live", dueShown === "700", dueShown);
  const badge = await page.$eval("#svc-expense-help", (el) => el.textContent || "");
  const hasPeekButton = (await page.$('[data-testid="expense-reveal"]')) !== null;
  check(
    "A1b",
    "form preview shows the code and its real amount directly",
    badge.includes("গোপন কোড") &&
      badge.includes("*B#") &&
      badge.includes("৳১২০০") &&
      !badge.includes("৳••••") &&
      !hasPeekButton,
    JSON.stringify({ badge, hasPeekButton })
  );
  await submitButton(page,"সেভ করুন");
  await waitDailyRow(page, NAME, true);
  const created = (await apiDay(TODAY)).find(
    (s) => s.customerName === NAME
  );
  console.log("reached A1-submit");
  check(
    "A1c",
    "entry saved (bill 1000/adv 300/due 700, RONI, code expense 1200 + parts shop)",
    created &&
      created.totalBill === 1000 &&
      created.advance === 300 &&
      created.due === 700 &&
      created.technician === "RONI" &&
      created.shopExpense === "*B#" &&
      created.expenseAmount === 1200 &&
      created.partsShop === "LaneA Parts Shop",
    JSON.stringify(
      created && {
        b: created.totalBill,
        a: created.advance,
        d: created.due,
        t: created.technician,
        raw: created.shopExpense,
        e: created.expenseAmount,
        shop: created.partsShop,
      }
    )
  );
  check("A1d", "row count +1", (await rowCount()) === before + 1);

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

  // ---- A3: due calc, cash/change calculator removed, overpay guard ----
  await typeInto(page,"svc-bill", "2000");
  await typeInto(page,"svc-adv", "500");
  await new Promise((r) => setTimeout(r, 300));
  check("A3a", "due stays bill - advance (1500)", (await page.$eval("#svc-due", (el) => el.value)) === "1,500");
  check(
    "A3b",
    "cash-received field and hint removed",
    (await page.$("#svc-cash")) === null &&
      !(await page.evaluate(() =>
        document.body.textContent.includes("কাস্টমারের কাছ থেকে পাওয়া টাকা")
      ))
  );
  check(
    "A3c",
    "change-return field removed",
    (await page.$("#svc-change")) === null &&
      !(await page.evaluate(() =>
        document.body.textContent.includes("ফেরত দেওয়ার টাকা")
      ))
  );
  // Overpay validation is independent: advance above the bill is rejected.
  await typeInto(page,"svc-adv", "2500");
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

  // ---- A6: always-visible code column + per-row eye ----
  const createdId = created?.id;
  const globalToggle = await page.$('[data-testid="expense-toggle"]');
  const kh0 = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="daily-services"]');
    if (!table) return { h: false, rows: [] };
    const headers = [...table.querySelectorAll("thead th")];
    const idx = headers.findIndex((th) => th.textContent.includes("খরচ"));
    return {
      h: idx !== -1,
      rows: [...table.querySelectorAll("tbody tr")].map((tr) => ({
        id: tr.children[0]?.textContent?.trim() || "",
        cost: tr.children[idx]?.textContent || "",
      })),
    };
  });
  const createdCost =
    kh0.rows.find((r) => r.id === String(createdId))?.cost || "";
  const referenceCost =
    kh0.rows.find((r) => r.id === String(seedId))?.cost || "";
  const beforeReveal = await page.evaluate(
    (id) => !!document.querySelector(`[data-testid="expense-amount-${id}"]`),
    createdId
  );
  await page.click(`[data-testid="expense-reveal-${createdId}"]`);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-testid="expense-amount-${id}"]`)
        ?.textContent?.includes("1,200"),
    { polling: 100, timeout: 3000 },
    createdId
  );
  const revealed = await page.evaluate(
    (id, refId) => ({
      amount:
        document.querySelector(`[data-testid="expense-amount-${id}"]`)
          ?.textContent || "",
      otherRevealed: !!document.querySelector(
        `[data-testid="expense-amount-${refId}"]`
      ),
    }),
    createdId,
    seedId
  );

  // Universal eye: one click shows every row, the next click hides every row.
  await page.click('[data-testid="expense-toggle"]');
  await page.waitForFunction(
    (a, b) =>
      !!document.querySelector(`[data-testid="expense-amount-${a}"]`) &&
      !!document.querySelector(`[data-testid="expense-amount-${b}"]`),
    { polling: 100, timeout: 3000 },
    createdId,
    seedId
  );
  const universalOn = await page.evaluate(
    (id, refId) => ({
      created:
        document.querySelector(`[data-testid="expense-amount-${id}"]`)
          ?.textContent || "",
      reference:
        document.querySelector(`[data-testid="expense-amount-${refId}"]`)
          ?.textContent || "",
      pressed:
        document
          .querySelector('[data-testid="expense-toggle"]')
          ?.getAttribute("aria-pressed") || "",
    }),
    createdId,
    seedId
  );
  await page.click('[data-testid="expense-toggle"]');
  await page.waitForFunction(
    (a, b) =>
      !document.querySelector(`[data-testid="expense-amount-${a}"]`) &&
      !document.querySelector(`[data-testid="expense-amount-${b}"]`),
    { polling: 100, timeout: 3000 },
    createdId,
    seedId
  );

  // Per-row eye auto-hides after 10 seconds (no universal timer involved).
  await page.click(`[data-testid="expense-reveal-${createdId}"]`);
  await page.waitForFunction(
    (id) => !!document.querySelector(`[data-testid="expense-amount-${id}"]`),
    { polling: 100, timeout: 3000 },
    createdId
  );
  await page.waitForFunction(
    (id) => !document.querySelector(`[data-testid="expense-amount-${id}"]`),
    { polling: 250, timeout: 14000 },
    createdId
  );
  const autoHidden = true;
  await page.click(`[data-testid="expense-reveal-${seedId}"]`);
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`[data-testid="expense-amount-${id}"]`)
        ?.textContent?.includes("1,500"),
    { polling: 100, timeout: 3000 },
    seedId
  );
  const referenceAmount = await page.evaluate(
    (id) =>
      document.querySelector(`[data-testid="expense-amount-${id}"]`)
        ?.textContent || "",
    seedId
  );
  check(
    "A6",
    "codes stay visible; universal eye toggles all rows; per-row eye auto-hides",
    !!globalToggle &&
      kh0.h &&
      createdCost.includes("*B#") &&
      createdCost.includes("LaneA Parts Shop") &&
      !createdCost.includes("1,200") &&
      referenceCost.includes("*J#") &&
      !referenceCost.includes("1,500") &&
      !referenceCost.includes("৳••••") &&
      !beforeReveal &&
      revealed.amount.includes("1,200") &&
      !revealed.otherRevealed &&
      universalOn.created.includes("1,200") &&
      universalOn.reference.includes("1,500") &&
      universalOn.pressed === "true" &&
      autoHidden &&
      referenceAmount.includes("1,500"),
    JSON.stringify({
      globalToggle: !!globalToggle,
      h: kh0.h,
      createdCost,
      referenceCost,
      beforeReveal,
      revealed,
      universalOn,
      autoHidden,
      referenceAmount,
    })
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
    [...document.querySelectorAll('[data-testid="service-date-nav"] button')]
      .find((b) => b.textContent.includes("আগের দিন"))
      .click()
  );
  await page.waitForFunction(
    (title) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === title,
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
    (title) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === title,
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
    [...document.querySelectorAll('[data-testid="service-date-nav"] button')]
      .find((b) => b.textContent.includes("পরের দিন"))
      .click()
  );
  await page.waitForFunction(
    (title) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === title,
    { polling: 500, timeout: 8000 },
    TITLE_TODAY
  );
  await new Promise((r) => setTimeout(r, 1000));
  const rowActions = await page.evaluate((rowName) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const row = [...section.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent.includes(rowName)
    );
    const wa = row?.querySelector('a[title="WhatsApp (chat/call)"]');
    const pdf = row?.querySelector('button[title="PDF শেয়ার"]');
    let message = "";
    try {
      message = decodeURIComponent(
        new URL(wa.getAttribute("href")).searchParams.get("text") || ""
      );
    } catch {
      /* leave blank */
    }
    return {
      waHref: wa?.getAttribute("href") || "",
      waTarget: wa?.getAttribute("target") || "",
      waMessage: message,
      pdf: !!pdf,
      pdfDisabled: pdf ? pdf.disabled : null,
    };
  }, REF);
  check(
    "A10a",
    "daily WhatsApp action opens customer chat with due message",
    rowActions.waHref.startsWith("https://wa.me/8801700000009") &&
      rowActions.waTarget === "_blank" &&
      rowActions.waMessage.includes("বাকি আছে"),
    JSON.stringify(rowActions)
  );
  check(
    "A10b",
    "daily PDF share action is available",
    rowActions.pdf && rowActions.pdfDisabled === false,
    JSON.stringify(rowActions)
  );
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
      noPartsShop: !d.includes("LaneA Parts Shop"),
    };
  });
  console.log("reached A10");
  check(
    "A10",
    "receipt preview (no cost or parts-shop leak)",
    rc.bill && rc.tech && rc.noCost && rc.noPartsShop,
    JSON.stringify(rc)
  );

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
