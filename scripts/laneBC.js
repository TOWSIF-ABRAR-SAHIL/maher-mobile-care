/* Lanes B+C: reports, backup/restore, print, mobile, keyboard.
 * Only creates marker rows on the throwaway test database and archives the
 * report baseline at the end. npm test sets MAHER_TEST_URL. */
const {
  api,
  closeBrowser,
  clickDailyRowButton,
  dayLabel,
  dhakaToday,
  launchBrowser,
  monthContaining,
  monthLabel,
  resolveTestBase,
  shiftDay,
  trackErrors,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const THIS_MONTH = monthContaining(TODAY);
const LAST_MONTH = monthContaining(shiftDay(THIS_MONTH.from, -1));
const PROBE_DATE = `${LAST_MONTH.from.slice(0, 8)}15`;
const REPORT_BASE = uniqueName("BCBase");
const MARKER = uniqueName("RestoreMark");
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

const tk = (n) => `৳${Math.round(n).toLocaleString("en-IN")}`;

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const errors = trackErrors(page);

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 1500));
  const body = () => page.evaluate(() => document.body.textContent);
  const get = async (path) => (await api(page, path)).body;

  // Order-independent baseline: suites share this throwaway DB, and earlier
  // ones may leave active rows behind (laneA keeps a LaneARef row for today).
  // Every report check below asserts a delta from this snapshot — never an
  // absolute 1. The snapshot must be taken before the baseline row is created.
  const before = {
    day: await get(`/api/stats?date=${TODAY}`),
    month: await get(
      `/api/stats/monthly?from=${THIS_MONTH.from}&to=${THIS_MONTH.to}`
    ),
    last: await get(
      `/api/stats/monthly?from=${LAST_MONTH.from}&to=${LAST_MONTH.to}`
    ),
    custom: await get(`/api/stats/monthly?from=${YESTERDAY}&to=${TODAY}`),
  };
  const nurulBefore =
    before.day.techStats.find((x) => x.technician === "NURUL") ?? {
      count: 0,
      bill: 0,
    };

  // Self-contained report baseline: 1/1700/500/1200/1500 on the test database.
  const baseline = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: REPORT_BASE,
      phone: "01000000555",
      model: "BC Model",
      technician: "NURUL",
      problem: "Report baseline",
      totalBill: 1700,
      advance: 500,
      status: "Pending",
      shopExpense: "1500",
      serviceDate: TODAY,
    }),
  });
  if (!baseline.ok) {
    throw new Error("report baseline not created: " + JSON.stringify(baseline.body));
  }
  // The baseline was created via API — reload so the dashboard cards render it.
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 15000 },
    REPORT_BASE
  );

  // ---------- B1: today cards == snapshot + hand calc (1/1700/500/1200/1500) ----------
  const t = await get(`/api/stats?date=${TODAY}`);
  const expected = {
    count: before.day.today.count + 1,
    bill: before.day.today.bill + 1700,
    due: before.day.today.due + 1200,
    expense: before.day.today.expense + 1500,
  };
  // The cards must render the same totals the API reports.
  await page.waitForFunction(
    (bill, due, expense) => {
      const text = document.body.textContent;
      return text.includes(bill) && text.includes(due) && text.includes(expense);
    },
    { polling: 500, timeout: 10000 },
    tk(expected.bill),
    tk(expected.due),
    tk(expected.expense)
  );
  const b = await body();
  console.log("reached B1");
  check(
    "B1",
    "today cards = snapshot + hand calc (1/1700/500/1200/1500)",
    t.today.count === expected.count &&
      t.today.bill === expected.bill &&
      t.today.due === expected.due &&
      t.today.expense === expected.expense &&
      b.includes(tk(expected.bill)) &&
      b.includes(tk(expected.due)) &&
      b.includes(tk(expected.expense)),
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
  check(
    "B2",
    "tech cards (NURUL snapshot+1 / snapshot+1700)",
    techOk &&
      nurul.count === nurulBefore.count + 1 &&
      nurul.bill === nurulBefore.bill + 1700,
    JSON.stringify(nurul)
  );

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
  const mThis = await get(
    `/api/stats/monthly?from=${THIS_MONTH.from}&to=${THIS_MONTH.to}`
  );
  console.log("reached B3");
  check(
    "B3a",
    `this-month preset (${monthLabel(THIS_MONTH.from)}, snapshot+1)`,
    (await rangeText()).includes(`1 ${monthLabel(THIS_MONTH.from)}`) &&
      mThis.summary.count === before.month.summary.count + 1 &&
      mThis.summary.bill === before.month.summary.bill + 1700
  );
  await chip("গত মাস");
  await new Promise((r) => setTimeout(r, 900));
  const mLast = await get(
    `/api/stats/monthly?from=${LAST_MONTH.from}&to=${LAST_MONTH.to}`
  );
  check(
    "B3b",
    `last-month preset (${monthLabel(LAST_MONTH.from)}, untouched)`,
    (await rangeText()).includes(monthLabel(LAST_MONTH.from)) &&
      mLast.summary.count === before.last.summary.count
  );
  await chip("বিগত ৩০ দিন");
  await new Promise((r) => setTimeout(r, 900));

  // ---------- B4: custom range ----------
  await page.evaluate((from, to) => {
    const sec = [...document.querySelectorAll("section")].find((s) =>
      s.textContent.includes("ওভারঅল রিপোর্ট")
    );
    const [f, end] = sec.querySelectorAll('input[type="date"]');
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    set(f, from);
    set(end, to);
  }, YESTERDAY, TODAY);
  await new Promise((r) => setTimeout(r, 1000));
  const customLabel = await rangeText();
  const customExpected = dayLabel(YESTERDAY);
  const mCustom = await get(
    `/api/stats/monthly?from=${YESTERDAY}&to=${TODAY}`
  );
  console.log("reached B4");
  check(
    "B4",
    `custom ${YESTERDAY}→${TODAY} (snapshot+1, মোট labels)`,
    customLabel.includes(customExpected) &&
      mCustom.summary.count === before.custom.summary.count + 1 &&
      mCustom.summary.bill === before.custom.summary.bill + 1700 &&
      (await body()).includes("মোট বিল"),
    customLabel
  );

  // ---------- B5: navbar connection ----------
  await page.evaluate((probe) => {
    const i = document.querySelector("header input[type='date']");
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set.call(i, probe);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, PROBE_DATE);
  await new Promise((r) => setTimeout(r, 1200));
  console.log("reached B5");
  check(
    "B5a",
    "custom persists across navbar move",
    (await rangeText()).includes(customExpected)
  );
  await chip("এই মাস");
  await new Promise((r) => setTimeout(r, 900));
  check(
    "B5b",
    `preset follows navbar (${monthLabel(PROBE_DATE)})`,
    (await rangeText()).includes(`1 ${monthLabel(PROBE_DATE)}`)
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
  const rollingBefore = await rangeText();
  const invalidFrom = shiftDay(TODAY, 10);
  await page.evaluate((from) => {
    const sec = [...document.querySelectorAll("section")].find((s) =>
      s.textContent.includes("ওভারঅল রিপোর্ট")
    );
    const [f] = sec.querySelectorAll('input[type="date"]');
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set.call(f, from);
    f.dispatchEvent(new Event("input", { bubbles: true }));
  }, invalidFrom);
  await new Promise((r) => setTimeout(r, 800));
  const stillRolling = await rangeText();
  console.log("reached B6");
  check("B6", "from>to rejected, range kept", stillRolling === rollingBefore);

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
  const snap = await api(page, "/api/backup", { method: "POST" });
  if (!snap.ok) throw new Error("snapshot failed: " + JSON.stringify(snap.body));
  const marker = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: MARKER,
      phone: "01000000333",
      model: "M",
      technician: "NURUL",
      problem: "P",
      totalBill: 100,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }),
  });
  if (!marker.ok) throw new Error("marker failed: " + JSON.stringify(marker.body));
  const rs = await api(page, "/api/backup/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file: snap.body.file }),
  });
  const after = await get(`/api/services?date=${TODAY}`);
  console.log("reached C2");
  check(
    "C2",
    "restore roundtrip (marker gone, baseline intact)",
    rs.ok &&
      !after.services.some((s) => s.customerName === MARKER) &&
      after.services.some((s) => s.customerName === REPORT_BASE),
    `marker#${marker.body.id} removed=${!after.services.some((s) => s.id === marker.body.id)}`
  );

  // ---------- C3: receipt paper ----------
  await clickDailyRowButton(page, REPORT_BASE, "বিল প্রিন্ট");
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
  await page.evaluate(() => {
    const close = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.trim() === "বন্ধ করুন"
    );
    if (close) close.click();
  });
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { polling: 200, timeout: 8000 }
  );

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
  const titleYesterday = `সার্ভিস তালিকা (${YESTERDAY})`;
  const titleToday = `সার্ভিস তালিকা (${TODAY})`;
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    (title) => document.body.textContent.includes(title),
    { polling: 500, timeout: 8000 },
    titleYesterday
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (title) => document.body.textContent.includes(title),
    { polling: 500, timeout: 8000 },
    titleToday
  );
  check("C6", "keyboard arrows navigate", true);

  // ---------- C7: test-database cleanup ----------
  const baselineRow = (await get(`/api/services?date=${TODAY}`)).services.find(
    (s) => s.customerName === REPORT_BASE
  );
  if (baselineRow) {
    await api(page, `/api/services/${baselineRow.id}`, { method: "DELETE" });
  }
  const finalDay = await get(`/api/services?date=${TODAY}`);
  check(
    "C7",
    "baseline archived, no active laneBC rows",
    !finalDay.services.some(
      (s) =>
        s.customerName === REPORT_BASE ||
        s.customerName === MARKER ||
        s.customerName.startsWith("BCBase")
    )
  );

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-BC CRASH:", e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
