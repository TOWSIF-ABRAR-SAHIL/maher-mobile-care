/* Lanes B+C: reports, backup/restore, print, mobile, keyboard.
 * Only creates ONE marker row for restore test; removes it via restore.
 * Run: node scripts/laneBC.js  (server :3000) */
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

const tk = (n) => `৳${Math.round(n).toLocaleString("en-IN")}`;

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
    if (
      m.type() === "error" &&
      !m.text().includes("favicon") &&
      !m.text().toLowerCase().includes("download")
    )
      errors.push("console: " + m.text().slice(0, 120));
  });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1500));
  const body = () => page.evaluate(() => document.body.textContent);
  const api = (path) =>
    page.evaluate(async (p) => {
      const r = await fetch(p);
      return r.json();
    }, path);

  // ---------- B1: today cards == hand calc (Sahil: 1/1700/500/1200/1500) ----------
  const t = await api("/api/stats?date=2026-09-30");
  const b = await body();
  console.log("reached B1");
  check(
    "B1",
    "today cards match hand calc",
    t.today.count === 1 &&
      b.includes(tk(1700)) &&
      b.includes(tk(1200)) &&
      b.includes(tk(1500)),
    JSON.stringify(t.today)
  );

  // ---------- B2: tech cards ----------
  const techOk = await page.evaluate(() => {
    const x = document.body.textContent;
    return (
      x.includes("NURUL") &&
      x.includes("RONI") &&
      x.includes("ASRAFUL") &&
      x.includes("NAYEM")
    );
  });
  const nurul = t.techStats.find((x) => x.technician === "NURUL");
  console.log("reached B2");
  check("B2", "tech cards (NURUL 1/1700)", techOk && nurul.count === 1 && nurul.bill === 1700);

  // ---------- B3: presets ----------
  const rangeText = () =>
    page.evaluate(() => {
      const sec = [...document.querySelectorAll("section")].find((s) =>
        s.textContent.includes("ওভারঅল রিপোর্ট")
      );
      return sec.querySelector("p").textContent;
    });
  const chip = (label) =>
    page.evaluate((l) => {
      const sec = [...document.querySelectorAll("section")].find((s) =>
        s.textContent.includes("ওভারঅল রিপোর্ট")
      );
      [...sec.querySelectorAll("button")]
        .find((x) => x.textContent.trim() === l)
        .click();
    }, label);
  await chip("এই মাস");
  await new Promise((r) => setTimeout(r, 900));
  const mSep = await api("/api/stats/monthly?from=2026-09-01&to=2026-09-30");
  console.log("reached B3");
  check(
    "B3a",
    "this-month preset (Sep, count 1)",
    (await rangeText()).includes("1 Sep") && mSep.summary.count === 1
  );
  await chip("গত মাস");
  await new Promise((r) => setTimeout(r, 900));
  const mAug = await api("/api/stats/monthly?from=2026-08-01&to=2026-08-31");
  check(
    "B3b",
    "last-month preset (Aug, count 0)",
    (await rangeText()).includes("Aug") && mAug.summary.count === 0
  );
  await chip("বিগত ৩০ দিন");
  await new Promise((r) => setTimeout(r, 900));

  // ---------- B4: custom range ----------
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) =>
      s.textContent.includes("ওভারঅল রিপোর্ট")
    );
    const [f, to] = sec.querySelectorAll('input[type="date"]');
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(f, "2026-09-29");
    set(to, "2026-09-30");
  });
  await new Promise((r) => setTimeout(r, 1000));
  const customLabel = await rangeText();
  const mCustom = await api("/api/stats/monthly?from=2026-09-29&to=2026-09-30");
  console.log("reached B4");
  check(
    "B4",
    "custom 09-29→09-30 (count 1, মোট labels)",
    customLabel.includes("29 Sep") &&
      mCustom.summary.count === 1 &&
      (await body()).includes("মোট বিল"),
    customLabel
  );

  // ---------- B5: navbar connection ----------
  await page.evaluate(() => {
    const i = document.querySelector("header input[type='date']");
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set.call(i, "2026-08-15");
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1200));
  console.log("reached B5");
  check(
    "B5a",
    "custom persists across navbar move",
    (await rangeText()).includes("29 Sep")
  );
  await chip("এই মাস");
  await new Promise((r) => setTimeout(r, 900));
  check(
    "B5b",
    "preset follows navbar (Aug)",
    (await rangeText()).includes("1 Aug")
  );
  // back to today + rolling
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((x) => x.textContent.includes("আজ"))
      .click()
  );
  await chip("বিগত ৩০ দিন");
  await new Promise((r) => setTimeout(r, 900));

  // ---------- B6: invalid range ----------
  await page.evaluate(() => {
    const sec = [...document.querySelectorAll("section")].find((s) =>
      s.textContent.includes("ওভারঅল রিপোর্ট")
    );
    const [f] = sec.querySelectorAll('input[type="date"]');
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set.call(f, "2026-10-10");
    f.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 800));
  const stillRolling = await rangeText();
  console.log("reached B6");
  check("B6", "from>to rejected, range kept", stillRolling.includes("Sep"));

  // ---------- C1: backup button ----------
  await page.evaluate(() =>
    [...document.querySelectorAll("header button")]
      .find((x) => x.textContent.includes("ব্যাকআপ"))
      .click()
  );
  await page.waitForFunction(
    () => document.body.textContent.includes("ব্যাকআপ হয়েছে"),
    { polling: 500, timeout: 15000 }
  );
  const lbl = await page.evaluate(
    () =>
      [...document.querySelectorAll("header p")].find((p) =>
        p.textContent.includes("সর্বশেষ")
      )?.textContent
  );
  console.log("reached C1");
  check("C1", "backup toast + label", !!lbl, lbl);

  // ---------- C2: restore roundtrip (marker removed via restore) ----------
  const snap = await page.evaluate(async () => {
    const r = await fetch("/api/backup", { method: "POST" });
    return r.json();
  });
  const marker = await page.evaluate(async () => {
    const r = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "RestoreMark",
        phone: "01000000333",
        model: "M",
        technician: "NURUL",
        problem: "P",
        totalBill: 100,
        advance: 0,
        status: "Pending",
        shopExpense: "",
        serviceDate: "2026-09-30",
      }),
    });
    return r.json();
  });
  const rs = await page.evaluate(async (f) => {
    const r = await fetch("/api/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: f }),
    });
    return { ok: r.ok, body: await r.json() };
  }, snap.file);
  const after = await api("/api/services?date=2026-09-30");
  console.log("reached C2");
  check(
    "C2",
    "restore roundtrip (marker gone, Sahil intact)",
    rs.ok &&
      !after.services.some((s) => s.customerName === "RestoreMark") &&
      after.services.some((s) => s.customerName === "Sahil"),
    `marker#${marker.id} removed=${!after.services.some((s) => s.id === marker.id)}`
  );

  // ---------- C3: receipt paper ----------
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
  await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: "/tmp/laneBC-receipt.png", fullPage: true });
  const paperOk = await page.evaluate(() => ({
    dashHidden: [...document.querySelectorAll("main")].every(
      (m) => getComputedStyle(m).display === "none"
    ),
    dlgHidden:
      [...document.querySelectorAll('[role="dialog"]')].every(
        (d) => getComputedStyle(d).display === "none"
      ) || !document.querySelector('[role="dialog"]'),
  }));
  console.log("reached C3");
  check("C3", "receipt paper: dashboard+dialog hidden", paperOk.dashHidden, JSON.stringify(paperOk));
  await page.emulateMediaType("screen");
  await page.keyboard.press("Escape");

  // ---------- C4: dashboard paper ----------
  await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: "/tmp/laneBC-dash.png", fullPage: true });
  const dashPaper = await page.evaluate(() => ({
    formGone: !document.querySelector("form") || getComputedStyle(document.querySelector("form")).display === "none" || document.querySelector("form").offsetParent === null,
    titleBlack: getComputedStyle(document.querySelector("header h1")).color === "rgb(0, 0, 0)",
  }));
  check("C4", "dashboard paper styled", dashPaper.formGone && dashPaper.titleBlack, JSON.stringify(dashPaper));
  await page.emulateMediaType("screen");

  // ---------- C6: keyboard ----------
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-29)"),
    { polling: 500, timeout: 8000 }
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    () => document.body.textContent.includes("সার্ভিস তালিকা (2026-09-30)"),
    { polling: 500, timeout: 8000 }
  );
  check("C6", "keyboard arrows navigate", true);

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch((e) => {
    console.error("LANE-BC CRASH:", e.message);
    process.exit(1);
  });
