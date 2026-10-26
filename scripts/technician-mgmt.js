/* v1.1 E2E: roster management (add/rename/deactivate) + clickable technician
 * cards filtering the daily table.
 *
 * Run directly only against a throwaway database: npm test sets MAHER_TEST_URL
 * and scripts/run-tests.js refuses to point this at live shop data.
 */
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dailyRows,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const DAILY = '[data-testid="daily-services"]';
const STAMP = Date.now().toString().slice(-6);
const NEW = `TESTER${STAMP}`;
const RENAMED = `RENAMED${STAMP}`;
const OTHER = `OTHER${STAMP}`;
const OWNER = uniqueName("TechOwner");

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  const allErrors = trackErrors(page);
  /**
   * This suite deliberately provokes rejections (duplicate name → 400, rename
   * needing confirmation → 409, last-technician delete → 400). Chrome logs
   * every non-2xx fetch as a console error, so those are filtered out here
   * only; real uncaught exceptions and other console errors still fail the run.
   */
  const errors = () =>
    allErrors.filter((e) => !/Failed to load resource/.test(e));

  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );

  const openManager = async () => {
    await page.evaluate(() =>
      document.querySelector('[data-testid="open-technician-manager"]')?.click()
    );
    await page.waitForSelector('[data-testid="tech-manager"]', {
      polling: 200,
      timeout: 10000,
    });
    await page.waitForFunction(
      () =>
        !document.body.textContent.includes("তালিকা আসছে") ||
        document.querySelector('[data-testid="tech-row-NURUL"]'),
      { polling: 300, timeout: 10000 }
    );
  };
  const closeManager = async () => {
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-testid="tech-manager"]'), {
      polling: 200,
      timeout: 8000,
    });
  };
  const managerRows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tech-manager"] li')].map((li) =>
        li.textContent.trim()
      )
    );
  const addTechnician = async (name) => {
    await typeInto(page, "tech-new-name", name);
    await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tech-manager"] button')]
        .find((b) => b.textContent.includes("যোগ করুন"))
        .click()
    );
  };
  const cardNames = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="tech-card"]')].map((c) => ({
        name: c.dataset.technician,
        active: c.dataset.active,
        pressed: c.getAttribute("aria-pressed"),
      }))
    );
  const clickCard = (name) =>
    page.evaluate((n) => {
      const c = document.querySelector(
        `[data-testid="tech-card"][data-technician="${n}"]`
      );
      if (!c) throw new Error("tech card missing: " + n);
      c.click();
    }, name);
  const dailyRowNames = async () => {
    const rows = await dailyRows(page);
    return rows;
  };
  // The daily row's first cell is the bare row id (no "#" prefix), and the
  // technician is NOT a column — so map the visible ids back through the API.
  const techOf = (rowText, apiRows) => {
    const id = Number((rowText.match(/^(\d+)/) || [])[1]);
    return apiRows.find((s) => s.id === id)?.technician ?? "?";
  };
  const dayRows = async () =>
    (await api(page, `/api/services?date=${TODAY}`)).body.services;

  // ---------- T1: add a technician ----------
  await openManager();
  await addTechnician(NEW);
  await page.waitForFunction(
    (n) =>
      !!document.querySelector(`[data-testid="tech-manager"] [data-testid="tech-row-${n}"]`),
    { polling: 300, timeout: 10000 },
    NEW
  );
  console.log("reached T1");
  check("T1", "new technician added and listed in the dialog", (await managerRows()).some((r) => r.includes(NEW)));

  // ---------- T4: duplicate is rejected ----------
  const rowsBeforeDup = (await managerRows()).length;
  await addTechnician(NEW.toLowerCase());
  await new Promise((r) => setTimeout(r, 800));
  check(
    "T4",
    "duplicate name rejected (case-insensitive), nothing added",
    (await managerRows()).length === rowsBeforeDup
  );

  // ---------- T2: appears in the form dropdown ----------
  await closeManager();
  await page.click("#svc-tech");
  await page.waitForSelector('[role="option"]', { polling: 300, timeout: 8000 });
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
  );
  console.log("reached T2");
  check("T2", "new technician appears in the entry form dropdown", options.includes(NEW), options.join(","));
  await page.keyboard.press("Escape");

  // ---------- T3: gets a dashboard card ----------
  const cards = await cardNames();
  check("T3", "new technician gets a stats card", cards.some((c) => c.name === NEW && c.active === "true"), cards.map((c) => c.name).join(","));

  // ---------- T9: card click filters the table ----------
  // Give NURUL one job today so the filter has something to isolate.
  const nurulJob = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: `${OWNER}A`,
      phone: "01700000111",
      model: "NurulJob",
      technician: "NURUL",
      problem: "p",
      totalBill: 500,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }),
  });
  if (!nurulJob.ok) throw new Error("seed job failed: " + JSON.stringify(nurulJob.body));
  const ownerJob = await api(page, "/api/services", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName: OWNER,
      phone: "01700000112",
      model: "OwnerJob",
      technician: NEW,
      problem: "p",
      totalBill: 700,
      advance: 0,
      status: "Pending",
      shopExpense: "",
      serviceDate: TODAY,
    }),
  });
  if (!ownerJob.ok) throw new Error("owner job failed: " + JSON.stringify(ownerJob.body));
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, OWNER, true);

  await clickCard(NEW);
  await new Promise((r) => setTimeout(r, 700));
  let rows = await dailyRowNames();
  let apiRows = await dayRows();
  let techs = rows.map((r) => techOf(r, apiRows));
  console.log("reached T9");
  check(
    "T9",
    "clicking a card filters the table to that technician",
    rows.length === 1 && rows[0].includes(OWNER) && techs.every((t) => t === NEW),
    `rows=${rows.length} techs=${techs.join(",")}`
  );

  // ---------- T12: status chips respect the filter ----------
  const chips = await page.evaluate((selector) => {
    const sec = document.querySelector(selector);
    return [...sec.querySelectorAll("div.mb-3 button")]
      .map((b) => b.textContent.trim())
      .filter((t) => /সব|পেন্ডিং|চলছে|সম্পন্ন|ডেলিভারি/.test(t));
  }, DAILY);
  check(
    "T12",
    "status chip counts describe the filtered technician only",
    chips.some((c) => c.includes("সব (1)")) && chips.some((c) => c.includes("পেন্ডিং (1)")),
    chips.join(" | ")
  );

  // ---------- T11: a different card switches the filter ----------
  await clickCard("NURUL");
  await new Promise((r) => setTimeout(r, 700));
  rows = await dailyRowNames();
  apiRows = await dayRows();
  techs = rows.map((r) => techOf(r, apiRows));
  check(
    "T11",
    "clicking another card switches the filter",
    rows.length === 1 && rows[0].includes("NurulJob") && techs.every((t) => t === "NURUL"),
    `rows=${rows.length} techs=${techs.join(",")}`
  );

  // ---------- T10: same card again clears the filter ----------
  await clickCard("NURUL");
  await new Promise((r) => setTimeout(r, 700));
  rows = await dailyRowNames();
  const noticeGone = await page.evaluate(
    () => !document.querySelector('[data-testid="tech-filter-notice"]')
  );
  check(
    "T10",
    "clicking the same card again clears the filter",
    rows.length === 2 && noticeGone,
    `rows=${rows.length} noticeGone=${noticeGone}`
  );

  // ---------- T10b: the notice's ✕ clears the filter ----------
  await clickCard(NEW);
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const n = document.querySelector('[data-testid="tech-filter-notice"]');
    [...n.querySelectorAll("button")].find((b) => b.textContent.includes("ফিল্টার সরান")).click();
  });
  await new Promise((r) => setTimeout(r, 600));
  check(
    "T10b",
    "the notice's ✕ button clears the filter",
    (await dailyRowNames()).length === 2 &&
      (await page.evaluate(() => !document.querySelector('[data-testid="tech-filter-notice"]')))
  );

  // ---------- T13: date change resets the filter ----------
  await clickCard(NEW);
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="service-date-nav"] button')]
      .find((b) => b.textContent.includes("পরের দিন"))
      .click()
  );
  await new Promise((r) => setTimeout(r, 1200));
  const resetState = await page.evaluate(() => ({
    notice: !!document.querySelector('[data-testid="tech-filter-notice"]'),
    pressed: [...document.querySelectorAll('[data-testid="tech-card"]')].some(
      (c) => c.getAttribute("aria-pressed") === "true"
    ),
  }));
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="service-date-nav"] button')]
      .find((b) => b.textContent.includes("আগের দিন"))
      .click()
  );
  await waitDailyRow(page, OWNER, true);
  console.log("reached T13");
  check(
    "T13",
    "changing the date resets the technician filter",
    !resetState.notice && !resetState.pressed,
    JSON.stringify(resetState)
  );

  // ---------- T14: filtering a technician with no work today ----------
  await addTechnicianViaApi(OTHER);
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, OWNER, true);
  await clickCard(OTHER);
  await page.waitForFunction(
    () => document.body.textContent.includes("এর কোনো কাজ নেই"),
    { polling: 300, timeout: 8000 }
  );
  check(
    "T14",
    "a technician with no jobs today shows the empty state",
    await page.evaluate(() =>
      document.body.textContent.includes(`আজ ${""}`) ||
      document.body.textContent.includes("এর কোনো কাজ নেই")
    )
  );
  await clickCard(OTHER); // clear

  // ---------- T5/T6: rename with cascade confirmation ----------
  await openManager();
  await page.evaluate((n) => {
    const row = document.querySelector(`[data-testid="tech-manager"] [data-testid="tech-row-${n}"]`);
    [...row.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes("এডিট")).click();
  }, NEW);
  await page.waitForSelector("#tech-edit-name", { polling: 300, timeout: 8000 });
  await typeInto(page, "tech-edit-name", RENAMED);
  const typed = await page.$eval("#tech-edit-name", (el) => el.value);
  check("T5-pre", "edit field holds the new name before saving", typed === RENAMED, typed);
  await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="tech-manager"] button')]
      .find((b) => b.textContent.trim() === "সেভ")
      .click()
  );
  // The API answers 409 because NEW owns one historical row — a confirm dialog
  // must appear before anything is rewritten.
  await page.waitForSelector('[role="alertdialog"]', { polling: 300, timeout: 8000 });
  const confirmText = await page.evaluate(
    () => document.querySelector('[role="alertdialog"]').textContent
  );
  console.log("reached T5");
  check(
    "T5",
    "rename with history asks for confirmation and states the count",
    confirmText.includes("পুরনো রেকর্ডের নামও বদলে যাবে") && confirmText.includes("1টি"),
    confirmText.slice(0, 120)
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.includes("হ্যাঁ, বদলান"))
      .click()
  );
  await new Promise((r) => setTimeout(r, 1500));
  const renamedRows = await managerRows();
  check(
    "T6",
    "confirmed rename applies to the roster and history",
    renamedRows.some((r) => r.includes(RENAMED)) && !renamedRows.some((r) => r.includes(NEW))
  );
  await closeManager();
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, OWNER, true);
  const cascadeTech = await page.evaluate(
    (n) => document.body.textContent.includes(n),
    RENAMED
  );
  check("T6b", "historical job now shows the new name", cascadeTech);

  // ---------- T7: soft-delete ----------
  await openManager();
  await page.evaluate((n) => {
    const row = document.querySelector(`[data-testid="tech-manager"] [data-testid="tech-row-${n}"]`);
    [...row.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.includes("ডিলিট")).click();
  }, RENAMED);
  await page.waitForSelector('[role="alertdialog"]', { polling: 300, timeout: 8000 });
  const delText = await page.evaluate(
    () => document.querySelector('[role="alertdialog"]').textContent
  );
  check(
    "T7",
    "delete confirmation warns that old records stay",
    delText.includes("ভবিষ্যতে আর ব্যবহার করা যাবে না") && delText.includes("পুরনো সার্ভিস রেকর্ড ঠিক থাকবে"),
    delText.slice(0, 120)
  );
  await page.evaluate(() =>
    [...document.querySelectorAll('[role="alertdialog"] button')]
      .find((b) => b.textContent.includes("ডিলিট"))
      .click()
  );
  // Poll for the roster refresh rather than sleeping a fixed amount: the
  // dialog refetches the roster and the parent refreshes the cards.
  await page.waitForFunction(
    (n) =>
      !!document.querySelector(
        `[data-testid="tech-manager"] [data-testid="tech-inactive-${n}"]`
      ),
    { polling: 250, timeout: 15000 },
    RENAMED
  );
  console.log("reached T7");
  const placement = await page.evaluate((n) => ({
    stillActive: !!document.querySelector(
      `[data-testid="tech-manager"] [data-testid="tech-row-${n}"]`
    ),
    listedInactive: !!document.querySelector(
      `[data-testid="tech-manager"] [data-testid="tech-inactive-${n}"]`
    ),
  }), RENAMED);
  check(
    "T8",
    "soft-delete moves the technician to the inactive list, not gone",
    !placement.stillActive && placement.listedInactive,
    JSON.stringify(placement)
  );
  await closeManager();

  // ---------- T8b: deactivated technician keeps a greyed card + stays clickable ----------
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, OWNER, true);
  const greyCard = (await cardNames()).find((c) => c.name === RENAMED);
  check(
    "T8b",
    "deactivated technician with today's work gets a greyed নিষ্ক্রিয় card",
    !!greyCard && greyCard.active === "false",
    JSON.stringify(greyCard || null)
  );
  await clickCard(RENAMED);
  await new Promise((r) => setTimeout(r, 700));
  rows = await dailyRowNames();
  check(
    "T8c",
    "the greyed card is still clickable and filters correctly",
    rows.length === 1 && rows[0].includes(OWNER),
    `rows=${rows.length}`
  );
  await clickCard(RENAMED);

  // ---------- T8d: editing an inactive technician's old job ----------
  // The form still offers the inactive name; the API must accept that same
  // name on PUT instead of rejecting the row as if the user picked someone
  // outside the roster.
  // OWNER is a prefix of the other seeded row (OWNER + "A"), so select the
  // exact row id instead of the first text match.
  await page.evaluate(
    (selector, id) => {
      const section = document.querySelector(selector);
      const row = [...section.querySelectorAll("tbody tr")].find(
        (tr) => tr.children[0]?.textContent?.trim() === String(id)
      );
      if (!row) throw new Error("owner row missing: " + id);
      const button = row.querySelector('button[title="এডিট"]');
      if (!button) throw new Error("edit button missing: " + id);
      button.click();
    },
    DAILY,
    ownerJob.body.id
  );
  await page.waitForSelector("#svc-date", { polling: 300, timeout: 8000 });
  await typeInto(page, "svc-problem", "Inactive technician edit probe");
  await submitButton(page, "আপডেট করুন");
  await waitToast(page, "আপডেট হয়েছে").catch(() => null);
  await new Promise((r) => setTimeout(r, 600));
  const ownerAfterEdit = (await dayRows()).find(
    (s) => s.id === ownerJob.body.id
  );
  check(
    "T8d",
    "a deactivated technician's old job can still be edited without reassignment",
    ownerAfterEdit?.technician === RENAMED &&
      ownerAfterEdit?.problem === "Inactive technician edit probe",
    JSON.stringify({
      tech: ownerAfterEdit?.technician,
      problem: ownerAfterEdit?.problem,
    })
  );

  // ---------- T15: the last active technician cannot be deleted ----------
  const allTech = (await api(page, "/api/technicians?all=true")).body.technicians;
  for (const t of allTech.filter((x) => x.isActive && x.name !== "NURUL")) {
    await api(page, `/api/technicians/${t.id}`, { method: "DELETE" });
  }
  await openManager();
  const nurulDeleteDisabled = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="tech-manager"] [data-testid="tech-row-NURUL"]');
    const btn = [...row.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.includes("ডিলিট")
    );
    return !!btn && btn.disabled;
  });
  check("T15", "the last active technician's delete button is disabled", nurulDeleteDisabled);
  await closeManager();

  // restore the roster for anything that runs after this suite
  for (const n of ["RONI", "ASRAFUL", "NAYEM"]) {
    await api(page, "/api/technicians", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
  }

  const realErrors = errors();
  // ---- T17: after saving, the next entry must NOT find a blank technician ----
  // Regression: the form used to reset with technician:"" while the roster-sync
  // effect only ran on mount, so every save after the first failed with
  // "সঠিক টেকনিশিয়ান বাছুন" until a manual reload.
  await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, OWNER, true).catch(() => null);
  const fillAndSave = async (name) => {
    await typeInto(page, "svc-name", name);
    await typeInto(page, "svc-phone", "01700000021");
    await typeInto(page, "svc-model", "M");
    await typeInto(page, "svc-problem", "P");
    await typeInto(page, "svc-bill", "500");
    await submitButton(page, "সেভ করুন");
    await page.waitForFunction(
      (n) => document.body.textContent.includes(n),
      { polling: 300, timeout: 15000 },
      name
    );
  };
  const first = uniqueName("SeqA");
  const second = uniqueName("SeqB");
  await fillAndSave(first);
  const afterFirst = await page.$eval("#svc-tech", (el) => el.textContent.trim());
  await fillAndSave(second);
  const secondRow = (await api(page, `/api/services?date=${TODAY}`)).body.services.find(
    (r) => r.customerName === second
  );
  check(
    "T17",
    "two entries in a row save without re-picking the technician",
    !!secondRow && !!secondRow.technician && afterFirst.length > 0,
    `after first save dropdown="${afterFirst}", second row technician=${secondRow && secondRow.technician}`
  );

  // ---- T18: rapid triple-click on save creates exactly one row ----
  // Regression: `if (saving) return` reads React state, which has not updated
  // yet within one tick, so three clicks fired three POSTs.
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await waitDailyRow(page, first, true);
  const rapid = uniqueName("Rapid");
  await typeInto(page, "svc-name", rapid);
  await typeInto(page, "svc-phone", "01700000022");
  await typeInto(page, "svc-model", "M");
  await typeInto(page, "svc-problem", "P");
  await typeInto(page, "svc-bill", "450");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("form button[type='submit']")].find((x) =>
      x.textContent.includes("সেভ")
    );
    b.click();
    b.click();
    b.click();
  });
  await new Promise((r) => setTimeout(r, 2500));
  const rapidRows = (await api(page, `/api/services?date=${TODAY}`)).body.services.filter(
    (r) => r.customerName === rapid
  );
  check("T18", "triple-clicking save creates exactly one row", rapidRows.length === 1, `created ${rapidRows.length}`);

  // ---- T19: the printed receipt never carries the app footer ----
  // Regression: <footer> sat outside <main>, so the dark banner (shop name,
  // "১০০% অফলাইন") printed underneath the customer's bill.
  await clickDailyRowButton(page, rapid, "বিল প্রিন্ট");
  await page.waitForFunction(() => document.body.textContent.includes("বিল প্রিভিউ"), {
    polling: 300,
    timeout: 10000,
  });
  await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 500));
  const footerHidden = await page.evaluate(
    () => getComputedStyle(document.querySelector("footer")).display === "none"
  );
  await page.emulateMediaType("screen");
  await page.keyboard.press("Escape");
  check(
    "T19",
    "app footer is hidden in print (never on a customer bill)",
    footerHidden,
    `footer display=${footerHidden ? "none" : "visible"}`
  );

  check("T16", "zero JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("TECHNICIAN-MGMT CRASH:", e.message);
    // A crash should still show how far the suite got.
    if (results.length > 0) console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });

/** Helper kept at the bottom so the async IIFE above reads top-down. */
async function addTechnicianViaApi(name) {
  const res = await fetch(`${BASE}/api/technicians`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}
