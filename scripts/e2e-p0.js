/* P0 E2E: Aj-button, Backup, Archive/Restore, date-edit.
 * Run directly only against a throwaway database: npm test sets MAHER_TEST_URL.
 */
const {
  clickDailyRowButton,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const ROW = uniqueName("P0 UI Row ");
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

  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 30000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { timeout: 15000 }
  );

  const clickHeaderBtn = (text) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('[data-testid="service-date-nav"] button')].find((x) =>
        x.textContent.includes(t)
      );
      if (!b) throw new Error("header button missing: " + t);
      b.click();
    }, text);

  // 1. Aj button: go prev day, then back via Aj
  await clickHeaderBtn("আগের দিন");
  await page.waitForFunction(
    (day) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === day,
    { timeout: 8000 },
    YESTERDAY
  );
  await clickHeaderBtn("আজ");
  await page.waitForFunction(
    (day) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === day,
    { timeout: 8000 },
    TODAY
  );
  check("Aj button returns to today", true);

  // 2. Backup endpoints through the browser session
  const snap = await page.evaluate(async () => {
    const r = await fetch("/api/backup", { method: "POST" });
    return { ok: r.ok, body: await r.json() };
  });
  check("POST /api/backup snapshot", snap.ok && snap.body.ok === true, JSON.stringify(snap.body));
  const csvHead = await page.evaluate(async () => {
    const r = await fetch("/api/backup");
    const t = await r.text();
    return { ok: r.ok, head: t.slice(0, 30), len: t.length };
  });
  check("GET /api/backup CSV", csvHead.ok && csvHead.head.startsWith("id,date,customer"), `${csvHead.len} bytes`);

  // Text entry uses the shared deterministic test-support helper.
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

  // 3. Create fresh row
  await typeInto(page,"svc-name", ROW);
  await typeInto(page,"svc-phone", "01000000111");
  await typeInto(page,"svc-model", "P0 Model");
  await typeInto(page,"svc-problem", "P0 test");
  await setNative("svc-bill", "3000");
  await setNative("svc-adv", "1000");
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("সেভ করুন"))
      .click()
  );
  await waitDailyRow(page, ROW, true);
  check("create P0 row", true);

  // 4. Archive it via dialog
  await clickDailyRowButton(page, ROW, "ডিলিট");
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  const dlgText = await page.evaluate(() => document.querySelector('[role="alertdialog"]').textContent);
  check("dialog says archive (not permanent)", dlgText.includes("ফিরিয়ে আনা যাবে"), dlgText.slice(0, 60));
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await waitDailyRow(page, ROW, false);
  check("archive hides row from list", true);

  // 5. Archive view shows it (all dates) with restore
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")].find((b) => b.textContent.includes("আর্কাইভ দেখুন")).click()
  );
  await waitDailyRow(page, ROW, true);
  const hasDateCol = await page.evaluate(() =>
    document.body.textContent.includes("তারিখ")
  );
  check("archive view lists row + date column", hasDateCol);
  await clickDailyRowButton(page, ROW, "ফিরিয়ে আনুন");
  await waitDailyRow(page, ROW, false);
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")].find((b) => b.textContent.includes("তালিকায় ফিরুন")).click()
  );
  await waitDailyRow(page, ROW, true);
  check("restore brings row back", true);

  // 6. Edit form has date field → move row to yesterday
  await clickDailyRowButton(page, ROW, "এডিট");
  await page.waitForSelector("#svc-date", { timeout: 8000 });
  const dateVal = await page.$eval("#svc-date", (el) => el.value);
  check("edit form shows date field", dateVal === TODAY, dateVal);
  await setNative("svc-date", YESTERDAY);
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("আপডেট করুন"))
      .click()
  );
  await waitDailyRow(page, ROW, false);
  check("date edit moves row off today", true);
  await clickHeaderBtn("আগের দিন");
  await waitDailyRow(page, ROW, true);
  check("moved row visible on yesterday", true);

  // 7. Cleanup: archive the moved row (test database stays clean)
  await clickDailyRowButton(page, ROW, "ডিলিট");
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await waitDailyRow(page, ROW, false);
  check("cleanup archive", true);

  check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("E2E CRASH:", e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
