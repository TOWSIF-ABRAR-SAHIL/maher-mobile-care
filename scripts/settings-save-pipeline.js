/* Settings save pipeline contract on a throwaway database.
 *
 * Reproduces the reported failure exactly: an older database where the
 * ShopSettings singleton table has not been migrated yet. A dashboard save
 * must heal that additive table, persist the id=1 row, accept keypad/custom
 * ciphers, and surface real validation errors instead of the generic toast.
 */
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
} = require("./test-support");

const BASE = resolveTestBase();
const DB_FILE = process.env.MAHER_DB_PATH;
const SUCCESS_TOAST = "সব সেটিংস সফলভাবে সংরক্ষিত হয়েছে!";
const GENERIC_ERROR = "সেটিংস সংরক্ষণ করা যায়নি";
const INVALID_NOTICE = "সবগুলো ঘরে সঠিক অক্ষর দিন";
const WORD = "ABCDEFGHIJ";
const CODE = "AEJJ";

if (!DB_FILE || path.basename(DB_FILE) !== process.env.MAHER_TEST_DB_FILE) {
  throw new Error("settings-save-pipeline must run only on the suite throwaway DB");
}

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

function openDb() {
  const db = new Database(DB_FILE);
  db.pragma("busy_timeout = 5000");
  return db;
}

function dropSettingsTable() {
  const db = openDb();
  try {
    db.exec('DROP TABLE IF EXISTS "ShopSettings"');
  } finally {
    db.close();
  }
}

