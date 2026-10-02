/* E2E smoke test for MAHER MOBILE CARE (system google-chrome).
 * Run: node scripts/e2e-maher.js  (server must be on :3100)
 */
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
const E2E_NAME = "E2E Test " + Date.now();
let failed = false;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    protocolTimeout: 60000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon"))
      errors.push("console: " + m.text().slice(0, 150));
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { timeout: 15000 }
  );

  const typeInto = async (id, value) => {
    await page.click(`#${id}`, { clickCount: 3 });
    await page.keyboard.type(value);
  };

  // 1. Create via the entry form (plain HTML form submit)
  await typeInto("svc-name", E2E_NAME);
  await typeInto("svc-phone", "01000000099");
  await typeInto("svc-model", "E2E Model");
  await typeInto("svc-problem", "E2E সমস্যা");
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
  await page.screenshot({ path: "/tmp/maher-form.png" });
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("সেভ করুন"))
      .click()
  );
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { timeout: 15000 },
    E2E_NAME
  );
  check("create service via form", true);

  // verify server-side totals
  const created = await page.evaluate(async (name) => {
    const r = await fetch("/api/services?date=2026-09-30").then((x) => x.json());
    return r.services.find((s) => s.customerName === name);
  }, E2E_NAME);
  check(
    "server totals (bill 2000, adv 500, due 1500)",
    created && created.totalBill === 2000 && created.advance === 500 && created.due === 1500,
    JSON.stringify(created && { b: created.totalBill, a: created.advance, d: created.due })
  );

  // 2. Edit: click pencil on the new row → form pre-fills → update
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    const row = rows.find((tr) => tr.textContent.includes(name));
    row.querySelector("button[title='এডিট']").click();
  }, E2E_NAME);
  await page.waitForFunction(
    () => document.body.textContent.includes("আপডেট করুন"),
    { timeout: 8000 }
  );
  const prefilled = await page.$eval("#svc-name", (el) => el.value);
  check("edit pre-fills form", prefilled === E2E_NAME, prefilled);
  await typeInto("svc-problem", "E2E সমস্যা আপডেট");
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("আপডেট করুন"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("E2E সমস্যা আপডেট"),
    { timeout: 15000 }
  );
  check("update service", true);

  // 3. Search filters the table (seed-independent: use our own row)
  await page.click('input[placeholder*="খুঁজুন"]');
  await page.keyboard.type("ZZZ_NO_MATCH_XYZ");
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
  // (Row count not asserted — DB content belongs to the user now.)
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")].find((b) => b.textContent.includes("আগের দিন")).click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-29)"),
    { timeout: 8000 }
  );
  // Title updates instantly on date change, but rows arrive after fetch —
  // wait for loading skeletons to disappear before counting.
  await page.waitForFunction(
    () => document.querySelectorAll('[class*="animate-pulse"]').length === 0,
    { timeout: 10000 }
  );
  const prevCount = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  check("prev-day navigation", true, `${prevCount} rows on 09-29`);
  await page.screenshot({ path: "/tmp/maher-prevday.png" });

  // back to today, delete the E2E row
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")].find((b) => b.textContent.includes("পরের দিন")).click()
  );
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { timeout: 8000 },
    E2E_NAME
  );
  await page.evaluate((name) => {
    const rows = [...document.querySelectorAll("tbody tr")];
    const row = rows.find((tr) => tr.textContent.includes(name));
    row.querySelector("button[title='ডিলিট']").click();
  }, E2E_NAME);
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await page.waitForFunction(
    (name) => !document.body.textContent.includes(name),
    { timeout: 10000 },
    E2E_NAME
  );
  check("delete with confirm", true);

  check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error("E2E CRASH:", e.message);
    process.exit(1);
  });
