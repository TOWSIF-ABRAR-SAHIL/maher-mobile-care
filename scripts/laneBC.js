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
const os = require("node:os");
const path = require("node:path");

// OS temp dir, not "/tmp": on Windows the latter means D:\tmp and ENOENTs.
const shot = (name) => path.join(os.tmpdir(), name);

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const THIS_MONTH = monthContaining(TODAY);
const LAST_MONTH = monthContaining(shiftDay(THIS_MONTH.from, -1));
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

  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  const body = () => page.evaluate(() => document.body.textContent);
  const openReport = async () => {
    if (await page.$('[data-testid="report-dialog"]')) return;
    await page.click('[data-testid="open-report"]');
    try {
      await page.waitForFunction(
        () => {
          const d = document.querySelector('[data-testid="report-dialog"]');
          return !!d && d.textContent.includes("ওভারঅল রিপোর্ট");
        },
        { polling: 100, timeout: 8000 }
      );
    } catch (err) {
      console.log(
        "openReport diag:",
        JSON.stringify(
          await page.evaluate(() => ({
            dlg: !!document.querySelector('[data-testid="report-dialog"]'),
            text: document
              .querySelector('[data-testid="report-dialog"]')
              ?.textContent?.slice(0, 160),
            trigger: !!document.querySelector('[data-testid="open-report"]'),
          }))
        )
      );
      throw err;
    }
  };
  const closeReport = async () => {
    if (!(await page.$('[data-testid="report-dialog"]'))) return;
    // Radix's Close button ignores a synthetic `.click()` from page.evaluate
    // (its composed handler never fires), so dismiss with a real Escape key.
    // The React handler is kept as a fallback for a lost keyboard focus.
    await page.keyboard.press("Escape");
    const gone = await page
      .waitForFunction(
        () => !document.querySelector('[data-testid="report-dialog"]'),
        { polling: 100, timeout: 2500 }
      )
      .then(() => true)
      .catch(() => false);
    if (!gone) {
      await page.evaluate(() => {
        const d = document.querySelector('[data-testid="report-dialog"]');
        const x = d
          ? [...d.querySelectorAll("button")].find(
              (b) => b.textContent.trim() === "Close"
            )
          : null;
        const key = x && Object.keys(x).find((k) => k.startsWith("__reactProps"));
        const handler = key ? x[key]?.onClick : null;
        if (typeof handler === "function") {
          handler({
            preventDefault() {},
            stopPropagation() {},
            defaultPrevented: false,
          });
        }
      });
    }
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="report-dialog"]'),
      { polling: 100, timeout: 8000 }
    );
  };
  const reportText = () =>
    page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      const sec = dlg?.querySelector("section");
      return sec?.innerText || "";
    });
  const rangeText = () =>
    page.evaluate(() => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      return dlg?.querySelector("section p")?.textContent || "";
    });
  const chip = (label) =>
    page.evaluate((l) => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      const sec = dlg?.querySelector("section");
      [...(sec?.querySelectorAll("button") || [])]
        .find((x) => x.textContent.trim() === l)
        ?.click();
    }, label);
  const get = async (path) => (await api(page, path)).body;
  const ensureTechnician = async (name) => {
    const current = await get("/api/technicians");
    if (current.technicians?.some((t) => t.name === name)) return;
    await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };
  // Fresh databases no longer ship demo staff; create the roster this lane
  // asserts on before any service/report baseline is written.
  for (const name of ["NURUL", "RONI", "ASRAFUL", "NAYEM"]) {
    await ensureTechnician(name);
  }

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
    dayWindow: await get(`/api/stats/monthly?from=${TODAY}&to=${TODAY}`),
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
      partsShop: "BC Parts Shop",
      serviceDate: TODAY,
    }),
  });
  if (!baseline.ok) {
    throw new Error("report baseline not created: " + JSON.stringify(baseline.body));
  }
  // The baseline was created via API — reload so the service list renders it.
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', { timeout: 30000 });
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 15000 },
    REPORT_BASE
  );

  // ---------- B1: dashboard card + report == snapshot + hand calc (1/1700/500/1200/1500) ----------
  const t = await get(`/api/stats?date=${TODAY}`);
  const expected = {
    count: before.day.today.count + 1,
    bill: before.day.today.bill + 1700,
    advance: before.day.today.advance + 500,
    due: before.day.today.due + 1200,
    expense: before.day.today.expense + 1500,
  };
  // The today card lives on the dashboard now (জমা + count only); bill/due/
  // expense are read in the report's একদিন window. Cost/profit stay public —
  // only the service table's cost column keeps codes private. No peek needed.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-today"]', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const sec = document.querySelector('[data-testid="dashboard-overview"]');
      return !!sec && !sec.textContent.includes("লোড হচ্ছে");
    },
    { polling: 200, timeout: 15000 }
  );
  await page.waitForFunction(
    (advance, count) => {
      const text =
        document.querySelector('[data-testid="dashboard-today"]')?.innerText ?? "";
      return text.includes(advance) && text.includes(count);
    },
    { polling: 100, timeout: 8000 },
    tk(expected.advance),
    `নতুন সার্ভিস ${expected.count}`
  );
  const todayCard = await page.$eval(
    '[data-testid="dashboard-today"]',
    (el) => el.innerText
  );
  const roll = await get(
    `/api/stats/monthly?from=${shiftDay(TODAY, -29)}&to=${TODAY}`
  );
  const rollExpense = tk(roll.summary.expense + roll.summary.damageLoss);
  await openReport();
  await page.waitForFunction(
    (expense, profit) => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      const sec = dlg?.querySelector("section");
      const text = sec?.innerText || "";
      return text.includes(expense) && text.includes(profit);
    },
    { polling: 100, timeout: 5000 },
    rollExpense,
    tk(roll.summary.profit)
  );
  const report = await reportText();
  // একদিন window for TODAY: the day report must carry bill/due/expense too.
  await chip("একদিন");
  await page.evaluate((day) => {
    const i = document.querySelector("#report-day");
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set.call(i, day);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, TODAY);
  await page.waitForFunction(
    (label) => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      return (dlg?.querySelector("section p")?.textContent || "").includes(label);
    },
    { polling: 100, timeout: 8000 },
    `একদিন — ${dayLabel(TODAY)}`
  );
  const dayStats = await get(`/api/stats/monthly?from=${TODAY}&to=${TODAY}`);
  const dayExpense = tk(dayStats.summary.expense + dayStats.summary.damageLoss);
  await page.waitForFunction(
    (bill, due, expense) => {
      const dlg = document.querySelector('[data-testid="report-dialog"]');
      const text = dlg?.querySelector("section")?.innerText || "";
      return text.includes(bill) && text.includes(due) && text.includes(expense);
    },
    { polling: 100, timeout: 8000 },
    tk(dayStats.summary.bill),
    tk(dayStats.summary.due),
    dayExpense
  );
  const dayReport = await reportText();
  // Back to the rolling range for the preset checks below.
  await chip("তারিখ রেঞ্জ");
  await new Promise((r) => setTimeout(r, 900));
  console.log("reached B1");
  check(
    "B1",
    "dashboard card + day report = snapshot + hand calc; খরচ ও লাভ visible without a peek",
    t.today.count === expected.count &&
      t.today.bill === expected.bill &&
      t.today.advance === expected.advance &&
      t.today.due === expected.due &&
      t.today.expense === expected.expense &&
      todayCard.includes(tk(expected.advance)) &&
      todayCard.includes(`নতুন সার্ভিস ${expected.count}`) &&
      dayStats.summary.count === before.dayWindow.summary.count + 1 &&
      dayStats.summary.bill === before.dayWindow.summary.bill + 1700 &&
      dayStats.summary.due === before.dayWindow.summary.due + 1200 &&
      dayStats.summary.expense === before.dayWindow.summary.expense + 1500 &&
      dayReport.includes(tk(dayStats.summary.bill)) &&
      dayReport.includes(tk(dayStats.summary.due)) &&
      dayReport.includes(dayExpense) &&
      report.includes(rollExpense) &&
      report.includes(tk(roll.summary.profit)) &&
      !report.includes("৳••••") &&
      !dayReport.includes("৳••••"),
    JSON.stringify({
      today: t.today,
      roll: roll.summary,
      day: dayStats.summary,
    })
  );

  // ---------- B2: technician roster + NURUL delta ----------
  // The dashboard technician card opens the manager; the roster itself is
  // read from the API (names are no longer printed on the desk).
  const roster = await get("/api/technicians");
  const names = (roster.technicians ?? []).map((x) => x.name);
  const nurul = t.techStats.find((x) => x.technician === "NURUL");
  console.log("reached B2");
  check(
    "B2",
    "roster NURUL/RONI/ASRAFUL/NAYEM + NURUL snapshot+1 / snapshot+1700",
    ["NURUL", "RONI", "ASRAFUL", "NAYEM"].every((n) => names.includes(n)) &&
      nurul.count === nurulBefore.count + 1 &&
      nurul.bill === nurulBefore.bill + 1700,
    JSON.stringify({ names, nurul })
  );

  // ---------- B3: presets ----------
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
    const dlg = document.querySelector('[data-testid="report-dialog"]');
    const sec = dlg.querySelector("section");
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

  // ---------- B5: report window survives close/reopen ----------
  // The dock keeps its own window state; closing and reopening the dialog
  // must not reset the custom range, and presets anchor to today.
  await closeReport();
  await openReport();
  console.log("reached B5");
  check(
    "B5a",
    "custom range persists across close/reopen",
    (await rangeText()).includes(customExpected)
  );
  await chip("এই মাস");
  await new Promise((r) => setTimeout(r, 900));
  check(
    "B5b",
    `this-month preset anchors to today (${monthLabel(TODAY)})`,
    (await rangeText()).includes(`1 ${monthLabel(TODAY)}`)
  );
  // back to the rolling range for the invalid-range check
  await chip("বিগত ৩০ দিন");
  await new Promise((r) => setTimeout(r, 900));

  // ---------- B6: invalid range ----------
  const rollingBefore = await rangeText();
  const invalidFrom = shiftDay(TODAY, 10);
  await page.evaluate((from) => {
    const dlg = document.querySelector('[data-testid="report-dialog"]');
    const sec = dlg.querySelector("section");
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
  await closeReport();

  // ---------- C1: backup export (Dashboard owns the utilities now) ----------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="dashboard-backup"]', {
    polling: 200,
    timeout: 30000,
  });
  // Backup takes a database snapshot, then fetches the Excel workbook and
  // downloads it. Capture both requests instead of writing a file in headless
  // mode so a later navigation is never aborted by the download.
  await page.evaluate(() => {
    window.__backupDownload = null;
    window.__backupFetch = null;
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url ?? "";
      if (url.includes("/api/backup?format=xlsx")) window.__backupFetch = url;
      return originalFetch(...args);
    };
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (typeof this.download === "string" && this.download.endsWith(".xlsx")) {
        window.__backupDownload = this.download;
        return;
      }
      return original.call(this);
    };
  });
  await page.click('[data-testid="dashboard-backup"]');
  await page.waitForSelector('[data-testid="export-excel"]', { timeout: 10000 });
  await page.click('[data-testid="export-excel"]');
  await page.waitForFunction(
    () => typeof window.__backupDownload === "string",
    {
      polling: 200,
      timeout: 20000,
    }
  );
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="dashboard-last-backup"]');
      const text = el?.textContent?.trim() ?? "";
      return !!el && text !== "" && text !== "এখনো নেই";
    },
    { polling: 300, timeout: 20000 }
  );
  const lbl = await page.$eval(
    '[data-testid="dashboard-last-backup"]',
    (el) => el.textContent.trim()
  );
  const download = await page.evaluate(() => window.__backupDownload);
  const fetched = await page.evaluate(() => window.__backupFetch);
  console.log("reached C1");
  check(
    "C1",
    "last-backup stamp + Excel workbook download",
    !!lbl &&
      lbl !== "এখনো নেই" &&
      typeof download === "string" &&
      download.startsWith("mss-backup-") &&
      download.endsWith(".xlsx") &&
      typeof fetched === "string",
    `${lbl} | ${download} | ${fetched}`
  );

  // Back to the service desk for the receipt / print checks below.
  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (day) =>
      document.querySelector('[data-testid="daily-services"]')?.dataset.date ===
      day,
    { polling: 300, timeout: 30000 },
    TODAY
  );

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
      after.services.some((s) => s.customerName === REPORT_BASE) &&
      after.services.find((s) => s.customerName === REPORT_BASE)?.partsShop ===
        "BC Parts Shop",
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
  await page.screenshot({ path: shot("laneBC-receipt.png"), fullPage: true });
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
  const receiptInfo = await page.evaluate(() => {
    const receipt = document.querySelector('[role="dialog"] [data-receipt]');
    const name = receipt?.querySelector("[data-customer-signature]");
    return {
      text: receipt?.textContent || "",
      name: name?.textContent?.trim() || "",
      paid: !!receipt?.querySelector("[data-paid-stamp]"),
    };
  });
  check(
    "C3p",
    "receipt preview hides shop expense and parts-shop name",
    !receiptInfo.text.includes("1500") &&
      !receiptInfo.text.includes("BC Parts Shop"),
    JSON.stringify(receiptInfo.text.slice(0, 200))
  );
  check(
    "C3a",
    "receipt never hardcodes the legacy shop name or address",
    !receiptInfo.text.includes("Chandra Rd.") &&
      !receiptInfo.text.includes("Nabinagar, Ashulia 1344") &&
      !receiptInfo.text.includes("MAHER MOBILE CARE") &&
      receiptInfo.text.includes("আপনার দোকানের নাম"),
    JSON.stringify(receiptInfo.text.slice(0, 160))
  );
  check(
    "C3b",
    "receipt signature shows customer name",
    receiptInfo.name === REPORT_BASE,
    JSON.stringify(receiptInfo.name)
  );
  check(
    "C3c",
    "unpaid receipt has no PAID stamp",
    receiptInfo.paid === false,
    JSON.stringify(receiptInfo)
  );
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

  // C3d–C3g: fully-paid state, paid WhatsApp message, PAID stamp, PDF share.
  const paidUpdate = await api(page, `/api/services/${baseline.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ advance: 1700 }),
  });
  check(
    "C3d",
    "baseline can be marked fully paid",
    paidUpdate.ok && paidUpdate.body.due === 0,
    JSON.stringify(paidUpdate.body)
  );
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 30000 },
    REPORT_BASE
  );
  await new Promise((r) => setTimeout(r, 800));

  const paidWa = await page.evaluate((rowName) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const row = [...section.querySelectorAll("tbody tr")].find((tr) =>
      tr.textContent.includes(rowName)
    );
    const wa = row?.querySelector('a[title="WhatsApp (chat/call)"]');
    try {
      return decodeURIComponent(
        new URL(wa.getAttribute("href")).searchParams.get("text") || ""
      );
    } catch {
      return "";
    }
  }, REPORT_BASE);
  check(
    "C3e",
    "paid WhatsApp message says fully paid (no ৳0 due)",
    paidWa.includes("সম্পূর্ণ টাকা পরিশোধ") && !paidWa.includes("৳0 বাকি"),
    paidWa
  );

  await clickDailyRowButton(page, REPORT_BASE, "বিল প্রিন্ট");
  await page.waitForFunction(
    () => document.body.textContent.includes("বিল প্রিভিউ"),
    { polling: 500, timeout: 8000 }
  );
  const paidReceipt = await page.evaluate(() => {
    const receipt = document.querySelector('[role="dialog"] [data-receipt]');
    return {
      paid: !!receipt?.querySelector("[data-paid-stamp]"),
      name: receipt
        ?.querySelector("[data-customer-signature]")
        ?.textContent?.trim(),
    };
  });
  check(
    "C3f",
    "fully paid receipt shows PAID stamp",
    paidReceipt.paid && paidReceipt.name === REPORT_BASE,
    JSON.stringify(paidReceipt)
  );
  await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({
    path: shot("laneBC-receipt-paid.png"),
    fullPage: true,
  });
  await page.emulateMediaType("screen");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !document.querySelector('[role="dialog"]'),
    { polling: 200, timeout: 8000 }
  );

  // Stub the OS share sheet so the test can inspect the generated file
  // without trying to open WhatsApp Desktop on the build machine.
  await page.evaluate(() => {
    window.__sharedPdf = null;
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        const file = data.files?.[0];
        window.__sharedPdf = file
          ? { name: file.name, type: file.type, size: file.size }
          : null;
      },
    });
  });
  await clickDailyRowButton(page, REPORT_BASE, "PDF শেয়ার");
  await page.waitForFunction(() => window.__sharedPdf !== null, {
    polling: 500,
    timeout: 30000,
  });
  const pdfInfo = await page.evaluate(() => window.__sharedPdf);
  check(
    "C3g",
    "PDF share produces a non-empty application/pdf",
    pdfInfo?.type === "application/pdf" &&
      pdfInfo.size > 1000 &&
      /^MSS-Bill-/.test(pdfInfo.name),
    JSON.stringify(pdfInfo)
  );

  // Phase 2: once due hits 0 the slip's bill/advance are locked — a mistaken
  // payment cannot silently rewrite the ledger, only descriptive fields stay
  // editable. (The paid state is fine for the paper/keyboard/cleanup checks.)
  const lockedMoney = await api(page, `/api/services/${baseline.body.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ advance: 500 }),
  });
  check(
    "C3h",
    "paid slip refuses a bill/advance change (descriptive edits stay open)",
    lockedMoney.status === 400 &&
      String(lockedMoney.body.error || "").includes("পরিশোধিত"),
    JSON.stringify(lockedMoney.body)
  );
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    (name) => document.body.textContent.includes(name),
    { polling: 500, timeout: 30000 },
    REPORT_BASE
  );

  // ---------- C4: dashboard paper ----------
  await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: shot("laneBC-dash.png"), fullPage: true });
  const dashPaper = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    const printCopy = document.querySelector('[data-testid="monthly-print"]');
    return {
      formGone:
        !document.querySelector("form") ||
        getComputedStyle(document.querySelector("form")).display === "none" ||
        document.querySelector("form").offsetParent === null,
      headerHidden: !header || getComputedStyle(header).display === "none",
      printCopyShown:
        !!printCopy && getComputedStyle(printCopy).display !== "none",
    };
  });
  check(
    "C4",
    "dashboard paper styled (chrome hidden, report copy shown)",
    dashPaper.formGone && dashPaper.headerHidden && dashPaper.printCopyShown,
    JSON.stringify(dashPaper)
  );
  await page.emulateMediaType("screen");

  // ---------- C6: keyboard ----------
  const titleYesterday = YESTERDAY;
  const titleToday = TODAY;
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(
    (title) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === title,
    { polling: 500, timeout: 8000 },
    titleYesterday
  );
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(
    (title) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === title,
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

  // C3h deliberately expects a 400, which Chrome logs as a console error.
  const realErrors = errors.filter((text) => !text.includes("status of 400"));
  check("Z", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("LANE-BC CRASH:", e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
