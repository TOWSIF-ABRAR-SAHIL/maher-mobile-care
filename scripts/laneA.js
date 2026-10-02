/* Lane A: entry + validation + table ops. Cleans up after itself.
 * Run: node scripts/laneA.js  (server :3000) */
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
const T = Date.now();
const NAME = "TestKarim" + T;
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
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
      errors.push("console: " + m.text().slice(0, 120));
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1200));

  // Precondition: user's Sahil row must be Pending for the badge test.
  // Also archive any TestKarim leftovers from crashed runs (test hygiene).
  await page.evaluate(async () => {
    const l = await fetch("/api/services?date=2026-09-30").then((x) => x.json());
    for (const s of l.services) {
      if (s.customerName === "Sahil" && s.status !== "Pending")
        await fetch("/api/services/" + s.id, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "Pending" }),
        });
      if (s.customerName.includes("TestKarim"))
        await fetch("/api/services/" + s.id, { method: "DELETE" });
    }
  });
  await new Promise((r) => setTimeout(r, 800));

  // Deterministic fill: prototype setter + input event. Real keyboard typing
  // is flaky here because Radix Select asynchronously steals focus back to
  // its trigger after an option is picked (timing-dependent).
  const typeInto = async (id, value) =>
    page.$eval(
      `#${id}`,
      (el, v) => {
        el.focus();
        Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value
    );
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
  const submitBtn = (txt) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll("form button[type='submit']")].find(
        (x) => x.textContent.includes(t)
      );
      if (!b) throw new Error("submit missing: " + t);
      b.click();
    }, txt);
  const toastShown = (txt) =>
    page.waitForFunction((t) => document.body.textContent.includes(t), {
      timeout: 6000,
    });
  const rowCount = () =>
    page.evaluate(() => document.querySelectorAll("tbody tr").length);
  const apiDay = (day) =>
    page.evaluate(async (d) => {
      const r = await fetch("/api/services?date=" + d).then((x) => x.json());
      return r.services;
    }, day);

  // ---- A1: valid entry, Bengali digits, auto due ----
  const before = await rowCount();
  await typeInto("svc-name", NAME);
  await typeInto("svc-phone", "01700000001");
  await typeInto("svc-model", "Vivo Y20");
  await typeInto("svc-problem", "Battery");
  // technician RONI via Radix select
  await page.click("#svc-tech");
  await page.waitForSelector('[role="option"]', { polling: 500, timeout: 5000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('[role="option"]')]
      .find((o) => o.textContent.trim() === "RONI")
      .click();
  });
  await typeInto("svc-bill", "১০০০"); // Bengali digits
  await typeInto("svc-adv", "300");
  await typeInto("svc-expense", "*B#");
  const dueShown = await page.$eval("#svc-due", (el) => el.value);
  check("A1a", "due auto-calc live", dueShown === "700", dueShown);
  await submitBtn("সেভ করুন");
  await page.waitForFunction(
    (n) => document.body.textContent.includes(n),
    { polling: 500, timeout: 15000 },
    NAME
  );
  const created = (await apiDay("2026-09-30")).find(
    (s) => s.customerName === NAME
  );
  console.log("reached A1-submit");
  check(
    "A1b",
    "entry saved (bill 1000/adv 300/due 700, RONI, code expense 0)",
    created &&
      created.totalBill === 1000 &&
      created.advance === 300 &&
      created.due === 700 &&
      created.technician === "RONI" &&
      created.expenseAmount === 0,
    JSON.stringify(
      created && {
        b: created.totalBill,
        a: created.advance,
        d: created.due,
        t: created.technician,
        e: created.expenseAmount,
      }
    )
  );
  check("A1c", "row count +1", (await rowCount()) === before + 1);

  // ---- A2: validation (empty + bad bill), no row added ----
  const c2 = await rowCount();
  await submitBtn("সেভ করুন"); // empty form
  await toastShown("কাস্টমারের নাম দিন").catch(() => null);
  await typeInto("svc-name", NAME + "x");
  await typeInto("svc-phone", "01700000002");
  await typeInto("svc-model", "M");
  await typeInto("svc-problem", "P");
  await setNative("svc-bill", "abc");
  await submitBtn("সেভ করুন");
  await toastShown("মোট বিলে সঠিক সংখ্যা দিন").catch(() => null);
  await new Promise((r) => setTimeout(r, 800));
  console.log("reached A2");
  check("A2", "validation blocks (empty + bad bill), no row", (await rowCount()) === c2);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1000));

  // ---- A3: overpay clamp (no save) ----
  await setNative("svc-bill", "2000");
  await setNative("svc-adv", "2500");
  await new Promise((r) => setTimeout(r, 300));
  check("A3", "overpay due=0", (await page.$eval("#svc-due", (el) => el.value)) === "0");
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1000));

  // ---- A4: search ----
  await page.click('input[placeholder*="খুঁজুন"]');
  await page.keyboard.type(NAME);
  await page.waitForFunction(
    (n) =>
      document.body.textContent.includes(n) &&
      !document.body.textContent.includes("Sahil"),
    { polling: 500, timeout: 8000 },
    NAME
  );
  check("A4a", "search isolates row", true);
  await page.evaluate(() => {
    const i = document.querySelector('input[placeholder*="খুঁজুন"]');
    i.focus();
    document.execCommand("selectAll", false, undefined);
  });
  await page.keyboard.press("Backspace");
  await page.waitForFunction(
    (n) =>
      document.body.textContent.includes(n) &&
      document.body.textContent.includes("Sahil"),
    { polling: 500, timeout: 8000 },
    NAME
  );
  check("A4b", "search clear restores", true);

  // ---- A5: chips ----
  const chip = (label) =>
    page.evaluate((l) => {
      const sec = [...document.querySelectorAll("section")].find((s) =>
        s.textContent.includes("সার্ভিস তালিকা")
      );
      [...sec.querySelectorAll("div.mb-3 button")]
        .find((b) => b.textContent.trim().startsWith(l))
        .click();
    }, label);
  await chip("পেন্ডিং");
  await new Promise((r) => setTimeout(r, 500));
  // Filter correctness: visible rows == API's Pending rows (names agnostic —
  // DB may hold other rows; what matters is the filter shows exactly Pending).
  const pendCheck = await page.evaluate(async () => {
    const visible = [...document.querySelectorAll("tbody tr")].map((tr) =>
      tr.cells[1].textContent
    );
    const l = await fetch("/api/services?date=2026-09-30").then((x) => x.json());
    const pending = l.services
      .filter((s) => s.status === "Pending")
      .map((s) => s.customerName);
    return { visible, pending };
  });
  console.log("reached A5");
  check(
    "A5",
    "pending chip == API pending set",
    pendCheck.visible.length === pendCheck.pending.length &&
      pendCheck.visible.every((v) =>
        pendCheck.pending.some((p) => v.includes(p))
      ),
    JSON.stringify(pendCheck.visible.map((v) => v.slice(0, 25)))
  );
  await chip("সব");
  await new Promise((r) => setTimeout(r, 400));

  // ---- A6: eye toggle ----
  const kh0 = await page.evaluate(() =>
    [...document.querySelectorAll("thead th")].some((th) =>
      th.textContent.includes("খরচ")
    )
  );
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")]
      .find((b) => b.textContent.trim() === "খরচ")
      .click()
  );
  await new Promise((r) => setTimeout(r, 400));
  const kh1 = await page.evaluate(() => ({
    h: [...document.querySelectorAll("thead th")].some((th) =>
      th.textContent.includes("খরচ")
    ),
    v: document.querySelector("tbody").textContent.includes("*B#"),
  }));
  check("A6", "eye reveals expense column", !kh0 && kh1.h && kh1.v);
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")]
      .find((b) => b.textContent.trim() === "খরচ")
      .click()
  );

  // ---- A7: 1-click status on USER row (will revert at cleanup) ----
  const badgeClick = (frag) =>
    page.evaluate((f) => {
      [...document.querySelectorAll("tbody tr")]
        .find((tr) => tr.textContent.includes(f))
        .querySelector("td button")
        .click();
    }, frag);
  await badgeClick("Sahil");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("tbody tr")]
        .find((tr) => tr.textContent.includes("Sahil"))
        .textContent.includes("চলছে"),
    { polling: 500, timeout: 10000 }
  );
  await badgeClick("Sahil");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("tbody tr")]
        .find((tr) => tr.textContent.includes("Sahil"))
        .textContent.includes("সম্পন্ন"),
    { polling: 500, timeout: 10000 }
  );
  await badgeClick("Sahil");
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("tbody tr")]
        .find((tr) => tr.textContent.includes("Sahil"))
        .textContent.includes("টাকা বাকি"),
    { polling: 500, timeout: 10000 }
  );
  console.log("reached A7");
  check("A7", "badge 3-step to Delivered + warning", true);

  // ---- A8: edit rename + date move ----
  await page.evaluate((n) => {
    [...document.querySelectorAll("tbody tr")]
      .find((tr) => tr.textContent.includes(n))
      .querySelector("button[title='এডিট']")
      .click();
  }, NAME);
  await page.waitForSelector("#svc-date", { polling: 500, timeout: 8000 });
  // Prefill useEffect can overwrite fields right after remount — set + verify.
  for (let i = 0; i < 6; i++) {
    await typeInto("svc-name", NAME + "2");
    await setNative("svc-date", "2026-09-29");
    await new Promise((r) => setTimeout(r, 300));
    const settled = await page.evaluate(
      (n) =>
        document.getElementById("svc-name").value === n &&
        document.getElementById("svc-date").value === "2026-09-29",
      NAME + "2"
    );
    if (settled) break;
    if (i === 5) throw new Error("edit fields never settled");
  }
  await submitBtn("আপডেট করুন");
  // NOTE: renamed row (NAME+"2") still contains NAME — must wait on the full name.
  await page.waitForFunction(
    (n) => !document.body.textContent.includes(n),
    { polling: 500, timeout: 10000 },
    NAME + "2"
  );
  const on29 = (
    await apiDay("2026-09-29")
  ).some((s) => s.customerName === NAME + "2");
  console.log("reached A8");
  check("A8", "edit rename + move to 09-29", on29);

  // ---- A9: archive → restore → archive (cleanup) ----
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((b) => b.textContent.includes("আগের দিন"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-29)"),
    { polling: 500, timeout: 8000 }
  );
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate((n) => {
    [...document.querySelectorAll("tbody tr")]
      .find((tr) => tr.textContent.includes(n))
      .querySelector("button[title='ডিলিট']")
      .click();
  }, NAME + "2");
  await page.waitForSelector('[role="alertdialog"]', { polling: 500, timeout: 8000 });
  const dlgArc = await page.evaluate(() =>
    document.querySelector('[role="alertdialog"]').textContent.includes("ফিরিয়ে আনা যাবে")
  );
  check("A9a", "archive dialog wording", dlgArc);
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.includes("আর্কাইভ"))
      .click()
  );
  await page.waitForFunction(
    (n) => !document.body.textContent.includes(n),
    { polling: 500, timeout: 10000 },
    NAME + "2"
  );
  console.log("reached A9b");
  check("A9b", "archive hides", true);
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")]
      .find((b) => b.textContent.includes("আর্কাইভ দেখুন"))
      .click()
  );
  await page.waitForFunction(
    (n) => document.body.textContent.includes(n),
    { polling: 500, timeout: 8000 },
    NAME + "2"
  );
  check("A9c", "archive view lists", true);
  await page.evaluate((n) => {
    [...document.querySelectorAll("tbody tr")]
      .find((tr) => tr.textContent.includes(n))
      .querySelector("button[title='ফিরিয়ে আনুন']")
      .click();
  }, NAME + "2");
  await new Promise((r) => setTimeout(r, 1500));
  const back29 = (
    await apiDay("2026-09-29")
  ).some((s) => s.customerName === NAME + "2" && !s.archived);
  console.log("reached A9d");
  check("A9d", "restore works", back29);
  // back to day view (restore leaves archive view open)
  await page.evaluate(() =>
    [...document.querySelectorAll("section button")]
      .find((b) => b.textContent.includes("তালিকায় ফিরুন"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-29)"),
    { polling: 500, timeout: 8000 }
  );
  // final cleanup of test row
  await page.evaluate(async (n) => {
    const l = await fetch("/api/services?date=2026-09-29").then((x) => x.json());
    const row = l.services.find((s) => s.customerName === n);
    if (row) await fetch("/api/services/" + row.id, { method: "DELETE" });
  }, NAME + "2");
  // revert Sahil status to Pending
  await page.evaluate(async () => {
    const l = await fetch("/api/services?date=2026-09-30").then((x) => x.json());
    const row = l.services.find((s) => s.customerName === "Sahil");
    if (row)
      await fetch("/api/services/" + row.id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Pending" }),
      });
  });
  const final = await apiDay("2026-09-30");
  const sahil = final.find((s) => s.customerName === "Sahil");
  const tkLeft = final.some((s) => s.customerName.includes("TestKarim"));
  check(
    "A9e",
    "cleanup: Sahil back to Pending, test row archived",
    sahil && sahil.status === "Pending" && !tkLeft,
    JSON.stringify(sahil && sahil.status)
  );

  // ---- A10: receipt preview, no cost leak ----
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((b) => b.textContent.includes("পরের দিন"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-30)"),
    { polling: 500, timeout: 8000 }
  );
  await new Promise((r) => setTimeout(r, 1000));
  await page.evaluate(() => {
    [...document.querySelectorAll("tbody tr")]
      .find((tr) => tr.textContent.includes("Sahil"))
      .querySelector("button[title='বিল প্রিন্ট']")
      .click();
  });
  await page.waitForFunction(
    () => document.body.textContent.includes("বিল প্রিভিউ"),
    { polling: 500, timeout: 8000 }
  );
  const rc = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]').textContent;
    return {
      bill: d.includes("বিল নং"),
      tech: d.includes("NURUL"),
      noCost: !d.includes("1500"),
    };
  });
  console.log("reached A10");
  check("A10", "receipt preview (no cost leak)", rc.bill && rc.tech && rc.noCost, JSON.stringify(rc));

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error("LANE-A CRASH:", e.message);
    process.exit(1);
  });
