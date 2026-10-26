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
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (value) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const duesLabel = (d) =>
  `💰 বাকি তালিকা (${bn(d.count)}টি • ৳${bn(
    d.totalDue.toLocaleString("en-IN")
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
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
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
    await page.evaluate((id) => {
      const dlg = document.querySelector(`[data-testid="${id}"]`);
      const x = dlg
        ? [...dlg.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Close"
          )
        : null;
      if (x) x.click();
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

  // ---------- D1: layout order + removed sections ----------
  const layout = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().top + window.scrollY);
    };
    const printCopy = document.querySelector('[data-testid="monthly-print"]');
    return {
      header: top("header"),
      action: top('[data-testid="page-actions"]'),
      summary: top('[data-testid="toggle-daily-summary"]'),
      tech: top('[data-testid="technician-stats"]'),
      today: top('[data-testid="today-stats"]'),
      form: top("form"),
      table: top('[data-testid="daily-services"]'),
      footer: top("footer"),
      oldSearch: !!document.querySelector('[data-testid="global-service-search"]'),
      duesOutsideDialog: !!document.querySelector('[data-testid="outstanding-dues"]'),
      reportOutsideDialog: !!document.querySelector('[data-testid="report-dialog"]'),
      printCopyHidden:
        !!printCopy && getComputedStyle(printCopy).display === "none",
    };
  });
  console.log("reached D1", JSON.stringify(layout));
  check(
    "D1",
    "order: header → actions → daily-summary bar → form/table → footer; old blocks gone",
    layout.header < layout.action &&
      layout.action < layout.summary &&
      layout.summary < layout.form &&
      layout.summary < layout.table &&
      Math.abs(layout.form - layout.table) < 120 &&
      layout.footer > layout.table &&
      layout.oldSearch === false &&
      layout.duesOutsideDialog === false &&
      layout.reportOutsideDialog === false &&
      layout.printCopyHidden === true,
    JSON.stringify(layout)
  );

  // ---------- D1b: the summary bar expands the technician + day panels ----------
  await page.click('[data-testid="toggle-daily-summary"]');
  await page.waitForFunction(
    () => {
      const el = document.getElementById("daily-summary-body");
      return !!el && el.getBoundingClientRect().height > 100;
    },
    { polling: 100, timeout: 5000 }
  );
  const expanded = await page.evaluate(() => {
    const top = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    };
    return {
      tech: top('[data-testid="technician-stats"]'),
      today: top('[data-testid="today-stats"]'),
      form: top("form"),
    };
  });
  check(
    "D1b",
    "daily summary expands: tech → today, both above the form",
    expanded.tech !== null &&
      expanded.today !== null &&
      expanded.tech < expanded.today &&
      expanded.today < expanded.form,
    JSON.stringify(expanded)
  );
  // Collapse again so the viewport checks below see the default layout.
  await page.click('[data-testid="toggle-daily-summary"]');
  await page.waitForFunction(
    () => {
      const el = document.getElementById("daily-summary-body");
      return !!el && el.getBoundingClientRect().height < 5;
    },
    { polling: 100, timeout: 5000 }
  );

  // ---------- D2: report dialog (X + ESC) ----------
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
    "dues button shows live Bengali count + total",
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
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 900));

  const defaultMode = await page.evaluate(() => ({
    service: document
      .querySelector('[data-testid="mode-service"]')
      ?.getAttribute("aria-checked"),
    product: document
      .querySelector('[data-testid="mode-product"]')
      ?.getAttribute("aria-checked"),
    model: document.querySelector('label[for="svc-model"]')?.textContent.trim(),
    problem: document.querySelector('label[for="svc-problem"]')?.textContent.trim(),
    status: document.querySelector("#svc-status")?.textContent.trim(),
  }));
  check(
    "D6a",
    "form defaults to 🛠️ সার্ভিসিং with service labels",
    defaultMode.service === "true" &&
      defaultMode.product === "false" &&
      defaultMode.model === "মোবাইলের মডেল" &&
      defaultMode.problem === "সমস্যা" &&
      defaultMode.status === "চলছে",
    JSON.stringify(defaultMode)
  );

  await page.click('[data-testid="mode-product"]');
  await new Promise((r) => setTimeout(r, 150));
  const productMode = await page.evaluate(() => ({
    service: document
      .querySelector('[data-testid="mode-service"]')
      ?.getAttribute("aria-checked"),
    product: document
      .querySelector('[data-testid="mode-product"]')
      ?.getAttribute("aria-checked"),
    model: document.querySelector('label[for="svc-model"]')?.textContent.trim(),
    problem: document.querySelector('label[for="svc-problem"]')?.textContent.trim(),
    status: document.querySelector("#svc-status")?.textContent.trim(),
    statusDisabled: document.querySelector("#svc-status")?.disabled === true,
    expenseEnabled: document.querySelector("#svc-expense")?.disabled === false,
    hint: document.body.textContent.includes("SALES/দোকান"),
  }));
  check(
    "D6b",
    "🛍️ প্রোডাক্ট সেল renames model/details, forces ডেলিভারি, keeps expense",
    productMode.service === "false" &&
      productMode.product === "true" &&
      productMode.model === "প্রোডাক্টের নাম (যেমন: Charger, Cable)" &&
      productMode.problem === "বিবরণ (যেমন: 18W Type-C)" &&
      productMode.status === "ডেলিভারি" &&
      productMode.statusDisabled &&
      productMode.expenseEnabled &&
      productMode.hint,
    JSON.stringify(productMode)
  );

  // Switching back restores the service labels and the previous status.
  await page.click('[data-testid="mode-service"]');
  await new Promise((r) => setTimeout(r, 150));
  const backToService = await page.evaluate(() => ({
    model: document.querySelector('label[for="svc-model"]')?.textContent.trim(),
    problem: document.querySelector('label[for="svc-problem"]')?.textContent.trim(),
    status: document.querySelector("#svc-status")?.textContent.trim(),
    statusDisabled: document.querySelector("#svc-status")?.disabled === true,
  }));
  check(
    "D6c",
    "switching back restores service labels + status",
    backToService.model === "মোবাইলের মডেল" &&
      backToService.problem === "সমস্যা" &&
      backToService.status === "চলছে" &&
      backToService.statusDisabled === false,
    JSON.stringify(backToService)
  );

  await page.click('[data-testid="mode-product"]');
  await new Promise((r) => setTimeout(r, 150));
  await page.click("#svc-tech");
  await page.waitForSelector('[role="option"]', { polling: 100, timeout: 5000 });
  const techOptions = await page.$$eval('[role="option"]', (els) =>
    els.map((e) => e.textContent.trim())
  );
  check(
    "D6d",
    "product mode lists SALES from the roster (sorted first)",
    techOptions[0] === "SALES" && techOptions.includes("SALES"),
    techOptions.join(",")
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="option"]')]
      .find((o) => o.textContent.trim() === "SALES")
      ?.click();
  });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 150));

  await typeInto(page, "svc-name", PRODUCT_NAME);
  await typeInto(page, "svc-phone", SEARCH_PHONE);
  await typeInto(page, "svc-model", "18W Charger");
  await typeInto(page, "svc-problem", "Type-C 1m");
  await typeInto(page, "svc-bill", "800");
  await typeInto(page, "svc-adv", "500");
  await typeInto(page, "svc-expense", "*J#");
  const expensePreview = await page.$eval(
    "#svc-expense-help",
    (el) => el.textContent || ""
  );
  check(
    "D6e",
    "expense secret code still decodes in product mode",
    expensePreview.includes("গোপন কোড") && expensePreview.includes("*J#") && expensePreview.includes("৳১৫০০"),
    expensePreview
  );
  await submitButton(page, "সেভ করুন");
  await waitToast(page, "সেভ হয়েছে").catch(() => null);
  await waitDailyRow(page, PRODUCT_NAME, true);
  const created = (
    await (
      await api(page, `/api/services?date=${TODAY}`)
    ).body.services
  ).find((s) => s.customerName === PRODUCT_NAME);
  check(
    "D6f",
    "product saves into model/problem, status Delivered, technician SALES",
    created &&
      created.model === "18W Charger" &&
      created.problem === "Type-C 1m" &&
      created.status === "Delivered" &&
      created.technician === "SALES" &&
      created.totalBill === 800 &&
      created.advance === 500 &&
      created.due === 300 &&
      created.shopExpense === "*J#" &&
      created.expenseAmount === 1500,
    JSON.stringify(
      created && {
        model: created.model,
        problem: created.problem,
        status: created.status,
        tech: created.technician,
        due: created.due,
        code: created.shopExpense,
        expense: created.expenseAmount,
      }
    )
  );
  const duesAfter = (await api(page, "/api/services/dues")).body;
  await page.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="open-dues"]')?.textContent.trim() ===
      expected,
    { polling: 100, timeout: 8000 },
    duesLabel(duesAfter)
  );
  check(
    "D6g",
    "dues button updates live after the product sale",
    duesAfter.count === duesBefore.count + 1 &&
      duesAfter.totalDue === duesBefore.totalDue + 300,
    JSON.stringify({ before: duesBefore, after: duesAfter })
  );

  // Editing the saved product row must infer product mode from SALES.
  await clickDailyRowButton(page, PRODUCT_NAME, "এডিট");
  await page.waitForFunction(
    (name) => document.querySelector("#svc-name")?.value === name,
    { polling: 100, timeout: 8000 },
    PRODUCT_NAME
  );
  const editMode = await page.evaluate(() => ({
    product: document
      .querySelector('[data-testid="mode-product"]')
      ?.getAttribute("aria-checked"),
    model: document.querySelector('label[for="svc-model"]')?.textContent.trim(),
    status: document.querySelector("#svc-status")?.textContent.trim(),
  }));
  check(
    "D6h",
    "editing a SALES row reopens product mode with Delivered",
    editMode.product === "true" &&
      editMode.model === "প্রোডাক্টের নাম (যেমন: Charger, Cable)" &&
      editMode.status === "ডেলিভারি",
    JSON.stringify(editMode)
  );
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll("form button")].find(
      (b) => b.textContent.trim() === "বাতিল"
    );
    cancel?.click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // Product-mode validation wording.
  await page.click('[data-testid="mode-product"]');
  await typeInto(page, "svc-name", PRODUCT_NAME + "X");
  await typeInto(page, "svc-phone", SEARCH_PHONE);
  await submitButton(page, "সেভ করুন");
  await waitToast(page, "প্রোডাক্টের নাম দিন").catch(() => null);
  check(
    "D6i",
    "product mode validation says প্রোডাক্টের নাম দিন",
    (await page.evaluate(() => document.body.textContent)).includes(
      "প্রোডাক্টের নাম দিন"
    )
  );
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 700));

  // ---------- D7: one-screen desktop + responsive dialogs ----------
  await page.setViewport({ width: 1920, height: 1080 });
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  // Wait for real cards (not skeletons): their row count drives the layout.
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="tech-card"]').length >= 4,
    { polling: 200, timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 900));
  // Reloads can restore an old scroll position. The zero-scroll guarantee is
  // measured from the top, so reset it explicitly first.
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 250));
  const fit = await page.evaluate(() => {
    const form = document.querySelector("form");
    const table = document.querySelector('[data-testid="daily-services"]');
    const save = [...form.querySelectorAll("button[type='submit']")][0];
    return {
      viewport: window.innerHeight,
      scrollY: Math.round(window.scrollY),
      formTop: Math.round(form.getBoundingClientRect().top),
      formBottom: Math.round(form.getBoundingClientRect().bottom),
      saveBottom: Math.round(save.getBoundingClientRect().bottom),
      tableTop: Math.round(table.getBoundingClientRect().top),
      overflowX:
        document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  console.log("reached D7", JSON.stringify(fit));
  check(
    "D7a",
    "1920×1080: form + table start visible with no page overflow",
    fit.formTop >= 0 &&
      fit.formTop < fit.viewport &&
      fit.tableTop >= 0 &&
      fit.tableTop < fit.viewport &&
      fit.overflowX === false,
    JSON.stringify(fit)
  );
  check(
    "D7b",
    "1920×1080: save button visible without page scroll",
    fit.saveBottom <= fit.viewport,
    JSON.stringify({ saveBottom: fit.saveBottom, viewport: fit.viewport })
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
  await page.evaluate(() => {
    const d = document.querySelector('[data-testid="dues-dialog"]');
    const x = d
      ? [...d.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Close"
        )
      : null;
    x?.click();
  });
  await waitGone('[data-testid="dues-dialog"]');
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
