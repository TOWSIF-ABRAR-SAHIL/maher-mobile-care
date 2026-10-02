/* P0 E2E: Aj-button, Backup, Archive/Restore, date-edit (system google-chrome).
 * Run: node scripts/e2e-p0.js  (server must be on :3100... uses :3100? no — :3000 dev)
 */
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
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

  const clickHeaderBtn = (text) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll("header button")].find((x) =>
        x.textContent.includes(t)
      );
      if (!b) throw new Error("header button missing: " + t);
      b.click();
    }, text);

  // 1. Aj button: go prev day, then back via Aj
  await clickHeaderBtn("আগের দিন");
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-29)"),
    { timeout: 8000 }
  );
  await clickHeaderBtn("আজ");
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-30)"),
    { timeout: 8000 }
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

  const typeInto = async (id, value) => {
    await page.click(`#${id}`, { clickCount: 3 });
    await page.keyboard.type(value);
  };
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
  await typeInto("svc-name", "P0 UI Row");
  await typeInto("svc-phone", "01000000111");
  await typeInto("svc-model", "P0 Model");
  await typeInto("svc-problem", "P0 test");
  await setNative("svc-bill", "3000");
  await setNative("svc-adv", "1000");
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("সেভ করুন"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("P0 UI Row"),
    { timeout: 15000 }
  );
  check("create P0 row", true);

  // 4. Archive it via dialog
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    rows.find((tr) => tr.textContent.includes("P0 UI Row")).querySelector("button[title='ডিলিট']").click();
  });
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  const dlgText = await page.evaluate(() => document.querySelector('[role="alertdialog"]').textContent);
  check("dialog says archive (not permanent)", dlgText.includes("ফিরিয়ে আনা যাবে"), dlgText.slice(0, 60));
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await page.waitForFunction(
    () => !document.body.textContent.includes("P0 UI Row"),
    { timeout: 10000 }
  );
  check("archive hides row from list", true);

  // 5. Archive view shows it (all dates) with restore
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")].find((b) => b.textContent.includes("আর্কাইভ দেখুন")).click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("P0 UI Row"),
    { timeout: 8000 }
  );
  const hasDateCol = await page.evaluate(() =>
    document.body.textContent.includes("তারিখ")
  );
  check("archive view lists row + date column", hasDateCol);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    rows.find((tr) => tr.textContent.includes("P0 UI Row")).querySelector("button[title='ফিরিয়ে আনুন']").click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll("section button")].some((b) => b.textContent.includes("তালিকায় ফিরুন")) &&
      !document.body.textContent.includes("P0 UI Row"),
    { timeout: 10000 }
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")].find((b) => b.textContent.includes("তালিকায় ফিরুন")).click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("P0 UI Row"),
    { timeout: 8000 }
  );
  check("restore brings row back", true);

  // 6. Edit form has date field → move row to 09-29
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    rows.find((tr) => tr.textContent.includes("P0 UI Row")).querySelector("button[title='এডিট']").click();
  });
  await page.waitForSelector("#svc-date", { timeout: 8000 });
  const dateVal = await page.$eval("#svc-date", (el) => el.value);
  check("edit form shows date field", dateVal === "2026-09-30", dateVal);
  await setNative("svc-date", "2026-09-29");
  await page.evaluate(() =>
    [...document.querySelectorAll("form button[type='submit']")]
      .find((b) => b.textContent.includes("আপডেট করুন"))
      .click()
  );
  await page.waitForFunction(
    () => !document.body.textContent.includes("P0 UI Row"),
    { timeout: 10000 }
  );
  check("date edit moves row off today", true);
  await clickHeaderBtn("আগের দিন");
  await page.waitForFunction(
    () => document.body.textContent.includes("P0 UI Row"),
    { timeout: 8000 }
  );
  check("moved row visible on 09-29", true);

  // 7. Cleanup: archive the moved row (DB stays clean)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tbody tr")];
    rows.find((tr) => tr.textContent.includes("P0 UI Row")).querySelector("button[title='ডিলিট']").click();
  });
  await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent.includes("আর্কাইভ")).click()
  );
  await page.waitForFunction(
    () => !document.body.textContent.includes("P0 UI Row"),
    { timeout: 10000 }
  );
  check("cleanup archive", true);

  check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error("E2E CRASH:", e.message);
    process.exit(1);
  });
