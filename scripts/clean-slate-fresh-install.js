/* Fresh-install clean-slate contract.
 *
 * A migrated but untouched database must contain no seeded shop identity and
 * no demo ledger/inventory/debt rows. The dashboard must therefore open on the
 * onboarding banner with all four counters at zero. Runs only on the throwaway
 * database created by scripts/run-tests.js — never on prisma/dev.db or the
 * shop's live data.
 */
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  launchBrowser,
  resolveTestBase,
  trackErrors,
} = require("./test-support");

const BASE = resolveTestBase();
const DB_FILE = process.env.MAHER_DB_PATH;

if (!DB_FILE || path.basename(DB_FILE) !== process.env.MAHER_TEST_DB_FILE) {
  throw new Error("clean-slate-fresh-install must run only on the suite throwaway DB");
}

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

/** Every table the product can seed — including the optional tenant profile. */
const TABLES = [
  "Service",
  "Technician",
  "ProductCategory",
  "Product",
  "SaleItem",
  "StockMovement",
  "ServicePart",
  "Payment",
  "PaymentAllocation",
  "Purchase",
  "PurchaseItem",
  "PurchasePayment",
  "PurchasePaymentAllocation",
  "ShopSettings",
];

function readDb(fn) {
  const db = new Database(DB_FILE, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

let browser = null;

(async () => {
  const tables = readDb((db) =>
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
  );
  const missingTables = TABLES.filter((name) => !tables.includes(name));
  check(
    "CS1",
    "fresh SQLite schema carries every ledger, inventory and profile table",
    missingTables.length === 0,
    missingTables.length ? missingTables.join(", ") : `${TABLES.length} tables`
  );

  const counts = readDb((db) =>
    Object.fromEntries(
      TABLES.map((name) => [
        name,
        db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n,
      ])
    )
  );
  const seeded = Object.entries(counts).filter(([, n]) => n !== 0);
  check(
    "CS2",
    "migrations seed no services, debts, demo inventory, staff or shop profile",
    seeded.length === 0,
    JSON.stringify(seeded.length ? seeded : counts)
  );

  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  const get = async (url) => (await api(page, url)).body;

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="dashboard-overview"]')
        ?.textContent?.includes("লোড হচ্ছে"),
    { polling: 200, timeout: 20000 }
  );

  const settingsResult = await api(page, "/api/shop-settings");
  const settings = settingsResult.body.settings ?? {};
  check(
    "CS3",
    "empty API profile has no customer-facing shop identity",
    settingsResult.ok &&
      settings.shopName === "" &&
      settings.slogan === "" &&
      settings.address === "" &&
      settings.phone === "" &&
      settings.whatsapp === "" &&
      settings.terms === "" &&
      settings.logoPath === null &&
      settings.secretCipher?.mode === "keypad" &&
      settings.updatedAt === null,
    JSON.stringify(settings)
  );

  const allServices = await get("/api/services?all=1");
  const archivedServices = await get("/api/services?archived=true");
  check(
    "CS4",
    "service ledger and restore archive are both empty",
    allServices.mode === "all" &&
      allServices.total === 0 &&
      allServices.shown === 0 &&
      allServices.services?.length === 0 &&
      archivedServices.archived === true &&
      archivedServices.services?.length === 0,
    JSON.stringify({
      total: allServices.total,
      shown: allServices.shown,
      archived: archivedServices.services?.length,
    })
  );

  const technicians = await get("/api/technicians?all=true");
  const products = await get("/api/products");
  check(
    "CS5",
    "no demo technicians, products or categories are exposed",
    technicians.count === 0 &&
      technicians.technicians?.length === 0 &&
      products.summary?.totalProducts === 0 &&
      products.summary?.categories === 0 &&
      products.products?.length === 0,
    JSON.stringify({
      technicians: technicians.count,
      products: products.summary?.totalProducts,
      categories: products.summary?.categories,
    })
  );

  const dues = await get("/api/services/dues");
  const purchases = await get("/api/purchases");
  const parts = await get("/api/service-parts?status=unpaid");
  check(
    "CS6",
    "customer and supplier debt APIs both report zero",
    dues.count === 0 &&
      dues.totalDue === 0 &&
      dues.services?.length === 0 &&
      purchases.summary?.due === 0 &&
      parts.summary?.unpaidTotal === 0,
    JSON.stringify({
      customerDue: dues.totalDue,
      customerCount: dues.count,
      supplierPurchaseDue: purchases.summary?.due,
      supplierPartsDue: parts.summary?.unpaidTotal,
    })
  );

  const onboarding = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="shop-onboarding-banner"]');
    return {
      present: !!banner,
      // The icon sits on its own line; normalize whitespace before comparing.
      text: (banner?.innerText ?? "").replace(/\s+/g, " ").trim(),
      setup: !!document.querySelector('[data-testid="shop-onboarding-setup"]'),
      dismiss: !!document.querySelector('[data-testid="shop-onboarding-dismiss"]'),
    };
  });
  check(
    "CS7",
    "untouched install shows the exact onboarding banner and both actions",
    onboarding.present &&
      onboarding.setup &&
      onboarding.dismiss &&
      onboarding.text.includes(
        "🏬 স্বাগতম! আপনার দোকানের নাম ও প্রাথমিক তথ্য সেটআপ করে নিন"
      ) &&
      onboarding.text.includes(
        "কাস্টমার রিসিট ও বিল ভাউচারে আপনার সঠিক নাম, মোবাইল ও ঠিকানা প্রিন্ট করতে শপ প্রোফাইলটি সংরক্ষণ করুন।"
      ) &&
      onboarding.text.includes("✏️ শপ প্রোফাইল সেটআপ করুন") &&
      onboarding.text.includes("পরে করব ✕"),
    JSON.stringify(onboarding)
  );

  const cards = await page.evaluate(() => {
    const card = (id) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      return {
        value: root?.querySelector("p")?.textContent?.trim() ?? "",
        text: (root?.innerText ?? "").replace(/\s+/g, " ").trim(),
      };
    };
    return {
      today: card("dashboard-today"),
      finance: card("dashboard-finance"),
      payables: card("dashboard-payables"),
      inventory: card("dashboard-inventory"),
    };
  });
  check(
    "CS8",
    "dashboard money and stock counters all start at zero",
    cards.today.value === "৳0" &&
      cards.today.text.includes("নতুন সার্ভিস 0") &&
      cards.finance.value === "৳0" &&
      cards.finance.text.includes("0টি ডিভাইস") &&
      cards.payables.value === "৳0" &&
      cards.inventory.value === "0",
    JSON.stringify(cards)
  );

  const chrome = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText,
  }));
  check(
    "CS9",
    "empty profile renders MSS platform chrome, never the legacy shop name",
    chrome.title === "MSS (Mobile Service System)" &&
      chrome.text.includes("MSS - শপ প্রোফাইল সেটআপ করুন") &&
      !chrome.title.includes("MAHER MOBILE CARE") &&
      !chrome.text.includes("MAHER MOBILE CARE") &&
      !chrome.text.includes("Nabinagar, Ashulia 1344"),
    JSON.stringify({ title: chrome.title, hasMssHint: chrome.text.includes("MSS - শপ প্রোফাইল সেটআপ করুন") })
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check(
    "CS10",
    "zero unexpected JS errors on a fresh install",
    realErrors.length === 0,
    realErrors.slice(0, 3).join(" | ")
  );

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("CLEAN-SLATE SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
