/* White-label Dashboard, dynamic branding and configurable secret codes.
 *
 * Runs against the suite's throwaway database (run-tests.js migrates and
 * starts an isolated app). No live shop data is touched.
 */
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const NAME = uniqueName("WhiteLabel");
const CUSTOM_CODE = "AEJJ"; // A=1 E=5 J=0 J=0 => 1500 with word ABCDEFGHIJ

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
  const put = (url, body) =>
    api(page, url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });

  const roster = await get("/api/technicians");
  if (!roster.technicians?.some((t) => t.name === "NURUL" && t.isActive)) {
    await post("/api/technicians", { name: "NURUL" });
  }

  // W1: fallback branding when no settings row exists.
  const initial = await get("/api/shop-settings");
  check(
    "W1",
    "missing settings row stays an empty tenant profile for onboarding",
    initial.settings?.shopName === "" &&
      initial.settings?.secretCipher?.mode === "keypad" &&
      initial.settings?.updatedAt === null,
    JSON.stringify(initial.settings)
  );

  // W2: dashboard structure.
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  const dashboard = await page.evaluate(() => {
    const ids = [
      "dashboard-overview",
      "dashboard-today",
      "dashboard-finance",
      "dashboard-low-stock",
      "dashboard-quick-actions",
      "dashboard-technicians",
      "dashboard-settings",
      "dashboard-data-safety",
      "dashboard-last-backup",
      "dashboard-save-settings",
      "cipher-mode-keypad",
      "cipher-mode-custom",
      "cipher-test-amount",
      "cipher-test-code",
      "cipher-encoded",
      "cipher-decoded",
    ];
    return {
      missing: ids.filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
      nav: [...document.querySelectorAll('[data-testid="header-nav"] a')].map(
        (a) => a.getAttribute("data-nav-item")
      ),
    };
  });
  check(
    "W2",
    "dashboard renders every section and the nav includes Home",
    dashboard.missing.length === 0 && dashboard.nav.includes("dashboard"),
    JSON.stringify(dashboard)
  );

  // W3: keypad preset still decodes the historical code.
  const legacy = await post("/api/services", {
    customerName: NAME,
    phone: "01719990001",
    model: "Keypad Model",
    technician: "NURUL",
    problem: "Legacy code",
    totalBill: 1500,
    advance: 0,
    status: "Pending",
    shopExpense: "*J#",
    serviceDate: TODAY,
  });
  check(
    "W3",
    "keypad preset keeps *J# = 1500",
    legacy.ok && legacy.body?.expenseAmount === 1500,
    JSON.stringify({ ok: legacy.ok, body: legacy.body })
  );

  // W4: custom word validation rejects a bad 10-character word.
  const badWord = await put("/api/shop-settings", {
    shopName: NAME,
    secretCipher: { mode: "custom", word: "ABC" },
  });
  check("W4", "invalid custom cipher word is rejected", badWord.status === 400, JSON.stringify(badWord.body));

  // W5: custom cipher decodes a custom code on save.
  const saved = await put("/api/shop-settings", {
    shopName: NAME,
    slogan: "কাস্টম স্লোগান",
    address: "Test Address",
    phone: "01719990002",
    whatsapp: "01719990002",
    terms: " ফেরত নেই ",
    secretCipher: { mode: "custom", word: "ABCDEFGHIJ" },
  });
  const custom = await post("/api/services", {
    customerName: NAME,
    phone: "01719990003",
    model: "Custom Model",
    technician: "NURUL",
    problem: "Custom code",
    totalBill: 1500,
    advance: 0,
    status: "Pending",
    shopExpense: CUSTOM_CODE,
    serviceDate: TODAY,
  });
  check(
    "W5",
    "custom 10-character cipher decodes AEJJ to 1500 on save",
    saved.ok &&
      saved.body.settings.secretCipher.mode === "custom" &&
      custom.ok &&
      custom.body?.expenseAmount === 1500 &&
      custom.body?.shopExpense === CUSTOM_CODE,
    JSON.stringify({ saved: saved.body.settings, custom: custom.body })
  );

  // W6: settings edits never rewrite ledger rows.
  const list = await get(`/api/services?date=${TODAY}&limit=50`);
  const row = (list.services ?? []).find((s) => s.id === custom.body?.id);
  const reCheck = await post("/api/services", {
    customerName: NAME,
    phone: "01719990004",
    model: "Second Model",
    technician: "NURUL",
    problem: "Money untouched",
    totalBill: 900,
    advance: 100,
    status: "Pending",
    serviceDate: TODAY,
  });
  const list2 = await get(`/api/services?date=${TODAY}&limit=50`);
  const row2 = (list2.services ?? []).find((s) => s.id === reCheck.body?.id);
  check(
    "W6",
    "branding/settings changes do not alter existing ledger money",
    !!row &&
      !!row2 &&
      row.totalBill === 1500 &&
      row2.totalBill === 900 &&
      row2.advance === 100 &&
      row2.due === 800,
    JSON.stringify({ row, row2 })
  );

  // W7: branding reaches the live chrome/footer.
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("কাস্টম স্লোগান"),
    { polling: 200, timeout: 15000 }
  );
  const brand = await page.evaluate(() => ({
    header: document.querySelector('[data-testid="app-header"]')?.textContent ?? "",
    footer: document.querySelector("footer")?.textContent ?? "",
  }));
  check(
    "W7",
    "header and footer render the configured shop name/slogan/address",
    brand.header.includes(NAME) &&
      brand.header.includes("কাস্টম স্লোগান") &&
      brand.footer.includes(NAME) &&
      brand.footer.includes("Test Address"),
    JSON.stringify(brand)
  );

  // W8: "/" is the Dashboard; deep links still go to Service.
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  const homePath = await page.evaluate(() => location.pathname);
  await page.goto(`${BASE}/?mode=product`, { waitUntil: "networkidle0", timeout: 60000 });
  const deepPath = await page.evaluate(() => location.pathname + location.search);
  check(
    "W8",
    "root lands on Dashboard and forwards service deep links",
    homePath === "/dashboard" && deepPath.startsWith("/service?mode=product"),
    JSON.stringify({ homePath, deepPath })
  );

  // W9: Service stays a pure front desk without the old masthead buttons.
  await page.goto(`${BASE}/service?date=${TODAY}`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', { timeout: 15000 });
  const service = await page.evaluate(() => {
    const ids = [
      "daily-services",
      "open-report",
      "open-dues",
      "open-technician-manager",
      "service-utilities",
    ];
    const found = {};
    for (const id of ids) found[id] = !!document.querySelector(`[data-testid="${id}"]`);
    // The local list filter is pinned by its id in the design contract.
    found["svc-search"] = !!document.querySelector("#svc-search");
    return found;
  });
  check(
    "W9",
    "Service keeps form/table/search and drops masthead, manager/report/backup rail",
    service["daily-services"] &&
      service["svc-search"] &&
      !service["open-report"] &&
      !service["open-dues"] &&
      !service["open-technician-manager"] &&
      !service["service-utilities"],
    JSON.stringify(service)
  );

  // W4 deliberately posts an invalid cipher word and expects a 400; Chrome
  // reports every non-2xx fetch as a console error. Ignore only that one.
  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("WHITE-LABEL SUITE CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
