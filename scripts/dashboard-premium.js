/* Premium Dashboard & Settings contract.
 *
 * Pins the four separated financial metrics, the visual keypad matrix, the
 * money/code converter, the two-zone layout, the four quick-action tiles and
 * the local logo preview. Runs only on a throwaway database via npm test.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  api,
  closeBrowser,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dhaka",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};
const money = (n) => `৳${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;
const bnMoney = (n) =>
  `৳${String(Math.round(Number(n) || 0).toLocaleString("en-IN")).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])}`;

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);
  const get = async (url) => (await api(page, url)).body;
  // The shared waitToast helper forgets to forward its text argument, so this
  // suite waits for the exact Bengali toast text itself.
  const waitText = (text) =>
    page.waitForFunction(
      (t) => document.body.textContent.includes(t),
      { polling: 200, timeout: 8000 },
      text
    );

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  await page.waitForFunction(
    () =>
      !document
        .querySelector('[data-testid="dashboard-overview"]')
        ?.textContent?.includes("লোড হচ্ছে"),
    { polling: 200, timeout: 20000 }
  );

  // ---------- OB. First-time shop profile onboarding ----------
  const onboarding = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="shop-onboarding-banner"]');
    return {
      present: !!banner,
      className: banner?.className ?? "",
      text: banner?.innerText ?? "",
      setup: !!document.querySelector('[data-testid="shop-onboarding-setup"]'),
      dismiss: !!document.querySelector('[data-testid="shop-onboarding-dismiss"]'),
    };
  });
  check(
    "OB1",
    "fresh install shows the soft-amber onboarding banner with exact copy and actions",
    onboarding.present &&
      [
        "bg-gradient-to-r", "from-amber-50", "to-orange-50", "border",
        "border-amber-200/90", "rounded-2xl", "p-4", "shadow-sm", "mb-6",
        "flex", "flex-col", "md:flex-row", "items-center", "justify-between", "gap-4",
      ].every((name) => onboarding.className.includes(name)) &&
      onboarding.text.includes("🏬") &&
      onboarding.text.includes("স্বাগতম! আপনার দোকানের নাম ও প্রাথমিক তথ্য সেটআপ করে নিন") &&
      onboarding.text.includes(
        "কাস্টমার রিসিট ও বিল ভাউচারে আপনার সঠিক নাম, মোবাইল ও ঠিকানা প্রিন্ট করতে শপ প্রোফাইলটি সংরক্ষণ করুন।"
      ) &&
      onboarding.text.includes("✏️ শপ প্রোফাইল সেটআপ করুন") &&
      onboarding.text.includes("পরে করব ✕") &&
      onboarding.setup &&
      onboarding.dismiss,
    JSON.stringify(onboarding)
  );

  const onboardingPlacement = await page.evaluate(() => {
    const banner = document.querySelector('[data-testid="shop-onboarding-banner"]');
    const overview = document.querySelector('[data-testid="dashboard-overview"]');
    const quick = document.querySelector('[data-testid="dashboard-quick-actions"]');
    if (!banner || !overview || !quick) return null;
    const b = banner.getBoundingClientRect();
    const o = overview.getBoundingClientRect();
    const q = quick.getBoundingClientRect();
    return {
      afterOverview: b.top >= o.bottom - 1,
      beforeQuick: b.bottom <= q.top + 1,
      order: [overview.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING,
        banner.compareDocumentPosition(quick) & Node.DOCUMENT_POSITION_FOLLOWING],
    };
  });
  check(
    "OB5",
    "onboarding banner sits between Dashboard Overview and Quick Actions",
    !!onboardingPlacement &&
      onboardingPlacement.afterOverview &&
      onboardingPlacement.beforeQuick &&
      onboardingPlacement.order.every((bit) => bit !== 0),
    JSON.stringify(onboardingPlacement)
  );

  const setupClicked = await page
    .$('[data-testid="shop-onboarding-setup"]')
    .then((el) => !!el && el.click().then(() => true))
    .catch(() => false);
  const focusReady = await page
    .waitForFunction(
      () => {
        const input = document.querySelector('[data-testid="setting-shop-name"]');
        if (!input) return false;
        const top = input.getBoundingClientRect().top;
        return document.activeElement === input && top >= 0 && top < window.innerHeight;
      },
      { polling: 100, timeout: 5000 }
    )
    .then(() => true)
    .catch(() => false);
  const focusState = await page.evaluate(() => {
    const input = document.querySelector('[data-testid="setting-shop-name"]');
    return {
      activeId: document.activeElement?.id ?? "",
      className: input?.className ?? "",
      top: input?.getBoundingClientRect().top ?? null,
    };
  });
  check(
    "OB2",
    "setup action scrolls to and focuses দোকানের নাম with a highlight pulse",
    setupClicked &&
      focusReady &&
      focusState.activeId === "setting-shop-name" &&
      focusState.className.includes("ring-2") &&
      focusState.className.includes("animate-pulse") &&
      focusState.top !== null &&
      focusState.top >= 0 &&
      focusState.top < 900,
    JSON.stringify({ setupClicked, focusReady, ...focusState })
  );

  const dismissClicked = await page
    .$('[data-testid="shop-onboarding-dismiss"]')
    .then((el) => !!el && el.click().then(() => true))
    .catch(() => false);
  await page
    .waitForFunction(
      () => !document.querySelector('[data-testid="shop-onboarding-banner"]'),
      { polling: 100, timeout: 3000 }
    )
    .catch(() => {});
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  const dismissedAfterReload = !(await page.$('[data-testid="shop-onboarding-banner"]'));
  const otherTab = await browser.newPage();
  await otherTab.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  const visibleInOtherTab = !!(await otherTab.$('[data-testid="shop-onboarding-banner"]'));
  await otherTab.close();
  check(
    "OB3",
    "dismiss hides the banner for this session only (a new tab still sees it)",
    dismissClicked && dismissedAfterReload && visibleInOtherTab,
    JSON.stringify({ dismissClicked, dismissedAfterReload, visibleInOtherTab })
  );

  const [stats, dues, purchases, parts, products] = await Promise.all([
    get("/api/stats"),
    get("/api/services/dues"),
    get("/api/purchases"),
    get("/api/service-parts?status=unpaid"),
    get("/api/products"),
  ]);
  const todayCash = stats?.today?.advance ?? 0;
  const customerDues = dues?.totalDue ?? 0;
  const supplierDebts =
    (purchases?.summary?.due ?? 0) + (parts?.summary?.unpaidTotal ?? 0);
  const lowStockCount = products?.summary?.lowStock ?? 0;

  // ---------- P1: four distinct, correctly sided financial cards ----------
  const cards = await page.evaluate(() => {
    const text = (id) => document.querySelector(`[data-testid="${id}"]`)?.innerText ?? "";
    const metrics = document.querySelector('[data-testid="dashboard-metrics"]');
    const finance = document.querySelector('[data-testid="dashboard-finance"]');
    const payables = document.querySelector('[data-testid="dashboard-payables"]');
    const inventory = document.querySelector('[data-testid="dashboard-inventory"]');
    const viewItems = inventory?.querySelector('a[href="/products"]');
    return {
      ids: [
        "dashboard-metrics",
        "dashboard-today",
        "dashboard-finance",
        "dashboard-payables",
        "dashboard-inventory",
        "dashboard-low-stock",
      ].filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
      today: text("dashboard-today"),
      finance: text("dashboard-finance"),
      payables: text("dashboard-payables"),
      inventory: text("dashboard-inventory"),
      viewItemsHref: viewItems?.getAttribute("href") ?? "",
      viewItemsText: viewItems?.textContent ?? "",
      financeClass: finance?.className ?? "",
      payablesClass: payables?.className ?? "",
      metricChildren: metrics?.children?.length ?? 0,
    };
  });

  check(
    "P1",
    "four separated metric cards replace the combined finance total",
    cards.ids.length === 0 &&
      cards.metricChildren === 4 &&
      cards.today.includes("আজকের জমা ও সার্ভিস") &&
      cards.today.includes("নতুন সার্ভিস") &&
      cards.today.includes("আজ জমা") &&
      cards.finance.includes("কাস্টমার বাকি") &&
      cards.finance.includes("মোট কাস্টমার বকেয়া") &&
      cards.finance.includes(money(customerDues)) &&
      cards.payables.includes("সাপ্লায়ার দেনা") &&
      cards.payables.includes("মোট সাপ্লায়ার বকেয়া") &&
      cards.payables.includes(money(supplierDebts)) &&
      cards.inventory.includes("স্বল্প স্টক প্রোডাক্ট") &&
      cards.inventory.includes("স্টক শেষ হওয়ার পথে") &&
      cards.inventory.includes(String(lowStockCount)) &&
      !cards.finance.includes("আর্থিক অবস্থা") &&
      !cards.payables.includes("আর্থিক অবস্থা"),
    JSON.stringify({ cards, customerDues, supplierDebts, lowStockCount })
  );

  const overviewText = await page.$eval(
    '[data-testid="dashboard-overview"]',
    (el) => el.innerText
  );
  const combined = customerDues + supplierDebts;
  const combinedHidden =
    combined === customerDues ||
    combined === supplierDebts ||
    !overviewText.includes(money(combined));
  check(
    "P2",
    "receivables and payables are never added into one red figure",
    combinedHidden,
    JSON.stringify({ combined, combinedLabel: money(combined) })
  );

  check(
    "P3",
    "receivables use a positive theme and payables a caution theme",
    /text-maher-(done|blue|royal)/.test(cards.financeClass) &&
      /text-maher-(due|warning|money)/.test(cards.payablesClass),
    JSON.stringify({ finance: cards.financeClass, payables: cards.payablesClass })
  );

  check(
    "P4",
    "inventory card offers a direct product-stock affordance",
    cards.viewItemsHref === "/products" &&
      cards.viewItemsText.includes("প্রোডাক্ট স্টক"),
    JSON.stringify({ href: cards.viewItemsHref, text: cards.viewItemsText })
  );

  // ---------- Responsive metric grid ----------
  const grid = {};
  for (const width of [1920, 1440, 820, 390]) {
    await page.setViewport({ width, height: 900 });
    grid[width] = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="dashboard-metrics"]');
      if (!el) return { cols: 0, overflow: 0 };
      const cols = getComputedStyle(el)
        .gridTemplateColumns.split(/\s+/)
        .filter(Boolean).length;
      return {
        cols,
        overflow:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      };
    });
  }
  await page.setViewport({ width: 1366, height: 900 });
  check(
    "P5",
    "metric grid is 4 / 4 / 2 / 1 columns at 1920 / 1440 / 820 / 390",
    grid[1920].cols === 4 &&
      grid[1440].cols === 4 &&
      grid[820].cols === 2 &&
      grid[390].cols === 1 &&
      Object.values(grid).every((g) => g.overflow <= 1),
    JSON.stringify(grid)
  );

  // ---------- P3: two logical zones + focused quick actions ----------
  const layout = await page.evaluate(() => {
    const zone = (id) => document.querySelector(`[data-testid="${id}"]`);
    const admin = zone("dashboard-zone-admin");
    const overviewZone = zone("dashboard-zone-overview");
    const save = document.querySelector('[data-testid="dashboard-save-settings"]');
    let sticky = false;
    for (let el = save; el; el = el.parentElement) {
      if (getComputedStyle(el).position === "sticky") {
        sticky = true;
        break;
      }
    }
    const tileIds = [
      "quick-service",
      "quick-sale",
      "quick-report",
      "quick-backup",
    ];
    return {
      missing: [
        "dashboard-zone-overview",
        "dashboard-zone-admin",
        "dashboard-jump-overview",
        "dashboard-jump-admin",
        "dashboard-metrics",
        ...tileIds,
      ].filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
      adminHas: [
        "dashboard-technicians",
        "dashboard-settings",
        "dashboard-data-safety",
      ].filter((id) => !admin?.querySelector(`[data-testid="${id}"]`)),
      overviewHas: [
        "dashboard-overview",
        "dashboard-quick-actions",
        "dashboard-low-stock",
      ].filter((id) => !overviewZone?.querySelector(`[data-testid="${id}"]`)),
      saveCount: document.querySelectorAll(
        '[data-testid="dashboard-save-settings"]'
      ).length,
      saveInAdmin: !!admin?.querySelector(
        '[data-testid="dashboard-save-settings"]'
      ),
      saveSticky: sticky,
      backupInQuick: !!zone("dashboard-quick-actions")?.querySelector(
        '[data-testid="dashboard-backup"]'
      ),
      reportDockInQuick: !!zone("dashboard-quick-actions")?.querySelector(
        '[data-testid="open-report"]'
      ),
    };
  });
  check(
    "P6",
    "Overview and Administration are distinct zones with all sections",
    layout.missing.length === 0 &&
      layout.adminHas.length === 0 &&
      layout.overviewHas.length === 0,
    JSON.stringify(layout)
  );
  check(
    "P7",
    "four quick-action tiles keep backup and report one click away",
    layout.backupInQuick && layout.reportDockInQuick,
    JSON.stringify(layout)
  );
  check(
    "P8",
    "one sticky global Save button lives in the Administration zone",
    layout.saveCount === 1 && layout.saveInAdmin && layout.saveSticky,
    JSON.stringify(layout)
  );

  // ---------- P2: visual keypad, custom slots and money converter ----------
  const keypad = await page.evaluate(() => {
    const ids = [
      "cipher-key-1", "cipher-key-2", "cipher-key-3",
      "cipher-key-4", "cipher-key-5", "cipher-key-6",
      "cipher-key-7", "cipher-key-8", "cipher-key-9",
      "cipher-key-star", "cipher-key-plus", "cipher-key-hash",
    ];
    const settings = document.querySelector('[data-testid="dashboard-settings"]');
    return {
      grid: !!document.querySelector('[data-testid="cipher-keypad"]'),
      keys: ids.filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
      keyCount: document.querySelectorAll('[data-testid^="cipher-key-"]').length,
      rawMapping: settings?.innerText.includes("1=* 2=ABC") ?? false,
      converter: !!document.querySelector('[data-testid="cipher-converter"]'),
      copy: !!document.querySelector('[data-testid="cipher-copy-code"]'),
    };
  });
  check(
    "P9",
    "keypad matrix replaces the raw mapping paragraph",
    keypad.grid &&
      keypad.keys.length === 0 &&
      keypad.keyCount === 12 &&
      !keypad.rawMapping &&
      keypad.converter &&
      keypad.copy,
    JSON.stringify(keypad)
  );

  await typeInto(page, "cipher-test-code", "*J#");
  const keypadDecode = await page.$eval(
    '[data-testid="cipher-decoded"]',
    (el) => el.innerText
  );
  check(
    "P10",
    "reverse converter shows Bengali-digit taka for *J#",
    keypadDecode.includes(bnMoney(1500)),
    JSON.stringify({ keypadDecode, expected: bnMoney(1500) })
  );

  // The converter starts empty — type the canonical amount so Copy has a code.
  await typeInto(page, "cipher-test-amount", "1500");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent?.includes("*J#"),
    { polling: 100, timeout: 5000 }
  );
  let copied = false;
  if (await page.$('[data-testid="cipher-copy-code"]')) {
    await page.click('[data-testid="cipher-copy-code"]');
    try {
      await waitText("কোড কপি হয়েছে");
      copied = true;
    } catch {
      copied = false;
    }
  }
  check("P11", "copy-code gives immediate feedback", copied);

  // A real click can land on the sticky header when Puppeteer scrolls this
  // button flush to the top edge; dispatch the DOM click directly instead.
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  // React commits the eleven-field grid asynchronously; always wait for it
  // instead of testing whether it is already there (that skipped the wait).
  await page.waitForSelector('[data-testid="cipher-custom-slots"]', { timeout: 5000 });
  const slots = await page.evaluate(() => {
    const ids = [
      "cipher-slot-1", "cipher-slot-2", "cipher-slot-3",
      "cipher-slot-4", "cipher-slot-5", "cipher-slot-6",
      "cipher-slot-7", "cipher-slot-8", "cipher-slot-9",
      "cipher-slot-0",
    ];
    const values = ids.map(
      (id) => document.querySelector(`[data-testid="${id}"]`)?.value ?? ""
    );
    return {
      missing: ids.filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
      value: values.join(""),
      legacyInput: !!document.querySelector('[data-testid="cipher-word"]'),
    };
  });
  check(
    "P12",
    "custom mode shows ten labelled digit slots",
    slots.missing.length === 0 && slots.legacyInput,
    JSON.stringify(slots)
  );

  // The empty-grid starter seed already mirrors ABCDEFGHIJ into the legacy
  // field; clear it first so re-typing the word is a real change event (React
  // skips onChange when the value is unchanged) and the 00 pair resets to "".
  await typeInto(page, "cipher-word", "");
  await typeInto(page, "cipher-word", "ABCDEFGHIJ");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent?.includes("AEJJ"),
    { polling: 100, timeout: 5000 }
  );
  const customEncoded = await page.$eval(
    '[data-testid="cipher-encoded"]',
    (el) => el.innerText
  );
  check(
    "P13",
    "custom slots drive the live encoder (ABCDEFGHIJ → AEJJ)",
    customEncoded.includes("AEJJ"),
    JSON.stringify({ customEncoded })
  );

  await typeInto(page, "cipher-test-code", "AEJJ");
  const customDecoded = await page.$eval(
    '[data-testid="cipher-decoded"]',
    (el) => el.innerText
  );
  check(
    "P14",
    "custom word decodes AEJJ to Bengali-digit ৳১,৫০০",
    customDecoded.includes(bnMoney(1500)),
    JSON.stringify({ customDecoded })
  );
  await page.click('[data-testid="cipher-mode-keypad"]');

  // A fresh install has no tenant name. The settings API requires one before
  // it persists anything, so this suite supplies its own explicit shop name —
  // never a hardcoded product fallback.
  await typeInto(page, "setting-shop-name", "Premium Shop");

  // ---------- Logo picker with a local preview ----------
  const logoFile = path.join(os.tmpdir(), `maher-logo-${Date.now()}.png`);
  fs.writeFileSync(
    logoFile,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7VsAAAAASUVORK5CYII=",
      "base64"
    )
  );
  let previewBefore = "";
  let previewAfter = "";
  let savedSettings = { settings: {} };
  const logoInput = await page.$('[data-testid="setting-logo"]');
  const isFileInput =
    logoInput &&
    (await page
      .$eval('[data-testid="setting-logo"]', (el) => el.type === "file")
      .catch(() => false));
  const waitForPreview = async () => {
    try {
      await page.waitForSelector('[data-testid="logo-preview-image"]', {
        timeout: 5000,
      });
      await page.waitForFunction(
        () =>
          (document
            .querySelector('[data-testid="logo-preview-image"]')
            ?.getAttribute("src") ?? "").startsWith("data:image/"),
        { polling: 100, timeout: 5000 }
      );
    } catch {
      // Let P15 report the missing preview instead of crashing the suite.
    }
  };
  if (isFileInput) {
    await logoInput.uploadFile(logoFile);
    await waitForPreview();
    previewBefore = await page
      .$eval('[data-testid="logo-preview-image"]', (el) => el.getAttribute("src") ?? "")
      .catch(() => "");
    await page.$eval('[data-testid="dashboard-save-settings"]', (el) =>
      el.click()
    );
    await waitText("সব সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
    savedSettings = await get("/api/shop-settings");
    await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
    await waitForPreview();
    const previewPresent = await page.$('[data-testid="logo-preview-image"]');
    if (previewPresent) {
      previewAfter = await page.$eval(
        '[data-testid="logo-preview-image"]',
        (el) => el.getAttribute("src") ?? ""
      );
    }
  }
  fs.rmSync(logoFile, { force: true });
  check(
    "P15",
    "logo picker previews and persists the selected image locally",
    previewBefore.startsWith("data:image/") &&
      previewAfter.startsWith("data:image/") &&
      path.basename(logoFile) === savedSettings.settings?.logoPath,
    JSON.stringify({
      before: previewBefore.slice(0, 24),
      after: previewAfter.slice(0, 24),
      logoPath: savedSettings.settings?.logoPath,
      expected: path.basename(logoFile),
    })
  );

  // Saving custom shop info is the only event that retires onboarding. A
  // second tab has no dismiss flag, so it proves completion is persisted.
  const onboardingFlags = await page.evaluate(() => ({
    legacy: localStorage.getItem("shop_onboarding_completed"),
    profile: localStorage.getItem("shop_profile_configured"),
  }));
  const savedTab = await browser.newPage();
  await savedTab.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  const bannerAfterSave = !!(await savedTab.$('[data-testid="shop-onboarding-banner"]'));
  await savedTab.close();
  check(
    "OB4",
    "successful profile save marks onboarding complete and retires the banner everywhere",
    onboardingFlags.legacy === "true" &&
      onboardingFlags.profile === "true" &&
      !!savedSettings.settings?.updatedAt &&
      !bannerAfterSave,
    JSON.stringify({
      onboardingFlags,
      updatedAt: savedSettings.settings?.updatedAt ?? null,
      bannerAfterSave,
    })
  );

  // ---------- Logo removal, validation and reactive brand preview ----------
  const logoState = async () =>
    page.evaluate(() => {
      const input = document.querySelector('[data-testid="setting-logo"]');
      const brand = document.querySelector('[data-testid="brand-preview"]');
      const settings = document.querySelector('[data-testid="dashboard-settings"]');
      return {
        legacyUpload: !!document.querySelector('[data-testid="shop-logo-upload"]'),
        uploadBtn: !!document.querySelector('[data-testid="shop-logo-upload-btn"]'),
        changeBtn: !!document.querySelector('[data-testid="shop-logo-change-btn"]'),
        removeBtn: !!document.querySelector('[data-testid="shop-logo-remove-btn"]'),
        profilePreview:
          document
            .querySelector('[data-testid="logo-preview-image"]')
            ?.getAttribute("src") ?? "",
        brandImage: !!brand?.querySelector("img"),
        brandStore: !!brand?.querySelector("svg.text-slate-700"),
        inputValue: input ? input.value : "missing-input",
        accept: input?.getAttribute("accept") ?? "",
        helper: !!settings?.textContent?.includes("সর্বোচ্চ ২MB (PNG, JPG, WEBP)"),
      };
    });

  const withLogo = await logoState();
  check(
    "P17",
    "stored logo shows a thumbnail, change/remove actions and the exact format list",
    withLogo.legacyUpload &&
      withLogo.changeBtn &&
      withLogo.removeBtn &&
      !withLogo.uploadBtn &&
      withLogo.profilePreview.startsWith("data:image/") &&
      withLogo.brandImage &&
      ["image/png", "image/jpeg", "image/webp", "image/svg+xml"].every((type) =>
        withLogo.accept.includes(type)
      ),
    JSON.stringify(withLogo)
  );

  await page.$eval('[data-testid="shop-logo-remove-btn"]', (el) => el.click());
  await page.waitForFunction(
    () =>
      !document.querySelector('[data-testid="logo-preview-image"]') &&
      !!document.querySelector('[data-testid="shop-logo-upload-btn"]'),
    { polling: 100, timeout: 5000 }
  );
  const afterRemove = await logoState();
  const previewRecord = await page.evaluate(() =>
    localStorage.getItem("maher-shop-logo-preview")
  );
  check(
    "P18",
    "remove clears the preview, file input and cache, and brand falls back to Store",
    afterRemove.legacyUpload &&
      afterRemove.uploadBtn &&
      !afterRemove.changeBtn &&
      !afterRemove.removeBtn &&
      !afterRemove.profilePreview &&
      !afterRemove.brandImage &&
      afterRemove.brandStore &&
      afterRemove.inputValue === "" &&
      afterRemove.helper &&
      previewRecord === null,
    JSON.stringify({ ...afterRemove, previewRecord })
  );

  await page.$eval('[data-testid="dashboard-save-settings"]', (el) => el.click());
  await waitText("সব সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
  const clearedSettings = await get("/api/shop-settings");
  const afterSave = await logoState();
  check(
    "P19",
    "saving the cleared logo persists an empty path and keeps the fallback live",
    clearedSettings.settings?.logoPath === "" &&
      afterSave.uploadBtn &&
      afterSave.brandStore &&
      !afterSave.brandImage,
    JSON.stringify({
      logoPath: clearedSettings.settings?.logoPath,
      ...afterSave,
    })
  );

  const bigLogo = path.join(os.tmpdir(), `maher-logo-big-${Date.now()}.png`);
  fs.writeFileSync(bigLogo, Buffer.alloc(2 * 1024 * 1024 + 1, 1));
  await (
    await page.$('[data-testid="setting-logo"]')
  ).uploadFile(bigLogo);
  await waitText(
    "ছবির সাইজ অনেক বড়! অনুগ্রহ করে ২MB এর কম সাইজের ছবি নির্বাচন করুন।"
  );
  const afterBigFile = await logoState();
  fs.rmSync(bigLogo, { force: true });
  check(
    "P20",
    "oversized logo is rejected with the exact toast and leaves no preview",
    afterBigFile.inputValue === "" &&
      afterBigFile.uploadBtn &&
      !afterBigFile.profilePreview &&
      !afterBigFile.brandImage &&
      afterBigFile.brandStore,
    JSON.stringify(afterBigFile)
  );

  const badTypeLogo = path.join(os.tmpdir(), `maher-logo-bad-${Date.now()}.txt`);
  fs.writeFileSync(badTypeLogo, "not an image");
  await (
    await page.$('[data-testid="setting-logo"]')
  ).uploadFile(badTypeLogo);
  await waitText("শুধুমাত্র PNG, JPG, WEBP বা SVG ছবি নির্বাচন করুন।");
  const afterBadType = await logoState();
  fs.rmSync(badTypeLogo, { force: true });
  check(
    "P21",
    "non-image logo files are rejected without touching the preview",
    afterBadType.inputValue === "" &&
      afterBadType.uploadBtn &&
      !afterBadType.profilePreview &&
      !afterBadType.brandImage,
    JSON.stringify(afterBadType)
  );

  const reuseLogo = path.join(os.tmpdir(), `maher-logo-reuse-${Date.now()}.png`);
  const seedLogo = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7VsAAAAASUVORK5CYII=",
    "base64"
  );
  fs.writeFileSync(reuseLogo, seedLogo);
  await (
    await page.$('[data-testid="setting-logo"]')
  ).uploadFile(reuseLogo);
  await waitForPreview();
  const firstPick = await logoState();
  await page.$eval('[data-testid="shop-logo-remove-btn"]', (el) => el.click());
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="shop-logo-upload-btn"]'),
    { polling: 100, timeout: 5000 }
  );
  await (
    await page.$('[data-testid="setting-logo"]')
  ).uploadFile(reuseLogo);
  await waitForPreview();
  const secondPick = await logoState();
  fs.rmSync(reuseLogo, { force: true });
  check(
    "P22",
    "the same logo file can be picked again after removal (input value reset)",
    firstPick.profilePreview.startsWith("data:image/") &&
      secondPick.profilePreview.startsWith("data:image/") &&
      secondPick.brandImage &&
      secondPick.changeBtn &&
      secondPick.removeBtn,
    JSON.stringify({
      first: firstPick.profilePreview.slice(0, 24),
      second: secondPick.profilePreview.slice(0, 24),
      brandImage: secondPick.brandImage,
    })
  );

  // ---------- Domain-copy harmonisation across the dashboard ----------
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  await page.waitForSelector('[data-testid="cipher-custom-slots"]', { timeout: 5000 });
  const copy = await page.evaluate(() => {
    const textOf = (selector) =>
      document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    return {
      headerCta: textOf("main > header a button"),
      jump: textOf('[data-testid="dashboard-jump-overview"]'),
      quickService: textOf('[data-testid="quick-service"]'),
      quickSale: textOf('[data-testid="quick-sale"]'),
      cipherHint: textOf('[data-testid="dashboard-cipher"]'),
      customTab: textOf('[data-testid="cipher-mode-custom"]'),
      legacyLabel:
        document.querySelector('label[for="cipher-word"]')?.textContent?.trim() ?? "",
    };
  });
  check(
    "P16",
    "dashboard copy matches the service/product/finance domain language",
    copy.headerCta.includes("সার্ভিস পেজে যান") &&
      copy.jump.includes("ওভারভিউতে ফিরুন") &&
      copy.quickService.includes("সার্ভিস এন্ট্রি") &&
      copy.quickSale.includes("স্টক থেকে প্রোডাক্ট বিক্রি করুন") &&
      copy.cipherHint.includes("টাকা ↔ কোড কনভার্টার") &&
      copy.customTab.includes("কাস্টম কোড") &&
      copy.legacyLabel.includes("কাস্টম কোড"),
    JSON.stringify(copy)
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("DASHBOARD-PREMIUM SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
