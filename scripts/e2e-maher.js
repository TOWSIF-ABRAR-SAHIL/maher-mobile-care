/* E2E smoke test for MAHER MOBILE CARE.
 * Run directly only against a throwaway database: npm test sets MAHER_TEST_URL.
 */
const {
  api,
  closeBrowser,
  clickDailyRowButton,
  dailyRows,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
} = require("./test-support");
const os = require("node:os");
const path = require("node:path");

// Screenshots live in the OS temp dir — "/tmp/..." would resolve to D:\tmp on
// Windows and fail with ENOENT before the suite's first real check.
const shot = (name) => path.join(os.tmpdir(), name);

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const E2E_NAME = uniqueName("E2E Test ");
let failed = false;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { timeout: 15000 }
  );

  // Deterministic fill via the shared test-support helpers.

  // 1. Create via the entry form (plain HTML form submit)
  await typeInto(page,"svc-name", E2E_NAME);
  await typeInto(page,"svc-phone", "01000000099");
  await typeInto(page,"svc-model", "E2E Model");
  await typeInto(page,"svc-problem", "E2E সমস্যা");
  // Native-setter technique: direct el.value assignment is swallowed by
  // React 18's instance value-tracker (no onChange fires). The prototype
  // setter bypasses the tracker so the change is detected.
  const setNative = (id, value) =>
    page.$eval(
      `#${id}`,
      (el, v) => {
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value
    );
  await setNative("svc-bill", "2000");
  await setNative("svc-adv", "500");
  // due auto-calc shows 1,500?
  await page.waitForFunction(
    () => document.getElementById("svc-due")?.value === "1,500",
    { timeout: 5000 }
  );
  check("due auto-calculates (2000-500=1500)", true);
  await page.screenshot({ path: shot("maher-form.png") });
  await submitButton(page, "সেভ করুন");
  await waitDailyRow(page, E2E_NAME, true);
  check("create service via form", true);

  // verify server-side totals
  const createdResponse = await api(page, `/api/services?date=${TODAY}`);
  const created = createdResponse.body.services.find(
    (s) => s.customerName === E2E_NAME
  );
  check(
    "server totals (bill 2000, adv 500, due 1500)",
    created && created.totalBill === 2000 && created.advance === 500 && created.due === 1500,
    JSON.stringify(created && { b: created.totalBill, a: created.advance, d: created.due })
  );

  // 2. Edit: click pencil on the new daily row → form pre-fills → update
  await clickDailyRowButton(page, E2E_NAME, "এডিট");
  await page.waitForFunction(
    () => document.body.textContent.includes("আপডেট করুন"),
    { timeout: 8000 }
  );
  const prefilled = await page.$eval("#svc-name", (el) => el.value);
  check("edit pre-fills form", prefilled === E2E_NAME, prefilled);
  await typeInto(page,"svc-problem", "E2E সমস্যা আপডেট");
  await submitButton(page, "আপডেট করুন");
  await waitDailyRow(page, "E2E সমস্যা আপডেট", true);
  check("update service", true);

  // 3. Search filters the table (seed-independent: use our own row).
  // Typing goes through the React value setter instead of page.click() +
  // keyboard, so a sticky header or an overlapping element can never swallow
  // the keystrokes and make this step time out for the wrong reason.
  await typeInto(page, "svc-search", "ZZZ_NO_MATCH_XYZ");
  await page.waitForFunction(
    () => document.body.textContent.includes("কোন সার্ভিস এন্ট্রি নেই"),
    { timeout: 8000 }
  );
  check("search no-match empty state", true);
  // Full reload: guarantees the search box is empty so later steps
  // see the unfiltered day list (no leftover query can pollute them).
  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { timeout: 15000 }
  );

  // 4. Date navigation: previous day shows its own title + list.
  // Compare against yesterday's API count — never an absolute 0, so suite
  // order can't break this (suites share one throwaway DB).
  const yesterdayApiCount = (await api(page, `/api/services?date=${YESTERDAY}`)).body
    .services.length;
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")].find((b) => b.textContent.includes("আগের দিন")).click()
  );
  await page.waitForFunction(
    (day) => document.body.textContent.includes(`সার্ভিস তালিকা (${day})`),
    { timeout: 8000 },
    YESTERDAY
  );
  // Title updates instantly on date change, but rows arrive after fetch —
  // wait for loading skeletons to disappear before counting the daily list.
  await page.waitForFunction(
    () => document.querySelectorAll('[class*="animate-pulse"]').length === 0,
    { timeout: 10000 }
  );
  const prevCount = (await dailyRows(page)).length;
  check(
    "prev-day navigation",
    prevCount === yesterdayApiCount,
    `${prevCount} daily rows on ${YESTERDAY} (API: ${yesterdayApiCount})`
  );
  await page.screenshot({ path: shot("maher-prevday.png") });

  // back to today, delete the E2E row
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")].find((b) => b.textContent.includes("পরের দিন")).click()
  );
  await waitDailyRow(page, E2E_NAME, true);
  await clickDailyRowButton(page, E2E_NAME, "ডিলিট");
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await waitDailyRow(page, E2E_NAME, false);
  check("delete with confirm", true);

  check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("E2E CRASH:", e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
