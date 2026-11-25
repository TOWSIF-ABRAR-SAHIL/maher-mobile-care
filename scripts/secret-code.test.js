/* Multi-character Secret Code Engine contract.
 *
 * Unit-tests the pure engine (lib/secret-code.ts) plus the strict settings API
 * and the one-click global sync through the live app. Runs only on the
 * throwaway database provided by scripts/run-tests.js — never on shop data.
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
  uniqueName,
} = require("./test-support");

const ROOT = path.resolve(__dirname, "..");
const BASE = resolveTestBase();
const TODAY = dhakaToday();

const COLLISION =
  "'B' অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে। প্রতিটি অক্ষর কেবল একটি ঘরে থাকতে পারবে।";
const SYNC_TOAST = "গোপন কোড সফলভাবে পুরো ওয়েবসাইটে সিঙ্ক হয়েছে!";
const bnMoney = (n) =>
  `৳${String(Math.round(Number(n) || 0).toLocaleString("en-IN")).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])}`;

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

/** Load the dependency-free pure module without a Next.js/bundler build. */
function loadSecretCode() {
  const file = path.join(ROOT, "lib", "secret-code.ts");
  const source = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  return mod.exports;
}

const secret = loadSecretCode();

const KEYPAD_GROUPS = {
  "1": ["*"], "2": ["A", "B", "C"], "3": ["D", "E", "F"],
  "4": ["G", "H", "I"], "5": ["J", "K", "L"], "6": ["M", "N", "O"],
  "7": ["P", "Q", "R", "S"], "8": ["T", "U", "V"], "9": ["W", "X", "Y", "Z"],
  "0": ["+"], "00": ["#"],
};
const custom = (groups) => ({ mode: "custom", groups });

