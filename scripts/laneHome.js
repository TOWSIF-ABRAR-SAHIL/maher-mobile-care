/* Home dashboard redesign: real-data KPIs, today-only finance, grouped visits,
 * stock health, report/dues drill-downs and the reused backup utilities.
 *
 * Everything is seeded through the real API into this suite's throwaway
 * database (scripts/run-tests.js). No absolute live-shop numbers are assumed:
 * the suite starts from an empty DB, creates its own rows, and asserts the DOM
 * against the API responses it just produced.
 *
 * Run only through `npm test`.
 */
const {
  api,
  dayLabel,
  dhakaToday,
  closeBrowser,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const LONG_AGO = shiftDay(TODAY, -2);
const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const bn = (value) => String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
const bnToNumber = (value) =>
  Number(
    String(value).replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)))
  );
const tk = (n) => `৳${Math.round(n).toLocaleString("en-IN")}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const GROUP_NAME = uniqueName("HomeGroup");
const SINGLE_NAME = uniqueName("HomeSingle");
const OLD_NAME = uniqueName("HomeOverdue");
const DONE_NAME = uniqueName("HomeDelivered");
const CATEGORY = uniqueName("HomeCat");
const LOW_PRODUCT = uniqueName("HomeLow");
const OUT_PRODUCT = uniqueName("HomeOut");

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

  let serviceRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/services?date=")) serviceRequests += 1;
  });

  const get = async (url) => (await api(page, url)).body;

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });

  // Make sure the roster row the seed rows need exists in this fresh DB.
  const roster = await get("/api/technicians");
  if (!roster.technicians?.some((t) => t.name === "NURUL" && t.isActive)) {
    const added = await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "NURUL" }),
    });
    if (!added.ok) throw new Error("NURUL not available: " + JSON.stringify(added.body));
  }

  const post = (url, body) =>
    api(page, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // ---------- seed: one multi-device visit + one single-device visit ----------
  const batch = await post("/api/services/batch", {
    customerName: GROUP_NAME,
    phone: "01711110001",
    technician: "NURUL",
    serviceDate: TODAY,
    devices: [
      {
        model: "Group Model A",
        problem: "Display dead",
        totalBill: 3000,
        advance: 1000,
        status: "In-Progress",
        deliveryDate: TODAY,
      },
      {
        model: "Group Model B",
        problem: "Battery swap",
        totalBill: 2000,
        advance: 2000,
        status: "Delivered",
        deliveryDate: TODAY,
      },
    ],
  });
  if (!batch.ok) throw new Error("batch seed failed: " + JSON.stringify(batch.body));

  const single = await post("/api/services", {
    customerName: SINGLE_NAME,
    phone: "01711110002",
    model: "Single Model",
    technician: "NURUL",
    problem: "Charging port",
    totalBill: 1500,
    advance: 500,
    status: "Pending",
    shopExpense: "500",
    serviceDate: TODAY,
    // Promised yesterday and still not handed over: an overdue highlight on
    // today's visit row, not a demand created yesterday.
    deliveryDate: YESTERDAY,
  });
  if (!single.ok) throw new Error("single seed failed: " + JSON.stringify(single.body));

  // ---------- seed: cross-date backlog and a delivered-in-time row ----------
  const old = await post("/api/services", {
    customerName: OLD_NAME,
    phone: "01711110003",
    model: "Old Model",
    technician: "NURUL",
    problem: "No power",
    totalBill: 1200,
    advance: 200,
    status: "Pending",
    serviceDate: YESTERDAY,
    deliveryDate: LONG_AGO,
  });
  if (!old.ok) throw new Error("overdue seed failed: " + JSON.stringify(old.body));

  const done = await post("/api/services", {
    customerName: DONE_NAME,
    phone: "01711110004",
    model: "Done Model",
    technician: "NURUL",
    problem: "Speaker",
    totalBill: 900,
    advance: 900,
    status: "Delivered",
    serviceDate: YESTERDAY,
    deliveryDate: YESTERDAY,
  });
  if (!done.ok) throw new Error("delivered seed failed: " + JSON.stringify(done.body));

  // ---------- seed: one low-stock and one out-of-stock product ----------
  const category = await post("/api/product-categories", { name: CATEGORY });
  if (!category.ok) {
    throw new Error("category seed failed: " + JSON.stringify(category.body));
  }
  const categoryId = category.body.category.id;
  const low = await post("/api/products", {
    name: LOW_PRODUCT,
    categoryId,
    sellingPrice: 100,
    purchasePrice: 50,
    lowStockThreshold: 3,
    openingStock: 1,
  });
  if (!low.ok) throw new Error("low product seed failed: " + JSON.stringify(low.body));
  const out = await post("/api/products", {
    name: OUT_PRODUCT,
    categoryId,
    sellingPrice: 120,
    purchasePrice: 60,
    lowStockThreshold: 2,
    openingStock: 0,
  });
  if (!out.ok) throw new Error("out product seed failed: " + JSON.stringify(out.body));

  // ---------- API backstops (the DOM must agree with these) ----------
  const stats = await get(`/api/stats?date=${TODAY}`);
  const services = (await get(`/api/services?date=${TODAY}`)).services;
  const overdue = await get(`/api/services/overdue?date=${TODAY}`);
  const dues = await get("/api/services/dues");
  const monthly = await get(
    `/api/stats/monthly?from=${shiftDay(TODAY, -29)}&to=${TODAY}`
  );
  const products = await get("/api/products?sort=stock");
  const active = services.filter((s) => s.status !== "Returned");
  const statusCounts = {
    Pending: active.filter((s) => s.status === "Pending").length,
    "In-Progress": active.filter((s) => s.status === "In-Progress").length,
    Completed: active.filter((s) => s.status === "Completed").length,
    Delivered: active.filter((s) => s.status === "Delivered").length,
  };
  const visitKeys = new Set(active.map((s) => (s.groupId ? "g:" + s.groupId : "r:" + s.id)));
  const shownProfit = stats.today.bill - stats.today.expense - stats.today.damageLoss;

  check(
    "H0a",
    "seed stats: 3 device jobs, today-only money, separate backlog",
    stats.today.count === 3 &&
      stats.today.bill === 6500 &&
      stats.today.advance === 3500 &&
      stats.today.due === 3000 &&
      stats.today.expense === 500 &&
      stats.today.damageLoss === 0 &&
      overdue.count === 2 &&
      overdue.totalDue === 2000 &&
      overdue.oldestDeliveryDate === LONG_AGO &&
      dues.count === 3 &&
      dues.totalDue === 4000 &&
      products.summary.totalProducts === 2 &&
      products.summary.lowStock === 1 &&
      products.summary.outOfStock === 1,
    JSON.stringify({ today: stats.today, overdue, dues: { count: dues.count, totalDue: dues.totalDue } })
  );
  check(
    "H0b",
    "seeded statuses reconcile with the day count (device rows, 2 visits)",
    statusCounts.Pending === 1 &&
      statusCounts["In-Progress"] === 1 &&
      statusCounts.Completed === 0 &&
      statusCounts.Delivered === 1 &&
      Object.values(statusCounts).reduce((a, b) => a + b, 0) === stats.today.count &&
      visitKeys.size === 2,
    JSON.stringify({ statusCounts, visits: visitKeys.size })
  );

  // The seeded rows were created through the API; reload so Home renders them.
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) =>
      document.querySelector('[data-testid="home-recent"]')?.textContent.includes(name),
    { polling: 200, timeout: 30000 },
    GROUP_NAME
  );
  await page.waitForFunction(
    () => document.querySelector('[data-testid="kpi-total"]'),
    { polling: 200, timeout: 30000 }
  );
  await sleep(300);

  // ---------- H1: chrome + header ----------
  const chrome = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    const nav = document.querySelector('[data-testid="header-nav"]');
    const lead = document.querySelector("h1")?.closest("section");
    return {
      headers: document.querySelectorAll('[data-testid="app-header"]').length,
      links: [...(nav?.querySelectorAll("a") || [])].map((a) => a.textContent.trim()),
      brand: header?.textContent?.includes("মোবাইল সার্ভিস ও বিক্রয় কেন্দ্র") ?? false,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      lead: lead?.textContent ?? "",
      weekday:
        /(সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার|রবিবার)/.test(
          lead?.textContent ?? ""
        ),
      bengaliDate:
        /[০-৯]{1,2} (জানুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর) [০-৯]{4}/.test(
          lead?.textContent ?? ""
        ),
      actions: [...(lead?.querySelectorAll('[data-testid="page-actions"] a') || [])].map(
        (a) => ({ text: a.textContent.trim(), href: a.getAttribute("href") })
      ),
      reportNav: [...(nav?.querySelectorAll("a") || [])].some((a) =>
        a.textContent.includes("রিপোর্ট")
      ),
    };
  });
  const newServiceAction = chrome.actions.find((a) => a.text.includes("নতুন সার্ভিস"));
  check(
    "H1a",
    "one navbar, exactly Home/Service/Product, no Report destination",
    chrome.headers === 1 &&
      chrome.links.join(",") === "হোম,সার্ভিস,প্রোডাক্ট" &&
      chrome.reportNav === false,
    JSON.stringify(chrome.links)
  );
  check(
    "H1b",
    "header has the dashboard title, Bengali date, explanation and real service action",
    chrome.h1 === "আজকের ড্যাশবোর্ড" &&
      chrome.weekday &&
      chrome.bengaliDate &&
      chrome.lead.includes("আজকের সার্ভিস, টাকা, বাকি ও স্টকের সারসংক্ষেপ দেখুন।") &&
      chrome.brand &&
      newServiceAction?.href === `/service?date=${TODAY}&mode=service`,
    JSON.stringify({ h1: chrome.h1, action: newServiceAction })
  );

  // ---------- H2: KPI cards reconcile with real data ----------
  const kpis = await page.evaluate(() => {
    const read = (id) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      return {
        value: el.querySelectorAll("p")[0]?.textContent?.trim() ?? "",
        text: el.textContent ?? "",
        href:
          el.tagName === "A"
            ? el.getAttribute("href")
            : el.closest("a")?.getAttribute("href") ?? null,
        isLink: el.tagName === "A" || !!el.closest("a"),
      };
    };
    return {
      total: read("kpi-total"),
      pending: read("kpi-pending"),
      inProgress: read("kpi-in-progress"),
      completed: read("kpi-completed"),
      delivered: read("kpi-delivered"),
      overdue: read("kpi-overdue"),
      cards: document.querySelectorAll(
        '[data-testid="home-kpis"] [data-testid^="kpi-"]'
      ).length,
    };
  });
  check(
    "H2a",
    "six cards: total, four workflow stages, overdue",
    kpis.cards === 6 &&
      kpis.total?.value === bn(3) &&
      kpis.pending?.value === bn(statusCounts.Pending) &&
      kpis.inProgress?.value === bn(statusCounts["In-Progress"]) &&
      kpis.completed?.value === bn(statusCounts.Completed) &&
      kpis.delivered?.value === bn(statusCounts.Delivered),
    JSON.stringify(kpis)
  );
  const stageSum = [
    kpis.pending,
    kpis.inProgress,
    kpis.completed,
    kpis.delivered,
  ].reduce((sum, card) => sum + bnToNumber(card?.value ?? 0), 0);
  check(
    "H2b",
    "stage cards sum to the total and the total names the visit count",
    stageSum === bnToNumber(kpis.total?.value ?? 0) &&
      stageSum === stats.today.count &&
      kpis.total?.text.includes(`${bn(visitKeys.size)}টি কাস্টমার ভিজিট`),
    JSON.stringify({ stageSum, total: kpis.total?.value, visits: visitKeys.size })
  );
  check(
    "H2c",
    "cards link only to real filtered Service views",
    kpis.total?.href === `/service?date=${TODAY}` &&
      kpis.pending?.href === `/service?date=${TODAY}&status=Pending` &&
      kpis.inProgress?.href === `/service?date=${TODAY}&status=In-Progress` &&
      kpis.completed?.href === `/service?date=${TODAY}&status=Completed` &&
      kpis.delivered?.href === `/service?date=${TODAY}&status=Delivered`,
    JSON.stringify({
      total: kpis.total?.href,
      pending: kpis.pending?.href,
      delivered: kpis.delivered?.href,
    })
  );
  check(
    "H2d",
    "overdue card is cross-date, non-clickable and never labelled as today's work",
    kpis.overdue?.value === bn(2) &&
      kpis.overdue?.isLink === false &&
      kpis.overdue?.text.includes(dayLabel(LONG_AGO)) &&
      !kpis.overdue?.text.includes("আজকের"),
    JSON.stringify({ overdue: kpis.overdue })
  );

  // ---------- H3: today-only finance ----------
  const finance = await page.$eval(
    '[data-testid="home-money-band"]',
    (el) => el.innerText
  );
  check(
    "H3a",
    "finance carries the five real figures with the verified profit formula",
    finance.includes("মোট বিল") &&
      finance.includes(tk(stats.today.bill)) &&
      finance.includes("মোট জমা") &&
      finance.includes(tk(stats.today.advance)) &&
      finance.includes("মোট বাকি") &&
      finance.includes(tk(stats.today.due)) &&
      finance.includes("খরচ + ক্ষতি") &&
      finance.includes(tk(stats.today.expense + stats.today.damageLoss)) &&
      finance.includes("নিট লাভ") &&
      finance.includes(tk(shownProfit)),
    JSON.stringify({ expectedProfit: shownProfit })
  );
  check(
    "H3b",
    "finance is labelled today-only and does not absorb the all-date dues/backlog",
    finance.includes("শুধু আজকের কাজ") &&
      !finance.includes(tk(dues.totalDue)) &&
      !finance.includes(tk(overdue.totalDue)),
    JSON.stringify({ todayDue: tk(stats.today.due), allDue: tk(dues.totalDue) })
  );

  // ---------- H4: recent work groups a multi-device visit ----------
  const recent = await page.evaluate((names) => {
    const section = document.querySelector('[data-testid="home-recent"]');
    const rows = [...(section?.querySelectorAll(":scope > ol > li") || [])];
    const rowFor = (name) => rows.find((li) => li.textContent.includes(name));
    const groupRow = rowFor(names.group);
    const singleRow = rowFor(names.single);
    const toggle = groupRow?.querySelector('button[data-testid^="recent-toggle-"]');
    return {
      title: section?.textContent?.includes("আজকের সাম্প্রতিক কাজ") ?? false,
      visitBadge: section?.textContent?.includes("২টি ভিজিট") ?? false,
      rows: rows.length,
      toggles: section?.querySelectorAll('button[data-testid^="recent-toggle-"]').length,
      group: groupRow
        ? {
            text: groupRow.textContent,
            toggleId: toggle?.getAttribute("data-testid") ?? null,
            expanded: toggle?.getAttribute("aria-expanded") ?? null,
            panelId: toggle?.getAttribute("aria-controls") ?? null,
            edit: [...groupRow.querySelectorAll('a[href*="edit="]')].map((a) =>
              a.getAttribute("href")
            ),
            receipt: [...groupRow.querySelectorAll('a[href*="receipt="]')].map((a) =>
              a.getAttribute("href")
            ),
          }
        : null,
      single: singleRow
        ? {
            text: singleRow.textContent,
            toggle: !!singleRow.querySelector('button[data-testid^="recent-toggle-"]'),
          }
        : null,
    };
  }, { group: GROUP_NAME, single: SINGLE_NAME });

  check(
    "H4a",
    "multi-device visit is one parent row with a count and a real toggle",
    recent.title &&
      recent.visitBadge &&
      recent.rows === 2 &&
      recent.toggles === 1 &&
      recent.group?.expanded === "false" &&
      !!recent.group?.toggleId &&
      !!recent.group?.panelId &&
      recent.single?.toggle === false,
    JSON.stringify({
      rows: recent.rows,
      toggles: recent.toggles,
      group: recent.group?.text?.slice(0, 120),
    })
  );
  check(
    "H4b",
    "parent shows the visit total once; child rows are not rendered until expanded",
    !!recent.group?.text.includes("২টি ডিভাইস") &&
      recent.group?.text.includes(tk(2000)) &&
      (await page.evaluate(
        () => document.querySelectorAll('[data-testid^="recent-device-"]').length
      )) === 0,
    JSON.stringify({ group: recent.group?.text?.slice(0, 160) })
  );
  check(
    "H4c",
    "edit and receipt links point at the real visit rows",
    (recent.group?.edit.length ?? 0) >= 1 &&
      (recent.group?.receipt.length ?? 0) >= 1 &&
      recent.group.edit.every(
        (href) => href.includes(`date=${TODAY}`) && href.includes("edit=")
      ) &&
      recent.group.receipt.every(
        (href) => href.includes(`date=${TODAY}`) && href.includes("receipt=")
      ),
    JSON.stringify({ edit: recent.group?.edit, receipt: recent.group?.receipt })
  );
  check(
    "H4d",
    "today's visit carries an overdue delivery highlight when its promise passed",
    !!recent.single?.text.includes("⚠️") &&
      !!recent.single?.text.includes("ডেলিভারি") &&
      recent.single?.text.includes(tk(1000)),
    JSON.stringify({ single: recent.single?.text?.slice(0, 180) })
  );

  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll('[data-testid="home-recent"] > ol > li')];
    const row = rows.find((li) => li.textContent.includes(name));
    row?.querySelector('button[data-testid^="recent-toggle-"]')?.click();
  }, GROUP_NAME);
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="recent-device-"]').length === 2,
    { polling: 100, timeout: 5000 }
  );
  const expanded = await page.evaluate((panelId) => {
    const toggle = document.querySelector('button[data-testid^="recent-toggle-"]');
    const rows = [...document.querySelectorAll('[data-testid^="recent-device-"]')];
    return {
      expanded: toggle?.getAttribute("aria-expanded"),
      panelPresent: !!document.getElementById(panelId),
      devices: rows.map((li) => li.textContent),
      models: ["Group Model A", "Group Model B"].every((model) =>
        rows.some((li) => li.textContent.includes(model))
      ),
      statuses: rows.every(
        (li) => li.textContent.includes("চলছে") || li.textContent.includes("ডেলিভারি")
      ),
    };
  }, recent.group?.panelId);
  check(
    "H4e",
    "expanding reveals each device with its own status and keeps aria wiring",
    expanded.expanded === "true" &&
      expanded.panelPresent &&
      expanded.models &&
      expanded.statuses,
    JSON.stringify({ expanded: expanded.expanded, panel: expanded.panelPresent })
  );

  // ---------- H5: real inventory health, no fake stock action ----------
  const stock = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="home-low-stock"]');
    const link = [...(section?.querySelectorAll("a") || [])].find((a) =>
      a.textContent.includes("ইনভেন্টরি")
    );
    return {
      text: section?.innerText ?? "",
      href: link?.getAttribute("href") ?? null,
      addStock: document.body.textContent.includes("স্টক যোগ করুন"),
    };
  });
  check(
    "H5",
    "stock card uses real thresholds/counts and offers no non-existent stock action",
    stock.text.includes("মোট প্রোডাক্ট") &&
      stock.text.includes(LOW_PRODUCT) &&
      stock.text.includes(OUT_PRODUCT) &&
      stock.text.includes("কম স্টক") &&
      stock.text.includes("স্টক নেই") &&
      stock.href === "/products?status=low" &&
      stock.addStock === false,
    JSON.stringify({ href: stock.href, addStock: stock.addStock })
  );

  // ---------- H6: report + all-date dues drill-downs ----------
  const reportCard = await page.$eval('[data-testid="home-report"]', (el) => el.innerText);
  check(
    "H6a",
    "report card labels its period and shows the real monthly figures",
    reportCard.includes("শেষ ৩০ দিন") &&
      reportCard.includes(tk(monthly.summary.bill)) &&
      reportCard.includes(tk(monthly.summary.profit)) &&
      reportCard.includes(tk(monthly.summary.due)),
    JSON.stringify({ reported: monthly.summary })
  );

  await page.evaluate(() =>
    document.querySelector('[data-testid="open-report"]')?.click()
  );
  await page.waitForSelector('[data-testid="report-dialog"]', { timeout: 8000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="report-dialog"]')
        ?.textContent?.includes("ওভারঅল রিপোর্ট"),
    { polling: 100, timeout: 8000 }
  );
  const reportDialog = await page.$eval(
    '[data-testid="report-dialog"]',
    (el) => el.innerText
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="report-dialog"]'),
    { polling: 100, timeout: 8000 }
  );
  check(
    "H6b",
    "report dialog opens on the real summary and Escape closes it",
    reportDialog.includes("মোট বিল") &&
      reportDialog.includes(tk(monthly.summary.bill)) &&
      !(await page.$('[data-testid="report-dialog"]')),
    JSON.stringify({ hasBill: reportDialog.includes(tk(monthly.summary.bill)) })
  );

  const duesCard = await page.$eval('[data-testid="home-dues"]', (el) => el.innerText);
  check(
    "H6c",
    "dues card is explicitly all-date and shows the aggregate",
    duesCard.includes("সব তারিখের অপরিশোধিত বিল") &&
      duesCard.includes(tk(dues.totalDue)) &&
      duesCard.includes(`${bn(dues.count)}টি`) &&
      !duesCard.includes("আজকের বাকি"),
    JSON.stringify({ duesCard })
  );

  await page.evaluate(() =>
    document.querySelector('[data-testid="open-dues"]')?.click()
  );
  await page.waitForSelector('[data-testid="dues-dialog"]', { timeout: 8000 });
  await page.waitForFunction(
    (name) =>
      document
        .querySelector('[data-testid="dues-dialog"]')
        ?.textContent?.includes(name),
    { polling: 100, timeout: 8000 },
    SINGLE_NAME
  );
  const duesDialog = await page.$eval(
    '[data-testid="dues-dialog"]',
    (el) => el.innerText
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="dues-dialog"]'),
    { polling: 100, timeout: 8000 }
  );
  check(
    "H6d",
    "dues dialog lists the real outstanding rows incl. older dates",
    duesDialog.includes(SINGLE_NAME) &&
      duesDialog.includes(OLD_NAME) &&
      duesDialog.includes(`${dues.count}টি ডিভাইস বাকি`) &&
      duesDialog.includes(tk(dues.totalDue)) &&
      !(await page.$('[data-testid="dues-dialog"]')),
    JSON.stringify({ hasOld: duesDialog.includes(OLD_NAME), hasSingle: duesDialog.includes(SINGLE_NAME) })
  );

  // ---------- H7: utilities reuse refresh/backup/restore ----------
  const lastBackupShown = await page.evaluate(() =>
    document
      .querySelector('[data-testid="home-utilities"]')
      ?.textContent?.includes("সর্বশেষ ব্যাকআপ")
  );
  if (!lastBackupShown) {
    // The daily auto-backup may still be in flight; use the real manual path
    // and stub only the CSV anchor navigation.
    await page.evaluate(() => {
      window.__backupHref = null;
      const original = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (typeof this.href === "string" && this.href.includes("/api/backup")) {
          window.__backupHref = this.href;
          return;
        }
        return original.call(this);
      };
    });
    await page.evaluate(() =>
      document.querySelector('[data-testid="home-backup"]')?.click()
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="home-utilities"]')
          ?.textContent?.includes("সর্বশেষ ব্যাকআপ"),
      { polling: 200, timeout: 20000 }
    );
  }
  const utilities = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="home-utilities"]');
    const text = section?.innerText ?? "";
    return {
      text,
      lastBackup: /সর্বশেষ ব্যাকআপ[:：]?\s*\S+/.test(text),
      online: text.includes("অনলাইন") || text.includes("অফলাইন"),
      refresh: !!section?.querySelector('[data-testid="home-refresh"]'),
      backup: !!section?.querySelector('[data-testid="home-backup"]'),
      restore: !!section?.querySelector('[data-testid="home-restore"]'),
      verified: text.includes("দিনে একবার অটো ব্যাকআপ"),
    };
  });
  check(
    "H7a",
    "utilities expose the real refresh/backup/restore actions and a verifiable stamp",
    utilities.lastBackup &&
      utilities.online &&
      utilities.refresh &&
      utilities.backup &&
      utilities.restore &&
      utilities.verified,
    JSON.stringify({ lastBackup: utilities.lastBackup, online: utilities.online })
  );

  serviceRequests = 0;
  await page.evaluate(() =>
    document.querySelector('[data-testid="home-refresh"]')?.click()
  );
  await sleep(700);
  const afterRefresh = await page.evaluate((name) => ({
    errors: document.body.textContent.includes("লোড করা যায়নি"),
    group: document
      .querySelector('[data-testid="home-recent"]')
      ?.textContent?.includes(name),
  }), GROUP_NAME);
  check(
    "H7b",
    "refresh re-reads the real endpoints without replacing the dashboard",
    serviceRequests >= 1 && afterRefresh.errors === false && afterRefresh.group === true,
    JSON.stringify({ serviceRequests, afterRefresh })
  );

  await page.evaluate(() =>
    document.querySelector('[data-testid="home-restore"]')?.click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন"),
    { polling: 100, timeout: 8000 }
  );
  const restoreText = await page.evaluate(() => document.body.innerText);
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.body.textContent.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন"),
    { polling: 100, timeout: 8000 }
  );
  check(
    "H7c",
    "restore opens the existing confirmation flow and warns before overwriting",
    restoreText.includes("Restore করলে এখনকার data মুছে গিয়ে") &&
      restoreText.includes("safety-copy"),
    ""
  );

  // ---------- H8: mobile layout keeps critical money visible ----------
  await page.setViewport({ width: 390, height: 844 });
  await sleep(350);
  const mobile = await page.evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        visible: el.offsetParent !== null,
      };
    };
    return {
      overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      nav: [...document.querySelectorAll('[data-testid="header-nav"] a')].map((a) =>
        a.textContent.trim()
      ),
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      finance: box('[data-testid="home-money-band"]'),
      dues: box('[data-testid="home-dues"]'),
      financeText: document
        .querySelector('[data-testid="home-money-band"]')
        ?.textContent ?? "",
      duesText:
        document.querySelector('[data-testid="home-dues"]')?.textContent ?? "",
      quick: box('[data-testid="home-quick-actions"]'),
    };
  });
  check(
    "H8a",
    "390px: no horizontal overflow and one three-tab navbar",
    !mobile.overflow &&
      mobile.nav.join(",") === "হোম,সার্ভিস,প্রোডাক্ট" &&
      mobile.h1 === "আজকের ড্যাশবোর্ড",
    JSON.stringify({ overflow: mobile.overflow, nav: mobile.nav })
  );
  check(
    "H8b",
    "390px: today's due and the all-date dues total both stay on screen",
    mobile.finance?.visible &&
      mobile.dues?.visible &&
      mobile.financeText.includes(tk(stats.today.due)) &&
      mobile.duesText.includes(tk(dues.totalDue)) &&
      mobile.finance.right <= 391 &&
      mobile.dues.right <= 391 &&
      mobile.quick?.visible,
    JSON.stringify({
      finance: mobile.finance,
      dues: mobile.dues,
      quick: mobile.quick,
    })
  );

  // ---------- H9: the service deep link really opens the entry form ----------
  await page.goto(`${BASE}/service?date=${TODAY}&mode=service`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="service-tab-form"]', { timeout: 15000 });
  const deepLink = await page.evaluate(() => {
    const tab = document.querySelector('[data-testid="service-tab-form"]');
    const form = document.querySelector("form");
    return {
      pressed: tab?.getAttribute("aria-pressed"),
      formVisible: !!form && form.offsetParent !== null,
      overflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  check(
    "H9",
    "?mode=service lands phones on the real entry form",
    deepLink.pressed === "true" && deepLink.formVisible && !deepLink.overflow,
    JSON.stringify(deepLink)
  );

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-HOME CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
