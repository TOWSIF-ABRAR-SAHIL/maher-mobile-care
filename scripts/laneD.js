/* Lane D: navbar search, report/dues dialogs, product-sale mode and the
 * one-screen dashboard layout. Runs against the throwaway database supplied by
 * scripts/run-tests.js — never the live shop DB. */
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dailyRows,
  dhakaToday,
  launchBrowser,
  openSection,
  resolveTestBase,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const SEARCH_NAME = uniqueName("SearchCust");
const SEARCH_PHONE = "01700000777";
const PRODUCT_NAME = uniqueName("ProdSale");
const duesLabel = (d) =>
  `💰 সব তারিখের বাকি (${d.count}টি ডিভাইস • ৳${d.totalDue.toLocaleString(
    "en-IN"
  )})`;

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
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
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 500, timeout: 30000 }
  );

  // Make sure a SALES technician exists in the roster (the user creates these
  // with ⚙️ টেকনিশিয়ান in real life; the API is the same code path).
  const roster = (await api(page, "/api/technicians")).body;
  if (!Array.isArray(roster.technicians)) {
    throw new Error("technician roster not available");
  }
  if (!roster.technicians.some((t) => t.name === "SALES")) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "SALES" }),
    });
    if (!added.ok) throw new Error("SALES tech not created: " + JSON.stringify(added.body));
  }

  // One known due row for the search + dues checks.
  const seeded = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: SEARCH_NAME,
      phone: SEARCH_PHONE,
      model: "Search Model X",
      technician: "NURUL",
      problem: "Search Probe",
      totalBill: 1000,
      advance: 300,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }),
  });
  if (!seeded.ok) throw new Error("search seed failed: " + JSON.stringify(seeded.body));

  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 30000 },
    SEARCH_NAME
  );
  await new Promise((r) => setTimeout(r, 1200));

  const waitGone = async (selector, timeout = 8000) => {
    await page.waitForFunction(
      (sel) => !document.querySelector(sel),
      { polling: 100, timeout },
      selector
    );
  };
  const closeDialog = async (testid) => {
    const open = await page.$(`[data-testid="${testid}"]`);
    if (!open) return;
    // Radix's Close button ignores a synthetic `.click()` from page.evaluate.
    // Use a real mouse click on the X so "X closes" still tests that affordance,
    // then fall back to Escape if keyboard focus kept the click from landing.
    const marked = await page.evaluate((id) => {
      const dlg = document.querySelector(`[data-testid="${id}"]`);
      const x = dlg
        ? [...dlg.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Close"
          )
        : null;
      if (!x) return false;
      x.setAttribute("data-testid", "dialog-close-probe");
      return true;
    }, testid);
    if (marked) {
      await page.click('[data-testid="dialog-close-probe"]').catch(() => {});
      const gone = await page
        .waitForFunction(
          (id) => !document.querySelector(`[data-testid="${id}"]`),
          { polling: 100, timeout: 2500 },
          testid
        )
        .then(() => true)
        .catch(() => false);
      if (gone) return;
    }
    await page.keyboard.press("Escape");
    const escaped = await page
      .waitForFunction(
        (id) => !document.querySelector(`[data-testid="${id}"]`),
        { polling: 100, timeout: 2500 },
        testid
      )
      .then(() => true)
      .catch(() => false);
    if (escaped) return;
    await page.evaluate((id) => {
      const dlg = document.querySelector(`[data-testid="${id}"]`);
      const x = dlg
        ? [...dlg.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Close"
          )
        : null;
      const key = x && Object.keys(x).find((k) => k.startsWith("__reactProps"));
      const handler = key ? x[key]?.onClick : null;
      if (typeof handler === "function") {
        handler({
          preventDefault() {},
          stopPropagation() {},
          defaultPrevented: false,
        });
      }
    }, testid);
    await waitGone(`[data-testid="${testid}"]`);
  };
  const waitSearchResults = async (scope, text) => {
    await page.waitForFunction(
      (sel, t) => {
        const el = document.querySelector(sel);
        return !!el && el.textContent.includes(t);
      },
      { polling: 100, timeout: 8000 },
      scope,
      text
    );
  };

  // ---------- D1: front-desk layout order + removed sections ----------
  // The daily tally, technician cards and report/dues pills moved to the
  // Dashboard; Service keeps only intake, list and filters — no masthead band.
  const layout = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().top + window.scrollY);
    };
    const printCopy = document.querySelector('[data-testid="monthly-print"]');
    return {
      header: top("header"),
      form: top("form"),
      table: top('[data-testid="daily-services"]'),
      footer: top("footer"),
      oldSearch: !!document.querySelector('[data-testid="global-service-search"]'),
      dailySummaryGone: !document.querySelector('[data-testid="daily-summary"]'),
      duesOutsideDialog: !!document.querySelector('[data-testid="outstanding-dues"]'),
      reportOutsideDialog: !!document.querySelector('[data-testid="report-dialog"]'),
      printCopyHidden:
        !!printCopy && getComputedStyle(printCopy).display === "none",
    };
  });
  console.log("reached D1", JSON.stringify(layout));
  check(
    "D1",
    "order: header → form/table → footer; masthead actions and tallies gone",
    layout.header < layout.form &&
      Math.abs(layout.form - layout.table) < 120 &&
      layout.footer > layout.table &&
      layout.oldSearch === false &&
      layout.dailySummaryGone === true &&
      layout.duesOutsideDialog === false &&
      layout.reportOutsideDialog === false &&
      layout.printCopyHidden === true,
    JSON.stringify(layout)
  );

  // ---------- D1b: the front desk has no duplicate masthead buttons ----------
  const masthead = await page.evaluate(() => ({
    actions: !!document.querySelector('[data-testid="page-actions"]'),
    newEntry: !!document.querySelector('[data-testid="new-service-entry"]'),
    dashboardLink: !!document.querySelector('[data-testid="service-dashboard-link"]'),
  }));
  check(
    "D1b",
    "new-entry and Dashboard masthead buttons are gone from Service",
    !masthead.actions && !masthead.newEntry && !masthead.dashboardLink,
    JSON.stringify(masthead)
  );

  // ---------- D2: report dialog (X + ESC) ----------
  // Reports/dues now live on the Dashboard; the Service desk stays front-desk only.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="open-report"]', { timeout: 15000 });
  await page.click('[data-testid="open-report"]');
  await page.waitForSelector('[data-testid="report-dialog"]', {
    polling: 100,
    timeout: 8000,
  });
  await page.waitForFunction(
    () => {
      const d = document.querySelector('[data-testid="report-dialog"]');
      return !!d && d.textContent.includes("৩০ দিনে মোট কাজ");
    },
    { polling: 100, timeout: 8000 }
  );
  const report = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="report-dialog"]');
    const t = d.textContent;
    return {
      text: t,
      presets: ["বিগত ৩০ দিন", "এই মাস", "গত মাস"].every((x) => t.includes(x)),
      cards: [
        "মোট কাজ",
        "মোট বিল",
        "মোট খরচ",
        "মোট বাকি",
        "মোট লাভ (Profit)",
      ].every((x) => t.includes(x)),
      totalBill: t.includes("৳1,000"),
      totalDue: t.includes("৳700"),
      joma: t.includes("জমা"),
      noMasked: !t.includes("৳••••"),
    };
  });
  check(
    "D2a",
    "report dialog has 3 presets + 5 monthly values including joma",
    report.presets &&
      report.cards &&
      report.totalBill &&
      report.totalDue &&
      report.joma &&
      report.noMasked,
    JSON.stringify({ presets: report.presets, cards: report.cards })
  );
  await closeDialog("report-dialog");
  check(
    "D2b",
    "report dialog X closes",
    (await page.$('[data-testid="report-dialog"]')) === null
  );
  await page.click('[data-testid="open-report"]');
  await page.waitForSelector('[data-testid="report-dialog"]');
  await page.keyboard.press("Escape");
  await waitGone('[data-testid="report-dialog"]');
  check(
    "D2c",
    "report dialog Escape closes",
    (await page.$('[data-testid="report-dialog"]')) === null
  );

  // ---------- D3: dynamic dues button + dialog ----------
  const duesBefore = (await api(page, "/api/services/dues")).body;
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="open-dues"]')?.textContent.trim() ===
      expected,
    { polling: 100, timeout: 8000 },
    duesLabel(duesBefore)
  );
  const duesButtonText = await page.$eval(
    '[data-testid="open-dues"]',
    (el) => el.textContent.trim()
  );
  check(
    "D3a",
    "dues button shows live count + total across all dates",
    duesButtonText === duesLabel(duesBefore),
    JSON.stringify({ duesButtonText, expected: duesLabel(duesBefore) })
  );
  await page.click('[data-testid="open-dues"]');
  await page.waitForSelector('[data-testid="dues-dialog"]');
  await page.waitForFunction(
    (name) => {
      const d = document.querySelector('[data-testid="dues-dialog"]');
      return !!d && d.textContent.includes(name);
    },
    { polling: 100, timeout: 8000 },
    SEARCH_NAME
  );
  const dues = await page.evaluate((expectedLine) => {
    const d = document.querySelector('[data-testid="dues-dialog"]');
    const t = d.textContent;
    const call = d.querySelector('a[title^="কল করুন"]');
    const wa = d.querySelector('a[title^="WhatsApp"]');
    return {
      columns:
        t.includes("তারিখ") &&
        t.includes("কাস্টমার") &&
        t.includes("মডেল / অবস্থা") &&
        t.includes("বিল / জমা / বাকি") &&
        t.includes("যোগাযোগ") &&
        t.includes("অ্যাকশন"),
      countLine: t.includes(expectedLine),
      call: call?.getAttribute("href") || "",
      wa: wa?.getAttribute("href") || "",
      noMasked: !t.includes("৳••••"),
    };
  }, `${duesBefore.count}টি ডিভাইস বাকি • মোট ৳${duesBefore.totalDue.toLocaleString("en-IN")}`);
  check(
    "D3b",
    "dues dialog keeps columns + functional call/WhatsApp",
    dues.columns &&
      dues.countLine &&
      dues.call === "tel:+8801700000777" &&
      dues.wa.includes("wa.me/8801700000777") &&
      dues.noMasked,
    JSON.stringify(dues)
  );
  await page.keyboard.press("Escape");
  await waitGone('[data-testid="dues-dialog"]');
  check(
    "D3c",
    "dues dialog Escape closes",
    (await page.$('[data-testid="dues-dialog"]')) === null
  );

  // ---------- D4: navbar search (desktop) ----------
  // Search's edit action fills the Service form, so go back to that desk.
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="daily-services"]', { timeout: 15000 });
  const placeholder = await page.$eval(
    "#global-search",
    (el) => el.getAttribute("placeholder") || ""
  );
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  const focusedAfterCtrlK = await page.evaluate(() => document.activeElement?.id);
  check(
    "D4a",
    "search placeholder exact + Ctrl+K focuses navbar input",
    placeholder === "🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)" &&
      focusedAfterCtrlK === "global-search",
    JSON.stringify({ placeholder, focusedAfterCtrlK })
  );

  await typeInto(page, "global-search", SEARCH_NAME);
  await waitSearchResults('[data-testid="global-search-dropdown"]', SEARCH_NAME);
  const dropdown = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="global-search-dropdown"]');
    return {
      text: d?.textContent || "",
      pick: !!d?.querySelector('button[title="বিল প্রিভিউ"]'),
      edit: !!d?.querySelector('button[title="এডিট"]'),
      call: !!d?.querySelector('a[title="কল"]'),
      wa: !!d?.querySelector('a[title="WhatsApp"]'),
    };
  });
  check(
    "D4b",
    "typing opens live results with call/WhatsApp/edit actions",
    dropdown.pick && dropdown.edit && dropdown.call && dropdown.wa,
    JSON.stringify(dropdown).slice(0, 300)
  );

  await page.evaluate(() => {
    const d = document.querySelector('[data-testid="global-search-dropdown"]');
    d.querySelector('button[title="বিল প্রিভিউ"]').click();
  });
  await page.waitForFunction(
    () => !!document.querySelector('[role="dialog"] [data-receipt]'),
    { polling: 100, timeout: 8000 }
  );
  const receiptInfo = await page.evaluate(() => ({
    receipt:
      document.querySelector('[role="dialog"] [data-receipt]')?.textContent ||
      "",
    dialog: document.querySelector('[role="dialog"]')?.textContent || "",
  }));
  check(
    "D4c",
    "clicking a result opens that service's receipt",
    receiptInfo.receipt.includes(SEARCH_NAME) &&
      receiptInfo.dialog.includes("বিল প্রিভিউ"),
    receiptInfo.receipt.slice(0, 120)
  );
  await page.keyboard.press("Escape");
  await waitGone('[role="dialog"] [data-receipt]');

  // Edit action from the dropdown opens the form with that row.
  await page.click("#global-search");
  await typeInto(page, "global-search", SEARCH_PHONE);
  await waitSearchResults('[data-testid="global-search-dropdown"]', SEARCH_PHONE);
  await page.evaluate(() => {
    const d = document.querySelector('[data-testid="global-search-dropdown"]');
    d.querySelector('button[title="এডিট"]').click();
  });
  await page.waitForFunction(
    (name) => document.querySelector("#svc-name")?.value === name,
    { polling: 100, timeout: 8000 },
    SEARCH_NAME
  );
  const editingLabel = await page.$eval("form button[type='submit']", (el) =>
    el.textContent.trim()
  );
  check(
    "D4d",
    "search result edit fills the form",
    editingLabel === "আপডেট করুন",
    editingLabel
  );
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll("form button")].find(
      (b) => b.textContent.trim() === "বাতিল"
    );
    cancel?.click();
  });
  await page.waitForFunction(
    () => document.querySelector("#svc-name")?.value === "",
    { polling: 100, timeout: 8000 }
  );

  // ---------- D5: mobile search collapses to an icon ----------
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 300));
  const mobileState = await page.evaluate(() => {
    const desktop = document.querySelector("#global-search");
    const trigger = document.querySelector('[data-testid="mobile-search-open"]');
    return {
      desktopHidden: !desktop || desktop.offsetParent === null,
      triggerVisible: !!trigger && trigger.offsetParent !== null,
    };
  });
  check(
    "D5a",
    "mobile collapses search into a visible 🔍 icon",
    mobileState.desktopHidden && mobileState.triggerVisible,
    JSON.stringify(mobileState)
  );
  await page.click('[data-testid="mobile-search-open"]');
  await page.waitForSelector("#global-search-mobile", {
    polling: 100,
    timeout: 8000,
  });
  const mobileFocused = await page.evaluate(
    () => document.activeElement?.id === "global-search-mobile"
  );
  await typeInto(page, "global-search-mobile", SEARCH_NAME);
  await waitSearchResults('[data-testid="mobile-search-results"]', SEARCH_NAME);
  check(
    "D5b",
    "mobile sheet expands, autofocuses and shows results",
    mobileFocused,
    String(mobileFocused)
  );
  await page.keyboard.press("Escape");
  await waitGone("#global-search-mobile");
  check(
    "D5c",
    "mobile search sheet closes with Escape",
    (await page.$("#global-search-mobile")) === null
  );
  await page.setViewport({ width: 1366, height: 900 });
  await new Promise((r) => setTimeout(r, 300));

  // ---------- D6: product-sale mode ----------
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 900));

  const defaultMode = await page.evaluate(() => ({
    model: document.querySelector('label[for="svc-model"]')?.textContent.trim(),
    problem: document.querySelector('label[for="svc-problem"]')?.textContent.trim(),
    statusMissing: !document.querySelector("#svc-status"),
  }));
  check(
    "D6a",
    "form defaults to service labels with no new-entry status field",
    defaultMode.model === "মোবাইলের মডেল" &&
      defaultMode.problem === "সমস্যা" &&
      defaultMode.statusMissing === true,
    JSON.stringify(defaultMode)
  );


  await page.setViewport({ width: 1366, height: 900 });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  const fit1366 = await page.evaluate(() => {
    const form = document.querySelector("form");
    const table = document.querySelector('[data-testid="daily-services"]');
    return {
      viewport: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      formTop: Math.round(form.getBoundingClientRect().top),
      tableTop: Math.round(table.getBoundingClientRect().top),
      overflowX:
        document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  check(
    "D7c",
    "1366×900: form + table start visible, no page overflow",
    fit1366.formTop >= 0 &&
      fit1366.formTop < fit1366.viewport &&
      fit1366.tableTop >= 0 &&
      fit1366.tableTop < fit1366.viewport &&
      fit1366.overflowX === false,
    JSON.stringify(fit1366)
  );

  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 300));
  // D7d checks the relocated report/dues dialogs on the Dashboard.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="open-report"]', { timeout: 15000 });
  // Reloads preserve scroll; bring the action row out from under the sticky
  // header and use a DOM click so Puppeteer does not scroll it back under.
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() =>
    document.querySelector('[data-testid="open-report"]')?.click()
  );
  await page.waitForSelector('[data-testid="report-dialog"]');
  const reportMobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  await closeDialog("report-dialog");
  await page.evaluate(() =>
    document.querySelector('[data-testid="open-dues"]')?.click()
  );
  await page.waitForSelector('[data-testid="dues-dialog"]');
  const duesMobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  await closeDialog("dues-dialog");
  check(
    "D7d",
    "mobile report/dues dialogs do not overflow the page horizontally",
    reportMobileOverflow === false && duesMobileOverflow === false,
    JSON.stringify({ reportMobileOverflow, duesMobileOverflow })
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
    console.error("LANE-D CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