async function send(page, method, url, body) {
  // `api` fetches from inside the page; an origin is needed for relative URLs.
  const target = url.startsWith("http") ? url : `${BASE}${url}`;
  return api(page, target, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

async function navigate(page, key, href, selector) {
  await page.click(`[data-nav-item="${key}"]`);
  await page.waitForFunction(
    (want) => location.pathname === want,
    { polling: 100, timeout: 15000 },
    href
  );
  await page.waitForSelector(selector, { timeout: 15000 });
}

async function openFirstPartPrice(page) {
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
  return page.$eval('[data-testid="svc-parts"] input[id*="-price-"]', (el) => el.id);
}

let browser = null;

(async () => {
  // ---------- Unit: multi-character map encodes first / decodes any ----------
  const valid = secret.validateCipherGroups(KEYPAD_GROUPS);
  check(
    "U1",
    "keypad preset is a valid eleven-digit multi-character map",
    valid.ok && valid.duplicate === null,
    JSON.stringify({ ok: valid.ok, error: valid.error })
  );
  check(
    "U2",
    "encoding uses the FIRST character of each digit list (1500 → *J#, 2500 → AJ#)",
    secret.encodeWithCipher(1500, custom(KEYPAD_GROUPS)) === "*J#" &&
      secret.encodeWithCipher(2500, custom(KEYPAD_GROUPS)) === "AJ#",
    JSON.stringify({
      p1500: secret.encodeWithCipher(1500, custom(KEYPAD_GROUPS)),
      p2500: secret.encodeWithCipher(2500, custom(KEYPAD_GROUPS)),
    })
  );
  check(
    "U3",
    "decoding accepts ANY character from each list (*J#, *K#, *L# all → 1500)",
    ["*J#", "*K#", "*L#"].every(
      (code) => secret.decodeWithCipher(code, custom(KEYPAD_GROUPS)) === 1500
    ),
    JSON.stringify(
      ["*J#", "*K#", "*L#"].map((code) =>
        secret.decodeWithCipher(code, custom(KEYPAD_GROUPS))
      )
    )
  );

  // ---------- Unit: collision validation ----------
  const collided = {
    ...KEYPAD_GROUPS,
    "5": ["B", "J", "K"], // B already belongs to digit 2
  };
  const collisionResult = secret.validateCipherGroups(collided);
  check(
    "U4",
    "a character in two different digits is rejected with the exact Bengali message",
    !collisionResult.ok &&
      collisionResult.error === COLLISION &&
      collisionResult.duplicate === "B" &&
      collisionResult.conflictDigits.includes("2") &&
      collisionResult.conflictDigits.includes("5"),
    JSON.stringify({
      error: collisionResult.error,
      duplicate: collisionResult.duplicate,
      digits: collisionResult.conflictDigits,
    })
  );
  check(
    "U5",
    "empty required digits are rejected while an empty 00 is allowed",
    !secret.validateCipherGroups({ ...KEYPAD_GROUPS, "7": [] }).ok &&
      secret.validateCipherGroups({ ...KEYPAD_GROUPS, "00": [] }).ok
  );
  check(
    "U6",
    "legacy word and keypad defaults stay byte-compatible",
    secret.encodeWithCipher(1500, { mode: "custom", word: "ABCDEFGHIJ" }) === "AEJJ" &&
      secret.decodeWithCipher("AEJJ", { mode: "custom", word: "ABCDEFGHIJ" }) === 1500 &&
      secret.encodeWithCipher(1500) === "*J#" &&
      secret.decodeWithCipher("*J#") === 1500 &&
      secret.decodeWithCipher("৳১,৫০০") === 1500
  );

  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  const waitText = (text) =>
    page.waitForFunction(
      (t) => document.body.textContent.includes(t),
      { polling: 200, timeout: 8000 },
      text
    );

  // Give the page an app origin first — `api()` fetches from inside the page.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });

  // ---------- API: strict validation + persisted multi-char map ----------
  const rejected = await send(page, "PUT", "/api/shop-settings", {
    shopName: "Secret Code Shop",
    secretCipher: custom(collided),
  });
  check(
    "A1",
    "settings API rejects a cross-digit collision with HTTP 400",
    rejected.status === 400 &&
      String(rejected.body?.error ?? "").includes("অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে।"),
    JSON.stringify({ status: rejected.status, body: rejected.body })
  );

  const accepted = await send(page, "PUT", "/api/shop-settings", {
    shopName: "Secret Code Shop",
    secretCipher: custom(KEYPAD_GROUPS),
  });
  const savedCipher = accepted.body?.settings?.secretCipher;
  check(
    "A2",
    "settings API stores every character list and mirrors the legacy word",
    accepted.status === 200 &&
      JSON.stringify(savedCipher?.groups?.["2"]) === JSON.stringify(["A", "B", "C"]) &&
      JSON.stringify(savedCipher?.groups?.["00"]) === JSON.stringify(["#"]) &&
      savedCipher?.word === "*ADGJMPTW+",
    JSON.stringify(savedCipher)
  );

  // A stored row created under the keypad cipher must keep its money fields
  // even after the active cipher changes (no retroactive re-encoding).
  const before = await send(page, "POST", "/api/services", {
    customerName: uniqueName("CipherHistory"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "History Model",
    technician: "NURUL",
    problem: "Keep historical codes",
    totalBill: 3200,
    advance: 200,
    status: "In-Progress",
    shopExpense: "A",
    serviceDate: TODAY,
  });
  const beforeRow = before.ok
    ? (await send(page, "GET", `/api/services/${before.body.id}`)).body
    : null;

  // ---------- UI: grid, preset, clear, bidirectional converter ----------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="cipher-mode-custom"]', { timeout: 15000 });
  await page.click('[data-testid="cipher-mode-custom"]');
  await page.waitForSelector('[data-testid="cipher-multi-grid"]', { timeout: 5000 });

  const gridShape = await page.evaluate(() => ({
    fields: document.querySelectorAll('[data-testid="cipher-multi-grid"] input').length,
    legacySlots: document.querySelectorAll('[data-testid^="cipher-slot-"]').length,
    pair: !!document.querySelector('[data-testid="cipher-group-00"]'),
  }));
  check(
    "U7",
    "grid shows all eleven digit fields while keeping ten legacy slots",
    gridShape.fields === 11 && gridShape.legacySlots === 10 && gridShape.pair,
    JSON.stringify(gridShape)
  );

  await page.click('[data-testid="cipher-preset-keypad"]');
  const presetValues = await page.evaluate(() => ({
    one: document.querySelector('[data-testid="cipher-slot-1"]')?.value,
    two: document.querySelector('[data-testid="cipher-slot-2"]')?.value,
    zero: document.querySelector('[data-testid="cipher-slot-0"]')?.value,
    pair: document.querySelector('[data-testid="cipher-group-00"]')?.value,
  }));
  check(
    "U8",
    "keypad preset populates multi-character fields including the 00 pair",
    presetValues.one === "*" &&
      presetValues.two === "A, B, C" &&
      presetValues.zero === "+" &&
      presetValues.pair === "#",
    JSON.stringify(presetValues)
  );

  await typeInto(page, "cipher-test-amount", "1500");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent?.includes("*J#"),
    { polling: 100, timeout: 5000 }
  );
  await typeInto(page, "cipher-test-code", "*J#");
  const forward = await page.$eval('[data-testid="cipher-decoded"]', (el) => el.innerText);
  await typeInto(page, "cipher-test-code", "*K#");
  const alternate = await page.$eval('[data-testid="cipher-decoded"]', (el) => el.innerText);
  check(
    "U9",
    "converter decodes *J# and alternate *K# into the Bengali amount badge",
    forward.includes(bnMoney(1500)) && alternate.includes(bnMoney(1500)),
    JSON.stringify({ forward, alternate })
  );

  await page.click('[data-testid="cipher-clear-groups"]');
  const cleared = await page.evaluate(() => ({
    filled: [...document.querySelectorAll('[data-testid="cipher-multi-grid"] input')].some(
      (el) => el.value.length > 0
    ),
    syncDisabled: document.querySelector('[data-testid="cipher-sync-global"]')?.disabled,
  }));
  check(
    "U10",
    "clear resets every field and disables the global sync button",
    !cleared.filled && cleared.syncDisabled === true,
    JSON.stringify(cleared)
  );

  // ---------- UI: real-time collision on the multi-char grid ----------
  // All required digits must be filled first — an empty field is reported
  // before the duplicate scan, exactly as the engine contract specifies.
  await page.click('[data-testid="cipher-preset-keypad"]');
  await typeInto(page, "cipher-slot-2", "B, C");
  await typeInto(page, "cipher-slot-5", "B, J");
  await waitText(COLLISION);
  const uiCollision = await page.evaluate((msg) => {
    const field = (id) => document.querySelector(`[data-testid="${id}"]`);
    return {
      inline: document.body.textContent.includes(msg),
      secondInvalid: field("cipher-slot-2")?.getAttribute("aria-invalid") === "true",
      fifthInvalid: field("cipher-slot-5")?.getAttribute("aria-invalid") === "true",
      syncDisabled: field("cipher-sync-global")?.disabled === true,
    };
  }, COLLISION);
  check(
    "U11",
    "duplicate B across digit 2 and 5 marks both fields and blocks sync",
    uiCollision.inline &&
      uiCollision.secondInvalid &&
      uiCollision.fifthInvalid &&
      uiCollision.syncDisabled,
    JSON.stringify(uiCollision)
  );

  // ---------- One-click global sync ----------
  await page.click('[data-testid="cipher-preset-keypad"]');
  // X/Y/Z are already used by digit 9 in the keypad preset, so use symbols
  // absent from the preset — otherwise validation (correctly) blocks sync.
  await typeInto(page, "cipher-slot-2", "@, $, %");
  await page.waitForFunction(
    () => document.querySelector('[data-testid="cipher-sync-global"]')?.disabled === false,
    { polling: 100, timeout: 8000 }
  );
  await page.click('[data-testid="cipher-sync-global"]');
  await waitText(SYNC_TOAST);
  const synced = await send(page, "GET", "/api/shop-settings");
  const syncedCipher = synced.body?.settings?.secretCipher;
  check(
    "U12",
    "sync saves the multi-character map and shows the success toast",
    syncedCipher?.mode === "custom" &&
      JSON.stringify(syncedCipher?.groups?.["2"]) === JSON.stringify(["@", "$", "%"]),
    JSON.stringify(syncedCipher)
  );

  await navigate(page, "service", "/service", '[data-testid="svc-parts"]');
  const priceId = await openFirstPartPrice(page);
  await typeInto(page, priceId, "2500");
  const preview = await page.$eval('[data-testid="svc-parts"]', (el) => el.innerText);
  check(
    "U13",
    "synced cipher updates /service part-price preview without a reload",
    preview.includes("গোপন কোড: @J#") && !preview.includes("গোপন কোড: AJ#"),
    JSON.stringify({ preview: preview.slice(0, 180) })
  );

  // ---------- Stored money is untouched by the cipher change ----------
  const afterRow = before.ok
    ? (await send(page, "GET", `/api/services/${before.body.id}`)).body
    : null;
  const sameMoney =
    beforeRow &&
    afterRow &&
    beforeRow.shopExpense === afterRow.shopExpense &&
    beforeRow.expenseAmount === afterRow.expenseAmount &&
    beforeRow.totalBill === afterRow.totalBill &&
    beforeRow.advance === afterRow.advance &&
    beforeRow.due === afterRow.due;
  check(
    "U14",
    "existing service codes and financial fields are unchanged after sync",
    !!sameMoney,
    JSON.stringify({ before: beforeRow, after: afterRow })
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("SECRET-CODE SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
