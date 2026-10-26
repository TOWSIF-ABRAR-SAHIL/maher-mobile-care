/* Landing + Service utilities: `/` redirects to the Service desk, the navbar
 * has exactly two destinations, and refresh / backup / restore still live on
 * the Service page.
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const open = await page.$('[role="dialog"]');
    if (!open) return;
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const close = dlg
        ? [...dlg.querySelectorAll("button")].find(
            (b) => b.textContent.trim() === "Close"
          )
        : null;
      close?.click();
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

  // ---------- L0: `/` lands on the Service desk ----------
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) =>
      document
        .querySelector('[data-testid="daily-services"]')
        ?.textContent?.includes(name),
    { polling: 200, timeout: 30000 },
    PENDING_NAME
  );
  await page.waitForFunction(
    (day) =>
      document.querySelector('[data-testid="daily-services"]')?.dataset.date ===
      day,
    { polling: 200, timeout: 10000 },
    TODAY
  );

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
      stageLine:
        document.body.textContent.includes("আজকের ধাপ") ||
        !!document.querySelector('[data-testid="service-stage-line"]'),
      hasUtilities: !!document.querySelector(
        '[data-testid="service-utilities"]'
      ),
    };
  });
  console.log("reached L0", JSON.stringify(landing));
  check(
    "L0",
    "/ redirects to the Service desk with no query loss",
    landing.path === "/service" &&
      landing.search === "" &&
      landing.h1 === "" &&
      !landing.stageLine &&
      landing.hasUtilities,
    JSON.stringify(landing)
  );
  check(
    "L1",
    "navbar has exactly Service + Product, no Home",
    landing.navLinks.join(",") === "সার্ভিস,প্রোডাক্ট" &&
      landing.navItems.join(",") === "service,products" &&
      landing.rootLinks === 0,
    JSON.stringify({ links: landing.navLinks, items: landing.navItems })
  );
  check(
    "L2",
    "brand points straight at /service",
    landing.brandHref === "/service" &&
      landing.brandLabel.includes("সার্ভিস"),
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

  // Back to today's full desk for the utility checks.
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="service-utilities"]', {
    timeout: 15000,
  });

  // ---------- L4: refresh hits the existing day endpoint ----------
  const refreshed = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes(`/api/services?date=${TODAY}`) && res.status() === 200,
      { timeout: 20000 }
    ),
    page.click('[data-testid="service-refresh"]'),
  ]).then(([res]) => res.ok());
  await sleep(300);
  check("L4", "service refresh reloads the day", refreshed);

  // ---------- L5: backup snapshot + CSV anchor + stamp ----------
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
  await page.click('[data-testid="service-backup"]');
  await page.waitForFunction(() => typeof window.__backupHref === "string", {
    polling: 200,
    timeout: 20000,
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="service-utilities"]')
        ?.textContent?.includes("সর্বশেষ ব্যাকআপ"),
    { polling: 300, timeout: 20000 }
  );
  const backup = await page.evaluate(() => {
    const section = document.querySelector('[data-testid="service-utilities"]');
    return {
      href: window.__backupHref,
      label: [...(section?.querySelectorAll("p") || [])].find((p) =>
        p.textContent.includes("সর্বশেষ ব্যাকআপ")
      )?.textContent,
    };
  });
  console.log("reached L5", JSON.stringify(backup));
  check(
    "L5",
    "backup toast stamp + CSV anchor update in place",
    typeof backup.href === "string" &&
      backup.href.includes("/api/backup") &&
      !!backup.label,
    JSON.stringify(backup)
  );

  // ---------- L6: restore still requires its confirmation click ----------
  await page.click('[data-testid="service-restore"]');
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes("ব্যাকআপ থেকে ফিরিয়ে আনুন"),
    { polling: 200, timeout: 15000 }
  );
  await page.waitForFunction(
    () => {
      const dlg = document.querySelector('[role="dialog"]');
      return !!dlg &&
        [...dlg.querySelectorAll("button")].some(
          (b) => b.textContent.trim() === "Restore"
        );
    },
    { polling: 200, timeout: 15000 }
  );
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const btn = dlg
      ? [...dlg.querySelectorAll("button")].find(
          (b) => b.textContent.trim() === "Restore"
        )
      : null;
    btn?.click();
  });
  await page.waitForFunction(
    () =>
      document
        .querySelector('[role="dialog"]')
        ?.textContent?.includes("নিশ্চিত?"),
    { polling: 200, timeout: 10000 }
  );
  const armed = await page.evaluate(
    () =>
      document.querySelector('[role="dialog"]')?.textContent?.includes("নিশ্চিত?") ??
      false
  );
  await closeDialog();
  check("L6", "restore opens from Service and asks for confirmation", armed);

  // ---------- L7: report / dues / technician dialogs still open ----------
  const dialogs = {};
  for (const [button, testid, key] of [
    ["open-report", "report-dialog", "report"],
    ["open-dues", "dues-dialog", "dues"],
    ["open-technician-manager", "tech-manager", "tech"],
  ]) {
    await page.click(`[data-testid="${button}"]`);
    await page.waitForSelector(`[data-testid="${testid}"]`, { timeout: 15000 });
    dialogs[key] = await page.evaluate(
      (selector) => !!document.querySelector(selector),
      `[data-testid="${testid}"]`
    );
    await closeDialog();
  }
  check(
    "L7",
    "report, dues and technician manager stay on Service",
    dialogs.report && dialogs.dues && dialogs.tech,
    JSON.stringify(dialogs)
  );

  // ---------- L8: 390px still fits ----------
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="service-utilities"]', {
    timeout: 15000,
  });
  const mobile = await page.evaluate(() => {
    const nav = document.querySelector('[data-testid="header-nav"]');
    const utils = document.querySelector('[data-testid="service-utilities"]');
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
      stageLine:
        document.body.textContent.includes("আজকের ধাপ") ||
        !!document.querySelector('[data-testid="service-stage-line"]'),
      utilities: rect(utils),
    };
  });
  console.log("reached L8", JSON.stringify(mobile));
  check(
    "L8",
    "390px: two tabs, no stage line, utilities fit the viewport",
    !mobile.overflow &&
      mobile.nav.join(",") === "সার্ভিস,প্রোডাক্ট" &&
      !mobile.stageLine &&
      !!mobile.utilities &&
      mobile.utilities.left >= 0 &&
      mobile.utilities.right <= 391,
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
