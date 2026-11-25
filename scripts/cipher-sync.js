/* Cipher integrity + application-wide reactive sync contract.
 *
 * Covers strict collision prevention, clean keypad/custom separation, the
 * bidirectional live converter, and proof that one Dashboard save reaches
 * /service and the parts ledger through the shared provider without a hard
 * browser refresh. Runs only on a throwaway database via npm test.
 */
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

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const COLLISION = "অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে।";
const NOTICE = "সবগুলো ঘরে সঠিক অক্ষর দিন";
const WORD = "ABCDEFGHIJ";
const CODE = "AEJJ";
const bnMoney = (n) =>
  `৳${String(Math.round(Number(n) || 0).toLocaleString("en-IN")).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])}`;

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

async function send(page, method, path, body) {
  return api(page, path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
const post = (page, path, body) => send(page, "POST", path, body);
const put = (page, path, body) => send(page, "PUT", path, body);

async function navigate(page, key, href, waitSelector) {
  await page.click(`[data-nav-item="${key}"]`);
  await page.waitForFunction(
    (path) => location.pathname === path,
    { polling: 100, timeout: 15000 },
    href
  );
  await page.waitForSelector(waitSelector, { timeout: 15000 });
}

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  const get = async (url) => (await api(page, url)).body;
  const waitText = (text) =>
    page.waitForFunction(
      (t) => document.body.textContent.includes(t),
      { polling: 200, timeout: 8000 },
      text
    );
  // A sonner toast can still be on screen from an earlier save, so wait for
  // the persisted API value instead of trusting toast text alone.
  const waitCipherMode = async (mode) =>
    page.waitForFunction(
      async (m) => {
        const res = await fetch("/api/shop-settings", { cache: "no-store" });
        const data = await res.json();
        return data.settings?.secretCipher?.mode === m;
      },
      { polling: 200, timeout: 10000 },
      mode
    );
  const saveDashboard = async (mode) => {
    await page.$eval('[data-testid="dashboard-save-settings"]', (el) => el.click());
    await waitText("সব সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
    if (mode) await waitCipherMode(mode);
  };
  // Open the first part line on /service and return its real price input id
  // (the draft key starts at 1, not 0).
  const openFirstPartPrice = async () => {
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
    return page.$eval(
      '[data-testid="svc-parts"] input[id*="-price-"]',
      (el) => el.id
    );
  };

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="cipher-mode-custom"]', { timeout: 15000 });
  // A fresh profile is intentionally empty; supply this suite's own tenant
  // name before any dashboard Save persists settings.
  await typeInto(page, "setting-shop-name", "Cipher Sync Shop");

  // ---------- S1: the API rejects a character mapped to two digits ----------
  const collisionRes = await put(page, "/api/shop-settings", {
    shopName: "Cipher Sync Shop",
    secretCipher: { mode: "custom", word: "AABCDEFGH" },
  });
  check(
    "S1",
    "colliding custom characters are rejected by the settings API",
    collisionRes.status === 400,
    JSON.stringify({ status: collisionRes.status, body: collisionRes.body })
  );

  // ---------- S2–S4: real-time slot collision UI ----------
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  await page.waitForSelector('[data-testid="cipher-custom-slots"]', { timeout: 5000 });
  await typeInto(page, "cipher-slot-1", "A");
  await typeInto(page, "cipher-slot-2", "A");
  try {
    await page.waitForFunction(
      (msg) => document.body.textContent.includes(msg),
      { polling: 100, timeout: 3000 },
      COLLISION
    );
  } catch {
    // Expected while the inline collision error is not implemented yet.
  }
  const conflict = await page.evaluate((msg) => {
    const slot = (n) => document.querySelector(`[data-testid="cipher-slot-${n}"]`);
    const first = slot(1);
    const second = slot(2);
    const converter = document.querySelector('[data-testid="cipher-converter"]');
    return {
      inline: document.body.textContent.includes(msg),
      firstClass: first?.className ?? "",
      secondClass: second?.className ?? "",
      firstInvalid: first?.getAttribute("aria-invalid") === "true",
      secondInvalid: second?.getAttribute("aria-invalid") === "true",
      converter: converter?.innerText ?? "",
    };
  }, COLLISION);
  check(
    "S2",
    "duplicate characters highlight both conflicting slots with the inline error",
    conflict.inline &&
      conflict.firstInvalid &&
      conflict.secondInvalid &&
      /maher-due/.test(conflict.firstClass) &&
      /maher-due/.test(conflict.secondClass),
    JSON.stringify(conflict)
  );

  const saveDisabled = await page.$eval(
    '[data-testid="dashboard-save-settings"]',
    (el) => el.disabled === true
  );
  check("S3", "global Save is disabled until every slot is mutually exclusive", saveDisabled);

  check(
    "S4",
    "invalid custom mode shows a converter notice instead of keypad output",
    conflict.converter.includes(NOTICE) && !conflict.converter.includes("*J#"),
    JSON.stringify({ converter: conflict.converter, notice: NOTICE })
  );

  // ---------- S4a: the placeholder is never a valid cipher character ----------
  for (let i = 1; i <= 9; i += 1) {
    await typeInto(page, `cipher-slot-${i}`, "ABCDEFGHI"[i - 1]);
  }
  await typeInto(page, "cipher-slot-0", "");
  const partial = await page.evaluate(() => ({
    saveDisabled: document.querySelector('[data-testid="dashboard-save-settings"]')?.disabled,
    converter: document.querySelector('[data-testid="cipher-converter"]')?.innerText ?? "",
  }));
  check(
    "S4a",
    "one empty slot blocks Save even when the other nine are unique",
    partial.saveDisabled === true &&
      partial.converter.includes(NOTICE) &&
      !partial.converter.includes("*J#"),
    JSON.stringify(partial)
  );

  // ---------- S5: responsive custom editor at all four target widths ----------
  const responsive = {};
  for (const width of [1920, 1440, 820, 390]) {
    await page.setViewport({ width, height: 900 });
    responsive[width] = await page.evaluate(() => ({
      slots: document.querySelectorAll('[data-testid^="cipher-slot-"]').length,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
  }
  await page.setViewport({ width: 1440, height: 900 });
  check(
    "S5",
    "cipher editor keeps ten slots and zero overflow at 1920/1440/820/390",
    Object.values(responsive).every((r) => r.slots === 10 && r.overflow <= 1),
    JSON.stringify(responsive)
  );

  // ---------- S6: clean mode separation ----------
  await typeInto(page, "cipher-test-amount", "1500");
  // Dispatch on the element itself: a trusted page.click can land on the sticky
  // Save & Sync bar after auto-scroll, leaving the mode unchanged. This is the
  // same harness detail dashboard-cipher-qc.js works around.
  await page.$eval('[data-testid="cipher-mode-keypad"]', (el) => el.click());
  // The mode switch is a React state update; let the keypad rerender before
  // sampling the DOM so a fast click cannot be mistaken for a missing grid.
  await page
    .waitForFunction(
      () =>
        !!document.querySelector('[data-testid="cipher-keypad"]') &&
        document.querySelectorAll('[data-testid^="cipher-slot-"]').length === 0 &&
        (document.querySelector('[data-testid="cipher-encoded"]')?.textContent ?? "").includes("*J#"),
      { polling: 100, timeout: 5000 }
    )
    .catch(() => {});
  const keypadView = await page.evaluate(() => ({
    grid: !!document.querySelector('[data-testid="cipher-keypad"]'),
    slots: document.querySelectorAll('[data-testid^="cipher-slot-"]').length,
    collision: document.body.textContent.includes("এই অক্ষরটি ইতোমধ্যে"),
  }));
  const keypadEncoded = await page.$eval('[data-testid="cipher-encoded"]', (el) => el.innerText);
  check(
    "S6",
    "keypad preset shows the 3x4 matrix and hides custom slots and errors",
    keypadView.grid &&
      keypadView.slots === 0 &&
      !keypadView.collision &&
      keypadEncoded.includes("*J#"),
    JSON.stringify({ keypadView, keypadEncoded })
  );

  // ---------- S7: valid custom word drives both converter directions ----------
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  await page.waitForSelector('[data-testid="cipher-custom-slots"]', { timeout: 5000 });
  for (let i = 0; i < WORD.length; i += 1) {
    const digit = i === 9 ? "0" : String(i + 1);
    await typeInto(page, `cipher-slot-${digit}`, WORD[i]);
  }
  // The empty-grid starter seed puts K in the 00 pair; clear it so 1500
  // encodes with the legacy word equivalent (00 falls back to 0+0 = JJ).
  await typeInto(page, "cipher-group-00", "");
  await page.waitForFunction(
    (code) =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent?.includes(code),
    { polling: 100, timeout: 5000 },
    CODE
  );
  await typeInto(page, "cipher-test-code", CODE);
  const customDecoded = await page.$eval('[data-testid="cipher-decoded"]', (el) => el.innerText);
  const customView = await page.evaluate(() => ({
    grid: !!document.querySelector('[data-testid="cipher-keypad"]'),
    slots: document.querySelectorAll('[data-testid^="cipher-slot-"]').length,
    saveDisabled: document.querySelector('[data-testid="dashboard-save-settings"]')?.disabled,
  }));
  check(
    "S7",
    "custom mode encodes 1500 → AEJJ and decodes it back to ৳১,৫০০",
    !customView.grid &&
      customView.slots === 10 &&
      customView.saveDisabled === false &&
      customDecoded.includes(bnMoney(1500)),
    JSON.stringify({ customView, customDecoded, expected: bnMoney(1500) })
  );

  // ---------- S8: one save reaches /service without a hard refresh ----------
  await saveDashboard("custom");
  const savedSettings = await get("/api/shop-settings");
  await navigate(page, "service", "/service", '[data-testid="svc-parts"]');
  const priceId = await openFirstPartPrice();
  await typeInto(page, priceId, "1500");
  const servicePreview = await page.$eval('[data-testid="svc-parts"]', (el) => el.innerText);
  check(
    "S8",
    "saved custom cipher reaches /service part-price preview instantly",
    savedSettings.settings?.secretCipher?.mode === "custom" &&
      savedSettings.settings?.secretCipher?.word === WORD &&
      servicePreview.includes(`গোপন কোড: ${CODE}`) &&
      !servicePreview.includes("গোপন কোড: *J#"),
    JSON.stringify({
      cipher: savedSettings.settings?.secretCipher,
      preview: servicePreview.slice(0, 180),
    })
  );

  // ---------- S9: ledger decodes the active code, numeric history survives ----------
  const partName = uniqueName("CodedPart");
  const created = await post(page, "/api/services", {
    customerName: uniqueName("CipherCustomer"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "Cipher Model",
    technician: "NURUL",
    problem: "Part price code",
    totalBill: 2000,
    advance: 0,
    status: "In-Progress",
    shopExpense: "",
    serviceDate: TODAY,
    parts: [
      {
        name: partName,
        quantity: 1,
        price: CODE,
        supplier: uniqueName("CipherShop"),
        purchaseDate: TODAY,
      },
    ],
  });
  const fresh = created.ok ? await get(`/api/services/${created.body.id}`) : {};
  const partRow = fresh.parts?.[0];
  await navigate(page, "parts", "/parts", '[data-testid="service-parts-ledger"]');
  await page.waitForSelector(`[data-testid="service-part-row-${partRow?.id}"]`, {
    timeout: 15000,
  });
  await page.click(`[data-testid="part-cost-reveal-${partRow.id}"]`);
  const ledgerDecoded = await page.evaluate((id) => {
    const code = document.querySelector(`[data-testid="part-cost-code-${id}"]`);
    const decoded = document.querySelector(`[data-testid="part-cost-decoded-${id}"]`);
    return {
      code: code?.textContent ?? "",
      title: code?.getAttribute("title") ?? "",
      value: decoded?.getAttribute("data-value") ?? "",
      text: decoded?.textContent ?? "",
    };
  }, partRow.id);
  check(
    "S9",
    "parts ledger decodes the active custom code in the row and tooltip",
    created.ok &&
      partRow?.priceCode === CODE &&
      partRow?.unitCost === 1500 &&
      ledgerDecoded.code.includes(CODE) &&
      ledgerDecoded.value === "1500" &&
      ledgerDecoded.title.includes(CODE),
    JSON.stringify({ partRow, ledgerDecoded })
  );

  // ---------- S10: switching back to keypad re-syncs both consumers ----------
  await navigate(page, "dashboard", "/dashboard", '[data-testid="cipher-mode-keypad"]');
  await typeInto(page, "cipher-test-amount", "1500");
  // Client-side navigation can render the button before React attaches its
  // handler; click until the converter actually reflects the keypad preset.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.$eval('[data-testid="cipher-mode-keypad"]', (el) => el.click());
    const active = await page.evaluate(() =>
      document
        .querySelector('[data-testid="cipher-encoded"]')
        ?.textContent?.includes("*J#")
    );
    if (active) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await saveDashboard("keypad");
  const reverted = await get("/api/shop-settings");
  await navigate(page, "service", "/service", '[data-testid="svc-parts"]');
  const revertedPriceId = await openFirstPartPrice();
  await typeInto(page, revertedPriceId, "1500");
  const revertedPreview = await page.$eval('[data-testid="svc-parts"]', (el) => el.innerText);
  await navigate(page, "parts", "/parts", '[data-testid="service-parts-ledger"]');
  await page.waitForSelector(`[data-testid="service-part-row-${partRow.id}"]`, {
    timeout: 15000,
  });
  await page.click(`[data-testid="part-cost-reveal-${partRow.id}"]`);
  const afterRevert = await page.evaluate((id) => ({
    decoded: !!document.querySelector(`[data-testid="part-cost-decoded-${id}"]`),
    code: document.querySelector(`[data-testid="part-cost-code-${id}"]`)?.textContent ?? "",
  }), partRow.id);
  const history = await get(`/api/services/${created.body.id}`);
  const historicPart = (history.parts ?? []).find((p) => p.id === partRow.id);
  check(
    "S10",
    "keypad re-sync is instant while the stored numeric cost is untouched",
    reverted.settings?.secretCipher?.mode === "keypad" &&
      revertedPreview.includes("গোপন কোড: *J#") &&
      !afterRevert.decoded &&
      afterRevert.code.includes(CODE) &&
      historicPart?.unitCost === 1500 &&
      historicPart?.priceCode === CODE,
    JSON.stringify({
      cipher: reverted.settings?.secretCipher,
      preview: revertedPreview.slice(0, 180),
      afterRevert,
      historicPart,
    })
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("CIPHER-SYNC SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
