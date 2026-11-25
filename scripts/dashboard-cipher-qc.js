/* QC screenshot findings for the Secret Code Engine and Converter.
 *
 * Pins the live bidirectional converter, the single 11-card keypad layout,
 * real-time collision styling/banner, and the visually hidden legacy word
 * field. Runs only on a throwaway database via npm test.
 */
const {
  closeBrowser,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  typeInto,
} = require("./test-support");

const BASE = resolveTestBase();
const COLLISION =
  "'A' অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে। প্রতিটি অক্ষর কেবল একটি ঘরে থাকতে পারবে।";
const bnMoney = (n) =>
  `৳${String(Math.round(Number(n) || 0).toLocaleString("en-IN")).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)])}`;

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = trackErrors(page);
  const waitForText = (text) =>
    page.waitForFunction(
      (t) => document.body.textContent.includes(t),
      { polling: 100, timeout: 4000 },
      text
    ).catch(() => {});
  const badge = (testId) =>
    page.$eval(`[data-testid="${testId}"]`, (el) => el.textContent.trim());

  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-title"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="cipher-converter"]', { timeout: 15000 });
  // Q14 saves through the global sync alias; an empty fresh profile would be
  // rejected, so this suite supplies its own explicit tenant name first.
  await typeInto(page, "setting-shop-name", "Cipher QC Shop");

  // Q1: the default keypad still encodes the shop's canonical example.
  // The converter starts empty now, so type the example before reading it.
  await typeInto(page, "cipher-test-amount", "1500");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent.includes("*J#"),
    { polling: 100, timeout: 3000 }
  ).catch(() => {});
  const forward = await badge("cipher-encoded");
  check(
    "Q1",
    "money 1500 encodes to *J# in keypad mode",
    forward.includes("*J#"),
    JSON.stringify({ forward })
  );

  // Q2: an empty money field must not be coerced to 0 (which encodes as '+').
  await typeInto(page, "cipher-test-amount", "");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent.trim() ===
      "—",
    { polling: 100, timeout: 3000 }
  ).catch(() => {});
  const emptyBadge = await badge("cipher-encoded");
  check(
    "Q2",
    "empty money input shows a clean dash instead of '+'",
    emptyBadge === "—",
    JSON.stringify({ emptyBadge })
  );
  await typeInto(page, "cipher-test-amount", "1500");

  // Q3: one unified 11-card grid, no mirrored 12th card.
  const cards = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="cipher-keypad"]');
    return [...(grid?.children ?? [])].map((el) => el.textContent.trim());
  });
  check(
    "Q3",
    "keypad shows exactly 11 cards including ১=* and ২=ABC",
    cards.length === 11 &&
      (cards[0] ?? "").includes("*") &&
      (cards[1] ?? "").includes("A, B, C") &&
      (cards[10] ?? "").includes("#"),
    JSON.stringify({ count: cards.length, first: cards[0], last: cards[10] })
  );

  // Q4: reverse decoding is live in keypad mode too.
  await typeInto(page, "cipher-test-code", "*J#");
  await page.waitForFunction(
    (amount) =>
      document.querySelector('[data-testid="cipher-decoded"]')?.textContent.includes(
        amount
      ),
    { polling: 100, timeout: 3000 },
    bnMoney(1500)
  ).catch(() => {});
  const keypadDecode = await badge("cipher-decoded");
  check(
    "Q4",
    "code *J# instantly decodes to Bengali-digit ৳১,৫০০",
    keypadDecode.includes(bnMoney(1500)),
    JSON.stringify({ keypadDecode, expected: bnMoney(1500) })
  );

  // Q5: the documented phone glyphs decode even with a custom alphabet active.
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  await page.waitForSelector('[data-testid="cipher-multi-grid"]', { timeout: 5000 });
  // The starter seed mirrors ABCDEFGHIJ into the legacy field already; clear
  // first so the re-type is a real change event and the 00 pair resets to "".
  await typeInto(page, "cipher-word", "");
  await typeInto(page, "cipher-word", "ABCDEFGHIJ");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent.includes(
        "AEJJ"
      ),
    { polling: 100, timeout: 3000 }
  ).catch(() => {});
  await typeInto(page, "cipher-test-code", "*j#");
  await page.waitForFunction(
    (amount) =>
      document.querySelector('[data-testid="cipher-decoded"]')?.textContent.includes(
        amount
      ),
    { polling: 100, timeout: 3000 },
    bnMoney(1500)
  ).catch(() => {});
  const customDecode = await badge("cipher-decoded");
  check(
    "Q5",
    "lowercase *j# still decodes when a custom cipher is active",
    customDecode.includes(bnMoney(1500)),
    JSON.stringify({ customDecode })
  );

  // Q6: the legacy word input is kept for tests, but is visually hidden.
  const legacy = await page.$eval('[data-testid="cipher-word"]', (el) => ({
    testId: el.getAttribute("data-testid"),
    className: el.className,
    offscreen: getComputedStyle(el).position === "absolute",
    value: el.value,
  }));
  check(
    "Q6",
    "legacy cipher-word input is sr-only but still present and editable",
    legacy.testId === "cipher-word" &&
      legacy.className.includes("sr-only") &&
      legacy.offscreen &&
      legacy.value === "ABCDEFGHIJ",
    JSON.stringify(legacy)
  );

  // Q7/Q8: duplicate A in slots 1 and 2 — exact banner, exact error styling,
  // banner above both grid and converter, and both actions blocked.
  await typeInto(page, "cipher-slot-2", "A");
  await waitForText(COLLISION);
  const conflict = await page.evaluate((message) => {
    const banner = document.querySelector('[data-testid="cipher-collision-error"]');
    const grid = document.querySelector('[data-testid="cipher-multi-grid"]');
    const converter = document.querySelector('[data-testid="cipher-converter"]');
    const field = (id) => document.querySelector(`[data-testid="${id}"]`);
    const classes = (el) => (el?.className ?? "").split(/\s+/);
    const needed = [
      "border-rose-500",
      "ring-2",
      "ring-rose-400",
      "bg-rose-50/40",
      "text-rose-900",
    ];
    const one = field("cipher-slot-1");
    const two = field("cipher-slot-2");
    return {
      banner: banner?.textContent.trim() ?? "",
      aboveGrid: !!banner && !!grid &&
        banner.getBoundingClientRect().bottom <= grid.getBoundingClientRect().top + 1,
      aboveConverter: !!banner && !!converter &&
        banner.getBoundingClientRect().bottom <= converter.getBoundingClientRect().top + 1,
      firstStyled: needed.every((c) => classes(one).includes(c)),
      secondStyled: needed.every((c) => classes(two).includes(c)),
      firstInvalid: one?.getAttribute("aria-invalid") === "true",
      secondInvalid: two?.getAttribute("aria-invalid") === "true",
      saveDisabled: field("dashboard-save-settings")?.disabled === true,
      syncDisabled: field("cipher-sync-global")?.disabled === true,
      message,
    };
  }, COLLISION);
  check(
    "Q7",
    "duplicate A shows the exact banner above grid and converter",
    conflict.banner === COLLISION && conflict.aboveGrid && conflict.aboveConverter,
    JSON.stringify(conflict)
  );
  check(
    "Q8",
    "both conflicting fields get the rose error ring and aria-invalid",
    conflict.firstStyled &&
      conflict.secondStyled &&
      conflict.firstInvalid &&
      conflict.secondInvalid,
    JSON.stringify(conflict)
  );
  check(
    "Q9",
    "Save and Sync share one disabled state during a collision",
    conflict.saveDisabled && conflict.syncDisabled,
    JSON.stringify({
      saveDisabled: conflict.saveDisabled,
      syncDisabled: conflict.syncDisabled,
    })
  );

  // Q10: resolving the collision re-enables both actions together.
  await typeInto(page, "cipher-slot-2", "@, $");
  await page.waitForFunction(
    () => {
      const save = document.querySelector('[data-testid="dashboard-save-settings"]');
      const sync = document.querySelector('[data-testid="cipher-sync-global"]');
      return save?.disabled === false && sync?.disabled === false;
    },
    { polling: 100, timeout: 4000 }
  ).catch(() => {});
  const resolved = await page.evaluate(() => ({
    saveDisabled: document.querySelector('[data-testid="dashboard-save-settings"]')?.disabled,
    syncDisabled: document.querySelector('[data-testid="cipher-sync-global"]')?.disabled,
    banner: !!document.querySelector('[data-testid="cipher-collision-error"]'),
  }));
  check(
    "Q10",
    "resolved collision clears the banner and re-enables both actions",
    resolved.saveDisabled === false &&
      resolved.syncDisabled === false &&
      resolved.banner === false,
    JSON.stringify(resolved)
  );

  // Q11–Q14: the custom tab is fully reactive BEFORE any save, and the new
  // alias testids point at the live controls/results rather than empty stubs.
  await typeInto(page, "cipher-slot-1", "A");
  await typeInto(page, "cipher-slot-5", "E");
  await typeInto(page, "cipher-group-00", "K");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-encoded"]')?.textContent.trim() === "AEK",
    { polling: 100, timeout: 4000 }
  ).catch(() => {});
  const liveCustom = await page.evaluate(() => ({
    code: document.querySelector('[data-testid="cipher-taka-result"]')?.textContent.trim(),
    inputTag: document.querySelector('[data-testid="cipher-taka-input"]')?.tagName,
    inputValue: document.querySelector('[data-testid="cipher-taka-input"]')?.value,
  }));
  check(
    "Q11",
    "live custom map 1=A, 5=E, 00=K converts 1500 → AEK without saving",
    liveCustom.code === "AEK" &&
      liveCustom.inputTag === "INPUT" &&
      liveCustom.inputValue === "1500",
    JSON.stringify(liveCustom)
  );

  await typeInto(page, "cipher-test-code", "AEK");
  await page.waitForFunction(
    (amount) =>
      document.querySelector('[data-testid="cipher-code-result"]')?.textContent.includes(amount),
    { polling: 100, timeout: 4000 },
    bnMoney(1500)
  ).catch(() => {});
  const liveDecode = await badge("cipher-code-result");
  check(
    "Q12",
    "AEK instantly decodes back to ৳১,৫০০ in the aliased result",
    liveDecode.includes(bnMoney(1500)),
    JSON.stringify({ liveDecode, expected: bnMoney(1500) })
  );

  await page.$eval('[data-testid="cipher-mode-keypad"]', (el) => el.click());
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-taka-result"]')?.textContent.includes("*J#"),
    { polling: 100, timeout: 4000 }
  ).catch(() => {});
  const keypadResult = await badge("cipher-taka-result");
  await page.$eval('[data-testid="cipher-mode-custom"]', (el) => el.click());
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="cipher-taka-result"]')?.textContent.trim() === "AEK",
    { polling: 100, timeout: 4000 }
  ).catch(() => {});
  const customAgain = await badge("cipher-taka-result");
  check(
    "Q13",
    "switching tabs swaps the converter dictionary both ways",
    keypadResult.includes("*J#") && customAgain === "AEK",
    JSON.stringify({ keypadResult, customAgain })
  );

  // Q14: the aliased global-sync button persists mode + map and /service sees it.
  // Dispatch on the alias itself — a trusted page.click can land on the sticky
  // save bar after auto-scroll, which is a test-harness detail, not app logic.
  await page.$eval('[data-testid="btn-sync-cipher-global"]', (el) => el.click());
  await page.waitForFunction(
    async () => {
      const res = await fetch("/api/shop-settings", { cache: "no-store" });
      const data = await res.json();
      const cipher = data.settings?.secretCipher;
      return cipher?.mode === "custom" && cipher?.groups?.["00"]?.[0] === "K";
    },
    { polling: 200, timeout: 10000 }
  );
  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
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
  await page.$eval(
    `#${priceId}`,
    (el) => {
      el.focus();
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set.call(el, "1500");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  );
  const servicePreview = await page.$eval('[data-testid="svc-parts"]', (el) => el.innerText);
  check(
    "Q14",
    "aliased global sync persists custom mode + map and /service renders AEK",
    servicePreview.includes("গোপন কোড: AEK") &&
      !servicePreview.includes("গোপন কোড: *J#"),
    JSON.stringify({ preview: servicePreview.slice(0, 200) })
  );

  const realErrors = errors.filter((e) => !/status of 400/.test(e));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("DASHBOARD-CIPHER-QC SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
