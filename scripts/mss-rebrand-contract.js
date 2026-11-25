/* MSS rebrand + clean-slate identity contract.
 *
 * Pure source/config checks: no server, no database, no browser. Pins the
 * invariants that must survive the white-label release — MSS owns the platform
 * chrome, the tenant owns every customer-facing name, a fresh install starts
 * empty, and private wire identifiers stay unchanged for older installations.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

const results = [];
const check = (id, name, fn) => {
  try {
    fn();
    results.push(`PASS [${id}] ${name}`);
  } catch (error) {
    results.push(`FAIL [${id}] ${name} — ${error?.message ?? error}`);
    process.exitCode = 1;
  }
};

const LEGACY = ["MAHER MOBILE CARE", "Nabinagar", "Ashulia 1344", "01717777755"];

check("RB-01", "PLATFORM_BRAND owns the MSS product name and native window title", () => {
  const src = read("lib/shop.ts");
  assert.ok(src.includes('name: "MSS"'), "platform name must be MSS");
  assert.ok(
    src.includes('windowTitle: "MSS (Mobile Service System)"'),
    "window title must carry MSS"
  );
});

check("RB-02", "vendor support hotline and WhatsApp link are unchanged", () => {
  const src = read("lib/shop.ts");
  assert.ok(src.includes('supportNumber: "01533315357"'));
  assert.ok(src.includes('supportUrl: "https://wa.me/8801533315357"'));
});

check("RB-03", "tenant SHOP template is completely empty on a fresh install", () => {
  const src = read("lib/shop.ts");
  for (const field of ["name", "tagline", "chromeTagline", "address", "phone"]) {
    assert.ok(src.includes(`${field}: ""`), `${field} must start empty`);
  }
});

check("RB-04", "settings defaults derive from the empty tenant, never a hardcoded shop", () => {
  const src = read("lib/shop-settings.ts");
  assert.ok(src.includes("shopName: SHOP.name"));
  assert.ok(src.includes("whatsapp: SHOP.phone"));
  assert.ok(src.includes('terms: ""'));
  assert.ok(src.includes("logoPath: null"));
});

check("RB-05", "onboarding needs a real saved profile, not a default name", () => {
  const src = read("lib/shop-settings.ts");
  assert.ok(src.includes("export function isShopProfileConfigured"));
  assert.ok(src.includes("!!settings.updatedAt && !!settings.shopName.trim()"));
});

check("RB-06", "the settings API rejects a save without a tenant name", () => {
  const src = read("lib/shop-settings.ts");
  assert.ok(
    src.includes('throw new ShopSettingsError("shopName is required")'),
    "empty shopName must be rejected server-side"
  );
});

check("RB-07", "navbar falls back to an MSS setup hint, never an old shop name", () => {
  const src = read("components/BrandMark.tsx");
  assert.ok(src.includes('SHOP_NAME_FALLBACK = "MSS - শপ প্রোফাইল সেটআপ করুন"'));
  assert.ok(src.includes("settings.shopName || SHOP_NAME_FALLBACK"));
});

check("RB-08", "receipt falls back to a generic tenant placeholder", () => {
  const src = read("components/Receipt.tsx");
  assert.ok(src.includes('RECEIPT_SHOP_NAME_FALLBACK = "আপনার দোকানের নাম"'));
  assert.ok(src.includes("settings.shopName || RECEIPT_SHOP_NAME_FALLBACK"));
});

check("RB-09", "report document reads the live shop name with MSS as fallback", () => {
  const src = read("components/report/ReportDocument.tsx");
  assert.ok(src.includes("data.shopName?.trim() || PLATFORM_BRAND.name"));
});

check("RB-10", "backup workbook and internal exports use MSS when the profile is blank", () => {
  const workbook = read("lib/backup-workbook.ts");
  assert.ok(workbook.includes("input.shopName?.trim() || PLATFORM_BRAND.name"));
  assert.ok(
    workbook.split("input.shopName?.trim() || PLATFORM_BRAND.name").length - 1 >= 2,
    "both workbook variants must use the live tenant name"
  );
  assert.ok(read("app/api/backup/route.ts").includes("settings.shopName.trim() || PLATFORM_BRAND.name"));
});

check("RB-11", "CSV/text exports fall back to the MSS platform brand", () => {
  assert.ok(read("lib/export.ts").includes("d.shopName?.trim() || PLATFORM_BRAND.name"));
});

check("RB-12", "receipt PDF filename and title use MSS, not a baked-in shop", () => {
  const src = read("lib/receipt-pdf.ts");
  assert.ok(src.includes("PLATFORM_BRAND.name}-Bill-"));
  assert.ok(src.includes("shopName.trim() || PLATFORM_BRAND.name"));
});

check("RB-13", "licence hub resolves the live profile before the MSS brand", () => {
  assert.ok(
    read("components/dashboard/LicenseCard.tsx").includes(
      "settings.shopName || status?.shopName || PLATFORM_BRAND.name"
    )
  );
});

check("RB-14", "native window/taskbar title is rebuilt from the dynamic tenant", () => {
  const provider = read("components/ShopSettingsProvider.tsx");
  assert.ok(provider.includes("PLATFORM_BRAND.windowTitle"));
  assert.ok(provider.includes("tenant ?"));
  const main = read("electron/main.cjs");
  assert.ok(main.includes('ipcMain.handle("window:set-title"'));
  assert.ok(main.includes("MSS (Mobile Service System)"));
});

check("RB-15", "document metadata title is MSS", () => {
  assert.ok(
    read("app/layout.tsx").includes('title: "MSS (Mobile Service System)"'),
    "browser tab title must be MSS"
  );
});

check("RB-16", "Electron app name and installer data root are MSS", () => {
  const src = read("electron/main.cjs");
  assert.ok(src.includes('app.setName("MSS")'));
  assert.ok(src.includes("resolveDataRoot("), "production must read the installer-chosen data root");
  assert.ok(!src.includes('path.join(app.getPath("appData"), "MSS")'), "no C-drive AppData root");
  const resolver = read("electron/data-root.cjs");
  assert.ok(resolver.includes('DEFAULT_DATA_ROOT = "D:\\\\MSS-Data"'));
  assert.ok(resolver.includes('pathModule.join(appData, "MSS")'), "unpacked dev fallback stays MSS");
});

check("RB-17", "WhatsApp text uses the live shop name with a generic fallback", () => {
  const src = read("lib/contact.ts");
  assert.ok(src.includes("shopName = \"\""));
  assert.ok(src.includes('shopName.trim() || "আপনার দোকান"'));
});

check("RB-18", "customer-facing source and shop README carry no legacy shop identity", () => {
  const files = [
    "app/layout.tsx",
    "app/page.tsx",
    "app/service/page.tsx",
    "app/service/ServiceWorkspace.tsx",
    "components/BrandMark.tsx",
    "components/AppHeader.tsx",
    "components/ShopFooter.tsx",
    "components/Receipt.tsx",
    "components/ReportDocument.tsx",
    "components/report/ReportDocument.tsx",
    "components/dashboard/LicenseCard.tsx",
    "components/dashboard/ReportDock.tsx",
    "lib/shop.ts",
    "lib/shop-settings.ts",
    "lib/contact.ts",
    "lib/export.ts",
    "lib/receipt-pdf.ts",
    "lib/backup-workbook.ts",
    "lib/licensing/license-status.ts",
    "packaging/README.txt",
  ];
  for (const rel of files) {
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    // The portable launcher filename is a private wire identifier and stays;
    // only brand text used as a tenant identity is forbidden here.
    const src = read(rel).replaceAll("MAHER MOBILE CARE.bat", "");
    for (const token of LEGACY) {
      assert.ok(!src.includes(token), `${rel} still contains ${token}`);
    }
  }
});

check("RB-19", "private health service id stays stable for older launchers", () => {
  assert.ok(
    read("app/api/health/route.ts").includes('service: "maher-mobile-care"'),
    "the readiness wire id must not be rebranded"
  );
});

check("RB-20", "test harness MAHER_* environment names stay private and unchanged", () => {
  const src = read("scripts/run-tests.js");
  for (const name of [
    "MAHER_DB_PATH",
    "MAHER_TEST_DB_FILE",
    "MAHER_BACKUP_DIR",
    "MAHER_LICENSE_FILE",
  ]) {
    assert.ok(src.includes(name), `${name} must be preserved`);
  }
});

check("RB-21", "internal backup snapshot prefixes stay readable by old installs", () => {
  for (const rel of ["app/api/backup/list/route.ts", "app/api/backup/restore/route.ts"]) {
    const src = read(rel);
    assert.ok(src.includes("maher-"), `${rel} must still accept maher- snapshots`);
    assert.ok(src.includes("safety-"), `${rel} must still accept safety- snapshots`);
  }
});

check("RB-22", "clean-slate suite is registered and exempt from throwaway roster seeding", () => {
  const src = read("scripts/run-tests.js");
  assert.ok(src.includes('"scripts/clean-slate-fresh-install.js"'));
  assert.ok(src.includes("CLEAN_SLATE_SUITE"));
  assert.ok(src.includes("suite !== CLEAN_SLATE_SUITE"));
});

check("RB-23", "demo technician cleanup only touches an untouched database", () => {
  const src = read(
    "prisma/migrations/20261125130000_clear_demo_technician_seed/migration.sql"
  );
  assert.ok(src.includes("20261002194421_add_technician"), "old seed must stay documented");
  for (const name of ["NURUL", "RONI", "ASRAFUL", "NAYEM"]) {
    assert.ok(src.includes(`'${name}'`), `${name} must be cleared`);
  }
  assert.ok(src.includes('AND (SELECT COUNT(*) FROM "Technician") = 4'));
  assert.ok(src.includes('NOT EXISTS (SELECT 1 FROM "Service")'));
});

check("RB-24", "shipped docs and operator README announce MSS and the empty first run", () => {
  assert.ok(read("README.md").includes("MSS-Setup-1.2.0.exe"));
  assert.ok(read("README.md").includes("PLATFORM_BRAND"));
  assert.ok(read("PREPARE-WINDOWS.md").includes("MSS-Setup-1.2.0.exe"));
  assert.ok(read("PREPARE-WINDOWS.md").includes("khali thakbe"));
  assert.ok(read("MANUAL-TEST.md").includes("fresh install starts with zero"));
  assert.ok(read("packaging/README.txt").includes("MSS - Chalano Niyom"));
});

check("RB-25", "the server PDF renders Bengali tenant names with a self-hosted font", () => {
  const src = read("app/api/backup/route.ts");
  assert.ok(src.includes("drawPdfBrand(doc, brand"), "brand must use the script-aware drawer");
  assert.ok(src.includes("NotoSansBengali-bengali.ttf"));
  assert.ok(src.includes("Identity-H"));
  assert.ok(exists("app/fonts/NotoSansBengali-bengali.ttf"));
});

check("RB-26", "the tenant title survives client-side route metadata changes", () => {
  const provider = read("components/ShopSettingsProvider.tsx");
  assert.ok(provider.includes("MutationObserver"), "route metadata must not win after navigation");
  assert.ok(provider.includes("pushNativeTitle()"), "native title must be re-pushed too");
});

check("RB-27", "a one-device receipt bundle keeps its explicit profile", () => {
  const src = read("components/Receipt.tsx");
  assert.ok(
    src.includes('<Receipt service={services[0]} profile={profile} />'),
    "detached PDF bundles must not drop the supplied tenant profile"
  );
});

check("RB-28", "Excel detail-sheet footers use the live tenant brand", () => {
  const src = read("lib/backup-workbook.ts");
  assert.ok(src.includes("&L${brand}&Cপৃষ্ঠা"), "footer must not hardcode the platform brand");
  assert.ok(!src.includes("&L${PLATFORM_BRAND.name}&Cপৃষ্ঠা"));
});

for (const line of results) console.log(line);
console.log(
  `MSS rebrand contract: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`
);
