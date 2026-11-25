/* Landing + Dashboard: `/` opens the Dashboard, the navbar has four
 * destinations, and backup / restore / technician management live there.
 * Service stays a pure front desk with a Dashboard link.
 *
 * Run only through `npm test` (scripts/run-tests.js), which supplies a fresh
 * throwaway database, backup folder and server.
 */
const {
  api,
  closeBrowser,
  dhakaToday,
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

const GROUP_NAME = uniqueName("LandGroup");
const PENDING_NAME = uniqueName("LandPending");
const DONE_NAME = uniqueName("LandDelivered");
const OLD_NAME = uniqueName("LandOverdue");

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

  const get = async (url) => (await api(page, url)).body;
  const post = (url, body) =>
    api(page, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const closeDialog = async () => {
    if (!(await page.$('[role="dialog"]'))) return;
    // Radix's Close button ignores a synthetic `.click()` from page.evaluate.
    // Use a real mouse click on the X, then Escape, then the React handler.
    const marked = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const x = dlg
        ? [...dlg.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Close"
          )
        : null;
      if (!x) return false;
      x.setAttribute("data-testid", "dialog-close-probe");
      return true;
    });
    if (marked) {
      await page.click('[data-testid="dialog-close-probe"]').catch(() => {});
      const gone = await page
        .waitForFunction(() => !document.querySelector('[role="dialog"]'), {
          polling: 100,
          timeout: 2500,
        })
        .then(() => true)
        .catch(() => false);
      if (gone) return;
    }
    await page.keyboard.press("Escape");
    const escaped = await page
      .waitForFunction(() => !document.querySelector('[role="dialog"]'), {
        polling: 100,
        timeout: 2500,
      })
      .then(() => true)
      .catch(() => false);
    if (escaped) return;
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
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
    });
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
      polling: 100,
      timeout: 8000,
    });
  };

  // Start on the app once so relative API calls have a page context.
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });

  const roster = await get("/api/technicians");
  if (!roster.technicians?.some((t) => t.name === "NURUL" && t.isActive)) {
    const added = await post("/api/technicians", { name: "NURUL" });
    if (!added.ok) {
      throw new Error("NURUL not available: " + JSON.stringify(added.body));
    }
  }

  // One multi-device visit (In-Progress + Completed) and three singles that
  // exercise Pending, Delivered and the cross-date overdue backlog.
  const batch = await post("/api/services/batch", {
    customerName: GROUP_NAME,
    phone: "01711110001",
    technician: "NURUL",
    serviceDate: TODAY,
    devices: [
      {
        model: "Land Group A",
        problem: "Display dead",
        totalBill: 3000,
        advance: 1000,
        status: "In-Progress",
        deliveryDate: TODAY,
      },
      {
        model: "Land Group B",
        problem: "Battery swap",
        totalBill: 2000,
        advance: 2000,
        status: "Completed",
        deliveryDate: TODAY,
      },
    ],
  });
  if (!batch.ok) {
    throw new Error("batch seed failed: " + JSON.stringify(batch.body));
  }

  const pending = await post("/api/services", {
    customerName: PENDING_NAME,
    phone: "01711110002",
    model: "Land Pending",
    technician: "NURUL",
    problem: "Charging port",
    totalBill: 1200,
    advance: 200,
    status: "Pending",
    serviceDate: TODAY,
    deliveryDate: TODAY,
  });
  if (!pending.ok) {
    throw new Error("pending seed failed: " + JSON.stringify(pending.body));
  }

  const done = await post("/api/services", {
    customerName: DONE_NAME,
    phone: "01711110003",
    model: "Land Done",
    technician: "NURUL",
    problem: "Speaker",
    totalBill: 900,
    advance: 900,
    status: "Delivered",
    serviceDate: TODAY,
    deliveryDate: TODAY,
  });
  if (!done.ok) {
    throw new Error("delivered seed failed: " + JSON.stringify(done.body));
  }

  const old = await post("/api/services", {
    customerName: OLD_NAME,
    phone: "01711110004",
    model: "Land Old",
    technician: "NURUL",
    problem: "Water damage",
    totalBill: 800,
    advance: 100,
    status: "Pending",
    serviceDate: YESTERDAY,
    deliveryDate: LONG_AGO,
  });
  if (!old.ok) {
    throw new Error("overdue seed failed: " + JSON.stringify(old.body));
  }

  // ---------- L0: `/` lands on the Dashboard ----------
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', {
    timeout: 15000,
  });

  const landing = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    const nav = document.querySelector('[data-testid="header-nav"]');
    const brand = header?.querySelector("a[aria-label]");
    return {
      path: location.pathname,
      search: location.search,
      h1: document.querySelector("h1")?.textContent?.trim() ?? "",
      navLinks: [...(nav?.querySelectorAll("a") || [])].map((a) =>
        a.textContent.trim()
      ),
      navItems: [...(nav?.querySelectorAll("a") || [])].map((a) =>
        a.getAttribute("data-nav-item")
      ),
      brandHref: brand?.getAttribute("href") ?? null,
      brandLabel: brand?.getAttribute("aria-label") ?? "",
      rootLinks: document.querySelectorAll('a[href="/"]').length,
      hasDashboard: !!document.querySelector('[data-testid="dashboard-overview"]'),
    };
  });
  console.log("reached L0", JSON.stringify(landing));
  check(
    "L0",
    "/ opens the Dashboard with no query loss",
    landing.path === "/dashboard" &&
      landing.search === "" &&
      landing.h1 === "ড্যাশবোর্ড" &&
      landing.hasDashboard,
    JSON.stringify(landing)
  );
  check(
    "L1",
    "navbar has Dashboard + Service + Product + Parts, no root link",
    landing.navLinks.join(",") === "ড্যাশবোর্ড,সার্ভিস,প্রোডাক্ট,পার্টস" &&
      landing.navItems.join(",") === "dashboard,service,products,parts" &&
      landing.rootLinks === 0,
    JSON.stringify({ links: landing.navLinks, items: landing.navItems })
  );
  check(
    "L2",
    "brand points straight at /dashboard",
    landing.brandHref === "/dashboard" &&
      landing.brandLabel.includes("ড্যাশবোর্ড"),
    JSON.stringify({ href: landing.brandHref, label: landing.brandLabel })
  );

  // ---------- L3: `/` keeps a bookmarked date + status ----------
  await page.goto(`${BASE}/?date=${YESTERDAY}&status=Pending`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForFunction(
    (day) =>
      document.querySelector('[data-testid="daily-services"]')?.dataset.date ===
      day,
    { polling: 200, timeout: 15000 },
    YESTERDAY
  );
  const deep = await page.evaluate(() => {
    const chip = [
      ...document.querySelectorAll('[data-testid="daily-services"] button'),
    ].find((b) => b.textContent.trim().startsWith("পেন্ডিং"));
    return {
      path: location.pathname,
      search: location.search,
      date:
        document.querySelector('[data-testid="daily-services"]')?.dataset.date ??
        null,
      activeChip: chip ? chip.classList.contains("bg-maher-navy") : false,
      text:
        document.querySelector('[data-testid="daily-services"]')?.textContent ??
        "",
    };
  });
  console.log("reached L3", JSON.stringify(deep));
  check(
    "L3",
    "root deep link forwards date and status to /service",
    deep.path === "/service" &&
      deep.search.includes(`date=${YESTERDAY}`) &&
      deep.search.includes("status=Pending") &&
      deep.date === YESTERDAY &&
      deep.activeChip &&
      deep.text.includes(OLD_NAME),
    JSON.stringify({
      path: deep.path,
      search: deep.search,
      date: deep.date,
      chip: deep.activeChip,
    })
  );

  // ---------- Dashboard: overview, backup, restore, technician manager ----------
  await page.goto(`${BASE}/dashboard`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="dashboard-overview"]', {
    timeout: 15000,
  });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="dashboard-overview"]')
        ?.textContent?.includes("লোড হচ্ছে"),
    { polling: 200, timeout: 20000 }
  );

  // ---------- L4: overview cards are backed by the live stats API ----------
  const stats = await get("/api/stats");
  const overview = await page.evaluate(() => ({
    today: document.querySelector('[data-testid="dashboard-today"]')?.textContent ?? "",
    finance:
      document.querySelector('[data-testid="dashboard-finance"]')?.textContent ?? "",
    lowStock:
      document.querySelector('[data-testid="dashboard-low-stock"]')?.textContent ?? "",
  }));
  const statsCount = String(stats.today?.count ?? 0);
  check(
    "L4",
    "dashboard overview reflects the live stats/API data",
    overview.today.includes(statsCount) &&
      overview.finance.includes("কাস্টমার বাকি") &&
      overview.lowStock.length > 0,
    JSON.stringify({ statsCount, overview })
  );

  // ---------- L5: the export picker downloads an Excel copy ----------
  await page.evaluate(() => {
    window.__backupDownload = null;
    window.__backupFetch = null;
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (url.includes("/api/backup?format=xlsx")) window.__backupFetch = url;
      return originalFetch(...args);
    };
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (typeof this.download === "string" && this.download.endsWith(".xlsx")) {
        window.__backupDownload = this.download;
        return;
      }
      return original.call(this);
    };
  });
  await page.click('[data-testid="dashboard-backup"]');
  await page.waitForSelector('[data-testid="export-excel"]', {
    visible: true,
    timeout: 15000,
  });
  await page.click('[data-testid="export-excel"]');
  await page.waitForFunction(
    () => typeof window.__backupDownload === "string",
    { polling: 200, timeout: 20000 }
  );
  await page.waitForFunction(
    () => {
      const stamp = document
        .querySelector('[data-testid="dashboard-last-backup"]')
        ?.textContent?.trim();
      return !!stamp && stamp !== "এখনো নেই";
    },
    { polling: 300, timeout: 20000 }
  );
  // Radix keeps the dialog mounted for its 200ms exit animation. Wait for the
  // overlay to unmount before clicking the next dashboard action, otherwise
  // the click lands on the closing overlay instead of Restore.
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="export-excel"]'),
    { polling: 100, timeout: 5000 }
  );
  const backup = await page.evaluate(() => ({
    download: window.__backupDownload,
    fetch: window.__backupFetch,
    stamp: document
      .querySelector('[data-testid="dashboard-last-backup"]')
      ?.textContent?.trim(),
  }));
  console.log("reached L5", JSON.stringify(backup));
  check(
    "L5",
    "dashboard backup picker downloads Excel and updates Last Backup",
    typeof backup.download === "string" &&
      backup.download.startsWith("mss-backup-") &&
      backup.download.endsWith(".xlsx") &&
      typeof backup.fetch === "string" &&
      !!backup.stamp &&
      backup.stamp !== "এখনো নেই",
    JSON.stringify(backup)
  );

  // ---------- L6: restore still requires its confirmation click ----------
  await page.click('[data-testid="dashboard-restore"]');
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="dialog"]')].some((dlg) =>
        dlg.textContent?.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন")
      ),
    { polling: 200, timeout: 15000 }
  );
  await page.waitForFunction(
    () => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
        d.textContent?.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন")
      );
      return (
        !!dlg &&
        [...dlg.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Restore"
        )
      );
    },
    { polling: 200, timeout: 15000 }
  );
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].find((d) =>
      d.textContent?.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন")
    );
    const btn = dlg
      ? [...dlg.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Restore"
        )
      : null;
    btn?.click();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="dialog"]')].some((dlg) =>
        dlg.textContent?.includes("নিশ্চিত?")
      ),
    { polling: 200, timeout: 10000 }
  );
  const armed = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].some((dlg) =>
      dlg.textContent?.includes("নিশ্চিত?")
    )
  );
  await closeDialog();
  check("L6", "restore opens from Dashboard and asks for confirmation", armed);

  // ---------- L7: technician manager lives on Dashboard, not Service ----------
  await page.click('[data-testid="dashboard-open-technician-manager"]');
  await page.waitForSelector('[data-testid="tech-manager"]', { timeout: 15000 });
  const tech = await page.evaluate(
    () => !!document.querySelector('[data-testid="tech-manager"]')
  );
  await closeDialog();
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="daily-services"]', { timeout: 15000 });
  const desk = await page.evaluate(() => ({
    dashboardLink: !!document.querySelector('[data-testid="service-dashboard-link"]'),
    removed: [
      "open-report",
      "open-dues",
      "open-technician-manager",
      "service-utilities",
    ].filter((id) => !!document.querySelector(`[data-testid="${id}"]`)),
  }));
  check(
    "L7",
    "technician manager is on Dashboard; Service has no masthead buttons",
    tech &&
      !desk.dashboardLink &&
      desk.removed.length === 0,
    JSON.stringify({ tech, desk })
  );

  // ---------- L8: 390px still fits, with four tabs ----------
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="dashboard-overview"]', {
    timeout: 15000,
  });
  const mobile = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="header-nav"]');
    const overview = document.querySelector('[data-testid="dashboard-overview"]');
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    };
    return {
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      nav: [...(nav?.querySelectorAll("a") || [])].map((a) =>
        a.textContent.trim()
      ),
      overview: rect(overview),
    };
  });
  console.log("reached L8", JSON.stringify(mobile));
  check(
    "L8",
    "390px: four tabs, no overflow, dashboard overview fits the viewport",
    !mobile.overflow &&
      mobile.nav.join(",") === "ড্যাশবোর্ড,সার্ভিস,প্রোডাক্ট,পার্টস" &&
      !!mobile.overview &&
      mobile.overview.left >= 0 &&
      mobile.overview.right <= 391,
    JSON.stringify(mobile)
  );

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-LANDING CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