function readSettingsRow() {
  const db = openDb();
  try {
    const row = db.prepare('SELECT * FROM "ShopSettings"').all();
    return row;
  } catch (err) {
    return [{ error: String(err.message ?? err) }];
  } finally {
    db.close();
  }
}

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  const get = async (url) => (await api(page, url)).body;
  const put = (url, body) =>
    api(page, url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  // The browser must be on an app origin before relative fetch() calls.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', {
    timeout: 15000,
  });

  // Simulate a shop PC that still has the pre-settings database file.
  dropSettingsTable();
  const before = await get("/api/shop-settings");
  check(
    "P1",
    "missing settings table stays an empty tenant profile for onboarding",
    before.settings?.shopName === "" &&
      before.settings?.secretCipher?.mode === "keypad" &&
      before.settings?.updatedAt === null,
    JSON.stringify(before.settings)
  );

  // P2: the first keypad save must heal the table and upsert singleton id=1.
  const keypad = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    slogan: null,
    address: null,
    phone: null,
    whatsapp: null,
    terms: null,
    logoPath: null,
    secretCipher: { mode: "keypad" },
  });
  const keypadRows = readSettingsRow();
  const keypadParsed = (() => {
    try {
      return JSON.parse(keypadRows[0]?.secretCipher ?? "null");
    } catch {
      return null;
    }
  })();
  check(
    "P2",
    "keypad save creates the missing table and upserts singleton id=1 with valid JSON",
    keypad.status === 200 &&
      keypad.body?.settings?.secretCipher?.mode === "keypad" &&
      keypadRows.length === 1 &&
      keypadRows[0]?.id === 1 &&
      keypadParsed?.mode === "keypad",
    JSON.stringify({
      status: keypad.status,
      body: keypad.body,
      rows: keypadRows,
    })
  );

  // P3: nullable profile fields are stored safely as empty strings.
  check(
    "P3",
    "nullable slogan/address/phone/whatsapp/terms/logoPath do not break the upsert",
    keypad.status === 200 &&
      ["slogan", "address", "phone", "whatsapp", "terms", "logoPath"].every(
        (key) => keypadRows[0]?.[key] === ""
      ),
    JSON.stringify(keypadRows[0])
  );

  // P4: custom groups save strictly but never touch service rows.
  const validGroups = {
    "1": ["A"],
    "2": ["B"],
    "3": ["C"],
    "4": ["D"],
    "5": ["E"],
    "6": ["F"],
    "7": ["G"],
    "8": ["H"],
    "9": ["I"],
    "0": ["J"],
    "00": [],
  };
  const custom = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    secretCipher: { mode: "custom", groups: validGroups },
  });
  const customRow = readSettingsRow()[0];
  const customParsed = (() => {
    try {
      return JSON.parse(customRow?.secretCipher ?? "null");
    } catch {
      return null;
    }
  })();
  const allGroupsPresent = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].every(
    (digit) => (customParsed?.groups?.[digit] ?? []).length > 0
  );
  const unique = new Set(
    Object.entries(customParsed?.groups ?? {}).flatMap(([, chars]) => chars)
  ).size === 10;
  check(
    "P4",
    "custom groups save with all required digits, optional 00, and unique characters",
    custom.status === 200 &&
      custom.body?.settings?.secretCipher?.mode === "custom" &&
      customParsed?.mode === "custom" &&
      allGroupsPresent &&
      unique &&
      (customParsed?.groups?.["00"] ?? []).length === 0 &&
      readSettingsRow().length === 1,
    JSON.stringify({ custom: custom.body, cipher: customParsed })
  );

  // P5: keypad mode must not inherit custom-group rules from a stored config.
  const keypadIgnoresGroups = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    secretCipher: {
      mode: "keypad",
      groups: { "1": ["A"], "2": ["A", "B"] },
      word: "BAD",
    },
  });
  check(
    "P5",
    "keypad mode ignores invalid custom groups/word instead of rejecting them",
    keypadIgnoresGroups.status === 200 &&
      keypadIgnoresGroups.body?.settings?.secretCipher?.mode === "keypad",
    JSON.stringify({ status: keypadIgnoresGroups.status, body: keypadIgnoresGroups.body })
  );

  // P6: a real custom collision must return the precise Bangla validation error.
  const collision = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    secretCipher: {
      mode: "custom",
      groups: { ...validGroups, "2": ["A", "B"] },
    },
  });
  check(
    "P6",
    "duplicate custom characters return the exact validation error, not the generic toast",
    collision.status === 400 &&
      typeof collision.body?.error === "string" &&
      collision.body.error.includes("একাধিক ঘরে") &&
      !collision.body.error.includes(GENERIC_ERROR),
    JSON.stringify({ status: collision.status, body: collision.body })
  );

  // P7: an empty required digit must return the exact fill-every-slot notice.
  const missingZero = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    secretCipher: {
      mode: "custom",
      groups: { ...validGroups, "0": [] },
    },
  });
  check(
    "P7",
    "a missing required digit is rejected with the exact fill-every-slot error",
    missingZero.status === 400 && missingZero.body?.error === INVALID_NOTICE,
    JSON.stringify({ status: missingZero.status, body: missingZero.body })
  );

  // P8: dashboard save shows the exact success toast and updates shared context.
  const wordSave = await put("/api/shop-settings", {
    shopName: "Settings Pipeline Shop",
    secretCipher: { mode: "custom", word: WORD },
  });
  check(
    "P8",
    "valid legacy custom word still saves",
    wordSave.status === 200 &&
      wordSave.body?.settings?.secretCipher?.word === WORD,
    JSON.stringify({ status: wordSave.status, body: wordSave.body })
  );

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-save-settings"]', {
    timeout: 15000,
  });
  await typeInto(page, "setting-shop-name", "Settings UI Shop");
  await page.$eval('[data-testid="dashboard-save-settings"]', (el) => el.click());
  await page.waitForFunction(
    (text) => document.body.textContent.includes(text),
    { polling: 200, timeout: 8000 },
    SUCCESS_TOAST
  );
  const afterUiSave = await get("/api/shop-settings");
  check(
    "P9",
    "dashboard save shows the exact success toast and persists the edit",
    afterUiSave.settings?.shopName === "Settings UI Shop",
    JSON.stringify({ toast: SUCCESS_TOAST, settings: afterUiSave.settings })
  );

  // P10/P11: same-spa navigation proves reactive sync, without a hard reload.
  await page.click('[data-nav-item="service"]');
  await page.waitForFunction(
    () => location.pathname === "/service",
    { polling: 100, timeout: 15000 }
  );
  await page.waitForSelector('[data-testid="svc-parts"]', { timeout: 15000 });
  await page.evaluate(() => {
    const root = document.querySelector('[data-testid="svc-parts"]');
    const add = [...(root?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent.includes("পার্টস যোগ করুন")
    );
    if (add) add.click();
  });
  await page.waitForSelector('[data-testid="svc-parts"] input[id*="-price-"]', {
    timeout: 10000,
  });
  const priceId = await page.$eval(
    '[data-testid="svc-parts"] input[id*="-price-"]',
    (el) => el.id
  );
  await typeInto(page, priceId, "1500");
  const servicePreview = await page.$eval('[data-testid="svc-parts"]', (el) => el.innerText);
  check(
    "P10",
    "/service part-price preview uses the saved cipher immediately",
    servicePreview.includes(`গোপন কোড: ${CODE}`) &&
      !servicePreview.includes("গোপন কোড: *J#"),
    JSON.stringify(servicePreview.slice(0, 200))
  );

  await page.click('[data-nav-item="products"]');
  await page.waitForFunction(
    () => location.pathname === "/products",
    { polling: 100, timeout: 15000 }
  );
  const productsHeader = await page.$eval('[data-testid="app-header"]', (el) => el.innerText);
  check(
    "P11",
    "/products receives the same settings context without a reload",
    productsHeader.includes("Settings UI Shop"),
    JSON.stringify(productsHeader.slice(0, 200))
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero unexpected JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("SETTINGS-SAVE-PIPELINE SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
