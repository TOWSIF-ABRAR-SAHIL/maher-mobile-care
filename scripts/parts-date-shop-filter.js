/* /parts toolbar contract: the service desk's exact 3-mode date switcher,
 * a saved+past shop dropdown, and summary cards that follow both filters.
 *
 * Run only through `npm test` (scripts/run-tests.js), which supplies a fresh
 * throwaway database, backup folder and server. Never aims at prisma/dev.db.
 */
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  typeInto,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
const TOMORROW = shiftDay(TODAY, 1);
const SAVED_SHOP = uniqueName("SavedPartShop");
const A_SHOP = uniqueName("AlgomPartShop");
const B_SHOP = uniqueName("BhaiPartShop");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

const post = (page, path, body) =>
  api(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const patch = (page, path, body) =>
  api(page, path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function service(overrides = {}) {
  return {
    customerName: uniqueName("PartsFilterCustomer"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "Redmi Note 12",
    problem: "Parts filter fixture",
    technician: "NURUL",
    serviceDate: TODAY,
    totalBill: 5000,
    advance: 0,
    status: "In-Progress",
    ...overrides,
  };
}

function part(name, supplier, price) {
  return { name, quantity: 1, price, supplier, purchaseDate: TODAY };
}

const money = (text) => Number(String(text ?? "").replace(/[^\d]/g, "")) || 0;
const taka = (n) => `৳${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

async function state(page) {
  return page.evaluate(() => {
    const value = (id) =>
      document
        .querySelector(`[data-testid="parts-summary-${id}"]`)
        ?.getAttribute("data-value") ?? null;
    const activeMode = [
      ...document.querySelectorAll('[data-testid="svc-date-mode"] button'),
    ].find((button) => button.getAttribute("aria-pressed") === "true");
    return {
      activeMode: activeMode?.textContent.trim() ?? null,
      modeLabelCount: document.querySelectorAll(
        '[data-testid="svc-date-mode"] button'
      ).length,
      dayNavVisible: !!document.querySelector('[data-testid="service-date-nav"]'),
      dayValue:
        document.querySelector(
          '[data-testid="service-date-nav"] input[type="date"]'
        )?.value ?? null,
      rangeVisible: !!document.querySelector(
        '[data-testid="svc-range-inputs"]'
      ),
      rangeFrom:
        document.querySelector('[data-testid="svc-range-from"]')?.value ?? null,
      rangeTo:
        document.querySelector('[data-testid="svc-range-to"]')?.value ?? null,
      cards: {
        unpaid: value("unpaid"),
        paid: value("paid"),
        total: value("total"),
        legacy: value("legacy"),
      },
      rows: [
        ...document.querySelectorAll('[data-testid^="service-part-row-"]'),
      ].map((row) => row.getAttribute("data-testid")),
    };
  });
}

async function waitForTotal(page, expected) {
  const wanted = `৳${expected.toLocaleString("en-IN")}`;
  await page.waitForFunction(
    (value) =>
      document
        .querySelector('[data-testid="parts-summary-total"]')
        ?.getAttribute("data-value") === value,
    { polling: 100, timeout: 12000 },
    wanted
  );
}

async function clickMode(page, label) {
  await page.evaluate((text) => {
    const button = [
      ...document.querySelectorAll('[data-testid="svc-date-mode"] button'),
    ].find((item) => item.textContent.trim() === text);
    if (!button) throw new Error(`date mode missing: ${text}`);
    button.click();
  }, label);
  await sleep(150);
}

async function closeShopMenu(page) {
  await page.keyboard.press("Escape");
  // Radix keeps the content mounted while its close animation runs. Waiting for
  // the options to actually leave the DOM stops the next open from toggling a
  // half-closing menu shut and reading stale options.
  await page.waitForFunction(
    () => !document.querySelector('[role="option"]'),
    { polling: 100, timeout: 6000 }
  );
}

async function shopOptions(page) {
  await page.click("#parts-supplier");
  await page.waitForFunction(
    () => document.querySelectorAll('[role="option"]').length > 0,
    { polling: 100, timeout: 6000 }
  );
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('[role="option"]')].map((option) =>
      option.textContent.trim()
    )
  );
  await closeShopMenu(page);
  return labels;
}

async function chooseShop(page, label) {
  await page.click("#parts-supplier");
  await page.waitForFunction(
    (text) =>
      [...document.querySelectorAll('[role="option"]')].some(
        (item) => item.textContent.trim() === text
      ),
    { polling: 100, timeout: 6000 },
    label
  );
  await page.evaluate((text) => {
    const option = [...document.querySelectorAll('[role="option"]')].find(
      (item) => item.textContent.trim() === text
    );
    if (!option) throw new Error(`shop option missing: ${text}`);
    option.click();
  }, label);
  await closeShopMenu(page);
}

(async () => {
  let browser = null;
  let db = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 800 });
    const errors = trackErrors(page);

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate((names) => {
      localStorage.setItem("maher:service-part-shops", JSON.stringify(names));
    }, [SAVED_SHOP, A_SHOP]);

    const roster = await api(page, "/api/technicians");
    if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
      const added = await post(page, "/api/technicians", { name: "NURUL" });
      if (!added.ok) throw new Error("NURUL seed failed: " + JSON.stringify(added.body));
    }

    const todayA = await post(page, "/api/services", {
      ...service({ serviceDate: TODAY }),
      parts: [part("Today A part", A_SHOP, 1000)],
    });
    const todayB = await post(page, "/api/services", {
      ...service({ serviceDate: TODAY }),
      parts: [part("Today B part", B_SHOP, 500)],
    });
    const yesterdayA = await post(page, "/api/services", {
      ...service({ serviceDate: YESTERDAY }),
      parts: [
        {
          ...part("Yesterday A part", A_SHOP, 2000),
          purchaseDate: YESTERDAY,
        },
      ],
    });
    if (!todayA.ok || !todayB.ok || !yesterdayA.ok) {
      throw new Error(
        "parts filter seed failed: " +
          JSON.stringify([todayA.body, todayB.body, yesterdayA.body])
      );
    }

    if (!process.env.MAHER_DB_PATH) throw new Error("MAHER_DB_PATH missing");
    db = new Database(process.env.MAHER_DB_PATH);
    db.pragma("busy_timeout = 5000");
    db.prepare(
      `INSERT INTO ServicePart
         (serviceId, nameSnapshot, quantity, unitCost, lineCost, supplier, supplierKey, purchaseDate)
       VALUES (?, 'Legacy A part', 1, 700, 700, ?, ?, NULL)`
    ).run(todayA.body.id, A_SHOP, A_SHOP.toLowerCase());

    await page.goto(`${BASE}/parts`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="service-parts-ledger"]', {
      polling: 100,
      timeout: 15000,
    });
    await waitForTotal(page, 1500);

    const initial = await state(page);
    check(
      "PF1",
      "parts ledger opens with the service desk's three-mode day switcher",
      initial.activeMode === "একদিন" &&
        initial.modeLabelCount === 3 &&
        initial.dayNavVisible &&
        initial.dayValue === TODAY &&
        !initial.rangeVisible &&
        money(initial.cards.unpaid) === 1500 &&
        money(initial.cards.paid) === 0 &&
        money(initial.cards.total) === 1500 &&
        money(initial.cards.legacy) === 0,
      JSON.stringify(initial)
    );

    await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll('[data-testid="service-date-nav"] button'),
      ].find((item) => item.getAttribute("aria-label") === "আগের দিন");
      if (!button) throw new Error("previous-day button missing");
      button.click();
    });
    await waitForTotal(page, 2000);
    const previous = await state(page);
    check(
      "PF2",
      "previous-day navigation filters rows and summary cards together",
      previous.dayValue === YESTERDAY &&
        previous.rows.length === 1 &&
        money(previous.cards.total) === 2000 &&
        money(previous.cards.legacy) === 0,
      JSON.stringify(previous)
    );

    await page.evaluate(() => {
      const button = [
        ...document.querySelectorAll('[data-testid="service-date-nav"] button'),
      ].find((item) => item.textContent.includes("আজ"));
      if (!button) throw new Error("today button missing");
      button.click();
    });
    await waitForTotal(page, 1500);

    await clickMode(page, "তারিখ রেঞ্জ");
    const rangeOpen = await state(page);
    check(
      "PF2b",
      "range mode swaps the day nav for from/to pickers",
      rangeOpen.activeMode === "তারিখ রেঞ্জ" &&
        !rangeOpen.dayNavVisible &&
        rangeOpen.rangeVisible,
      JSON.stringify(rangeOpen)
    );

    await typeInto(page, "svc-range-from", YESTERDAY);
    await typeInto(page, "svc-range-to", TODAY);
    await waitForTotal(page, 3500);
    const ranged = await state(page);
    check(
      "PF3",
      "date range filters both days into the table and cards",
      ranged.rangeFrom === YESTERDAY &&
        ranged.rangeTo === TODAY &&
        ranged.rows.length === 3 &&
        money(ranged.cards.total) === 3500 &&
        money(ranged.cards.legacy) === 0,
      JSON.stringify(ranged)
    );

    await clickMode(page, "সব তারিখ");
    // The total is unchanged from range mode, so wait for the legacy row to
    // arrive too instead of returning on the first matching money card.
    await page.waitForFunction(
      ({ total, rows }) =>
        document
          .querySelector('[data-testid="parts-summary-total"]')
          ?.getAttribute("data-value") === total &&
        document.querySelectorAll('[data-testid^="service-part-row-"]')
          .length === rows,
      { polling: 100, timeout: 12000 },
      { total: "৳3,500", rows: 4 }
    );
    const all = await state(page);
    check(
      "PF4",
      "all-dates hides pickers and restores legacy lines in the cards",
      all.activeMode === "সব তারিখ" &&
        !all.dayNavVisible &&
        !all.rangeVisible &&
        all.rows.length === 4 &&
        money(all.cards.total) === 3500 &&
        money(all.cards.legacy) === 700,
      JSON.stringify(all)
    );

    const options = await shopOptions(page);
    check(
      "PF5",
      "shop dropdown lists all shops (saved plus past part lines)",
      options.includes("সব দোকান") &&
        options.includes(SAVED_SHOP) &&
        options.includes(A_SHOP) &&
        options.includes(B_SHOP),
      JSON.stringify(options)
    );

    await chooseShop(page, A_SHOP);
    await page.waitForFunction(
      (value) =>
        document
          .querySelector('[data-testid="parts-summary-total"]')
          ?.getAttribute("data-value") === value,
      { polling: 100, timeout: 12000 },
      "৳3,000"
    );
    const allShop = await state(page);
    check(
      "PF6",
      "a selected shop narrows all-dates rows, totals and legacy money",
      allShop.rows.length === 3 &&
        money(allShop.cards.total) === 3000 &&
        money(allShop.cards.legacy) === 700,
      JSON.stringify(allShop)
    );

    await clickMode(page, "একদিন");
    await waitForTotal(page, 1000);
    const dayShop = await state(page);
    check(
      "PF7",
      "shop and day filters combine instead of overriding each other",
      dayShop.dayValue === TODAY &&
        dayShop.rows.length === 1 &&
        money(dayShop.cards.total) === 1000 &&
        money(dayShop.cards.legacy) === 0,
      JSON.stringify(dayShop)
    );

    const widths = [];
    for (const width of [1280, 1366]) {
      await page.setViewport({ width, height: 800 });
      await sleep(200);
      widths.push(
        await page.evaluate(() => {
          const ledger = document.querySelector(
            '[data-testid="service-parts-ledger"]'
          );
          return {
            width: window.innerWidth,
            pageOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
            toolbarOverflow: ledger
              ? ledger.firstElementChild.scrollWidth >
                ledger.firstElementChild.clientWidth + 1
              : true,
          };
        })
      );
    }
    check(
      "PF8",
      "no horizontal overflow at 1280 or 1366",
      widths.every((item) => !item.pageOverflow && !item.toolbarOverflow),
      JSON.stringify(widths)
    );

    // ---- PF10–PF13: the final /parts polish pass -------------------------
    const allRows = (await api(page, "/api/service-parts?status=all")).body.rows;
    const coded = allRows.find((row) => row.name === "Today A part");
    if (!coded) throw new Error("coded Today A part missing from ledger");

    const codeText = `কোড: ${coded.priceCode}`;
    const amountText = taka(coded.lineCost);
    const unitText = taka(coded.unitCost);
    const costBefore = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="service-part-row-${id}"]`);
      const cell = row?.querySelector("td:nth-child(4)");
      const eye = row?.querySelector(`[data-testid="part-cost-reveal-${id}"]`);
      const code = row?.querySelector(`[data-testid="part-cost-code-${id}"]`);
      return {
        text: (cell?.textContent ?? "").replace(/\s+/g, " ").trim(),
        codeText: code?.textContent.trim() ?? null,
        eye: !!eye,
        pressed: eye?.getAttribute("aria-pressed") ?? null,
      };
    }, coded.id);
    await page.click(`[data-testid="part-cost-reveal-${coded.id}"]`);
    await page.waitForFunction(
      (id, amount) =>
        document
          .querySelector(`[data-testid="service-part-row-${id}"]`)
          ?.querySelector("td:nth-child(4)")
          ?.textContent.includes(amount),
      { polling: 100, timeout: 6000 },
      coded.id,
      amountText
    );
    const costAfter = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="service-part-row-${id}"]`);
      const eye = row?.querySelector(`[data-testid="part-cost-reveal-${id}"]`);
      return {
        text: (row?.querySelector("td:nth-child(4)")?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        pressed: eye?.getAttribute("aria-pressed") ?? null,
      };
    }, coded.id);
    check(
      "PF10",
      "price code is always shown; only the decoded amount opens on that row's eye",
      costBefore.eye &&
        costBefore.pressed === "false" &&
        costBefore.codeText === codeText &&
        costBefore.text.includes(codeText) &&
        costBefore.text.includes("৳••••") &&
        !costBefore.text.includes(amountText) &&
        costAfter.pressed === "true" &&
        costAfter.text.includes(codeText) &&
        costAfter.text.includes(amountText) &&
        costAfter.text.includes(unitText),
      JSON.stringify({ code: codeText, amount: amountText, before: costBefore, after: costAfter })
    );

    // One paid line and one unpaid line, both in the same shop, so the two
    // badge colours can be compared without any other row in the way.
    const paidMark = await patch(page, `/api/service-parts/${coded.id}`, {
      paid: true,
      note: "polish check",
    });
    if (!paidMark.ok) throw new Error("paid marker failed: " + JSON.stringify(paidMark.body));
    await page.goto(`${BASE}/parts`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector('[data-testid="service-parts-ledger"]', {
      polling: 100,
      timeout: 15000,
    });
    await clickMode(page, "সব তারিখ");
    await chooseShop(page, A_SHOP);
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid^="service-part-row-"]').length === count,
      { polling: 100, timeout: 12000 },
      3
    );
    const badges = await page.evaluate((paidId) => {
      const rows = [...document.querySelectorAll('[data-testid^="service-part-row-"]')];
      const markOf = (row) => row?.querySelector('[data-testid^="part-payment-mark-"]');
      const paidRow = rows.find(
        (row) => row.getAttribute("data-testid") === `service-part-row-${paidId}`
      );
      const unpaidRow = rows.find((row) => row !== paidRow);
      return {
        rows: rows.length,
        paidText: markOf(paidRow)?.textContent.trim() ?? null,
        unpaidText: markOf(unpaidRow)?.textContent.trim() ?? null,
        paidClass: markOf(paidRow)?.className ?? "",
        unpaidClass: markOf(unpaidRow)?.className ?? "",
      };
    }, coded.id);
    check(
      "PF11",
      "Paid badge is emerald and unpaid badge is rose, each one per row",
      badges.rows === 3 &&
        badges.paidText === "Paid চিহ্ন" &&
        badges.unpaidText === "চিহ্ন নেই" &&
        badges.paidClass.includes("bg-emerald-50") &&
        badges.paidClass.includes("text-emerald-700") &&
        badges.unpaidClass.includes("bg-rose-50") &&
        badges.unpaidClass.includes("text-rose-700"),
      JSON.stringify(badges)
    );

    await page.setViewport({ width: 1366, height: 800 });
    await sleep(200);
    const toolbar = await page.evaluate(() => {
      const chips = document.querySelector('[aria-label="নিষ্পত্তির অবস্থা"]');
      const payment = document.querySelector('[data-testid="parts-payment-filter"]');
      const chipBox = chips?.getBoundingClientRect();
      const paymentBox = payment?.getBoundingClientRect();
      return {
        chipTop: chipBox?.top ?? null,
        paymentTop: paymentBox?.top ?? null,
        sameLine: !!chipBox && !!paymentBox && Math.abs(chipBox.top - paymentBox.top) <= 6,
      };
    });
    check(
      "PF12",
      "payment-mark dropdown sits on the same toolbar line as the status chips",
      toolbar.sameLine,
      JSON.stringify(toolbar)
    );

    const shopTrigger = await page.$eval(
      '[data-testid="parts-shop-manager-trigger"]',
      (el) => ({
        text: el.textContent.replace(/\s+/g, " ").trim(),
        title: el.getAttribute("title") ?? "",
        right: el.getBoundingClientRect().right,
        mainRight:
          document.querySelector("main")?.getBoundingClientRect().right ?? 0,
      })
    );
    check(
      "PF16",
      "masthead shop manager button carries the live count, stays right aligned, no top card",
      shopTrigger.text.includes("দোকান ব্যবস্থাপনা") &&
        shopTrigger.text.includes("3টি") &&
        !shopTrigger.text.includes("যোগ করুন") &&
        Math.abs(shopTrigger.mainRight - shopTrigger.right) <= 24 &&
        !(await page.$('[aria-label="সার্ভিস পার্টস"] > div:first-child [data-testid="part-shops-manager"]')),
      JSON.stringify(shopTrigger)
    );

    await page.click('[data-testid="parts-shop-manager-trigger"]');
    await page.waitForSelector('[data-testid="parts-shop-manager-dialog"]', {
      visible: true,
      timeout: 10000,
    });
    const dialogInfo = await page.evaluate(() => {
      const dialog = document.querySelector(
        '[data-testid="parts-shop-manager-dialog"]'
      );
      const manager = document.querySelector('[data-testid="part-shops-manager"]');
      const text = dialog?.textContent.replace(/\s+/g, " ") ?? "";
      return {
        title: text.includes("পার্টসের দোকান ব্যবস্থাপনা"),
        subtitle: text.includes("পার্টস কেনার দোকানসমূহ"),
        addInput: !!dialog?.querySelector("#new-part-shop-name"),
        managerInsideDialog: !!manager && !!dialog?.contains(manager),
        breakdown: ["মোট:", "পরিশোধ:", "বাকি:"].every((label) =>
          text.includes(label)
        ),
        footer: ["মোট বিল:", "পরিশোধিত:", "মোট বাকি দেনা:"].every((label) =>
          text.includes(label)
        ),
        ledgerAction: !!dialog?.querySelector(
          '[data-testid="part-shop-view-ledger"]'
        ),
        ledgerTitle:
          dialog?.querySelector('[data-testid="part-shop-view-ledger"]')
            ?.getAttribute("title") ?? "",
        total: (dialog?.querySelector('[data-testid="part-shops-total"]')
          ?.textContent ?? "").trim(),
      };
    });
    check(
      "PF17",
      "shop dialog carries the title, add form, colour-coded labels, 3-part footer and ledger jump",
      dialogInfo.title &&
        dialogInfo.subtitle &&
        dialogInfo.addInput &&
        dialogInfo.managerInsideDialog &&
        dialogInfo.breakdown &&
        dialogInfo.footer &&
        dialogInfo.ledgerAction &&
        dialogInfo.ledgerTitle === "এই দোকানের খাতা দেখুন" &&
        /^৳[\d,]+$/.test(dialogInfo.total),
      JSON.stringify(dialogInfo)
    );

    const shopButtons = await page.evaluate(
      (saved, used) => {
        const rows = [...document.querySelectorAll('[data-testid="part-shop-row"]')];
        const rowFor = (name) => rows.find((row) => row.textContent.includes(name));
        const buttonFor = (name) =>
          rowFor(name)?.querySelector('[data-testid="part-shop-delete"]');
        const savedButton = buttonFor(saved);
        const usedButton = buttonFor(used);
        return {
          rows: rows.length,
          savedDeletable: !!savedButton && !savedButton.disabled,
          usedProtected: !!usedButton && usedButton.disabled,
          usedTitle: usedButton?.getAttribute("title") ?? "",
        };
      },
      SAVED_SHOP,
      A_SHOP
    );
    check(
      "PF13",
      "a saved shop with transactions is disabled with the ledger-debt tooltip",
      shopButtons.rows === 3 &&
        shopButtons.savedDeletable &&
        shopButtons.usedProtected &&
        shopButtons.usedTitle === "লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না",
      JSON.stringify(shopButtons)
    );

    const shopCards = await page.evaluate((saved, used, other) => {
      const rows = [...document.querySelectorAll('[data-testid="part-shop-row"]')];
      const rowFor = (name) => rows.find((row) => row.textContent.includes(name));
      const read = (name) => {
        const row = rowFor(name);
        const bill = row?.querySelector('[data-testid="part-shop-bill"]');
        const paid = row?.querySelector('[data-testid="part-shop-paid"]');
        const due = row?.querySelector('[data-testid="part-shop-unpaid"]');
        return {
          bill: (bill?.textContent ?? "").replace(/\s+/g, " ").trim(),
          billClass: bill?.className ?? "",
          paid: (paid?.textContent ?? "").replace(/\s+/g, " ").trim(),
          paidClass: paid?.className ?? "",
          due: (due?.textContent ?? "").replace(/\s+/g, " ").trim(),
          dueClass: due?.className ?? "",
        };
      };
      const totalOf = (id) =>
        (document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "").trim();
      const dueNode = document.querySelector('[data-testid="part-shops-due-total"]');
      return {
        saved: read(saved),
        used: read(used),
        other: read(other),
        footer: {
          total: totalOf("part-shops-total"),
          paid: totalOf("part-shops-paid-total"),
          due: totalOf("part-shops-due-total"),
          dueClass: dueNode?.className ?? "",
        },
      };
    }, SAVED_SHOP, A_SHOP, B_SHOP);
    check(
      "PF18",
      "shop rows use slate total, emerald paid, rose warning dues or green settled tag, footer sums all three",
      shopCards.used.bill.startsWith("মোট:") &&
        money(shopCards.used.bill) === 3700 &&
        shopCards.used.billClass.includes("text-slate-600") &&
        shopCards.used.paid.startsWith("পরিশোধ:") &&
        money(shopCards.used.paid) === 1000 &&
        shopCards.used.paidClass.includes("bg-emerald-50") &&
        shopCards.used.paidClass.includes("text-emerald-700") &&
        shopCards.used.due.includes("⚠️ বাকি:") &&
        money(shopCards.used.due) === 2700 &&
        shopCards.used.dueClass.includes("bg-rose-50") &&
        shopCards.used.dueClass.includes("text-rose-700") &&
        shopCards.used.dueClass.includes("border-rose-200") &&
        shopCards.other.due.includes("⚠️ বাকি:") &&
        money(shopCards.other.due) === 500 &&
        shopCards.saved.due.includes("✅ পরিশোধিত") &&
        shopCards.saved.dueClass.includes("text-emerald-700") &&
        shopCards.footer.total === "৳4,200" &&
        shopCards.footer.paid === "৳1,000" &&
        shopCards.footer.due === "৳3,200" &&
        shopCards.footer.dueClass.includes("font-bold") &&
        shopCards.footer.dueClass.includes("text-rose-700"),
      JSON.stringify(shopCards)
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="parts-shop-manager-dialog"]'),
      { polling: 100, timeout: 6000 }
    );

    // ---- PF14–PF15: global reveal-all button ------------------------------
    const globalState = () =>
      page.evaluate(() => {
        const toggle = document.querySelector(
          '[data-testid="parts-price-toggle"]'
        );
        const rows = [
          ...document.querySelectorAll('[data-testid^="service-part-row-"]'),
        ];
        const cells = rows.map((row) =>
          (row.querySelector("td:nth-child(4)")?.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim()
        );
        return {
          label: toggle?.textContent.trim() ?? null,
          pressed: toggle?.getAttribute("aria-pressed") ?? null,
          className: toggle?.className ?? "",
          rows: rows.length,
          masked:
            cells.length > 0 && cells.every((text) => text.includes("৳••••")),
          codesNotMasked: cells.every((text) => !text.includes("কোড: ••••")),
          revealed:
            cells.length > 0 &&
            cells.every(
              (text) => !text.includes("৳••••") && text.includes("৳")
            ),
          cells,
        };
      });

    const globalBefore = await globalState();
    await page.click('[data-testid="parts-price-toggle"]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid^="service-part-row-"]')]
          .length > 0 &&
        [...document.querySelectorAll('[data-testid^="service-part-row-"]')].every(
          (row) =>
            !(row.querySelector("td:nth-child(4)")?.textContent ?? "").includes(
              "৳••••"
            )
        ),
      { polling: 100, timeout: 6000 }
    );
    const globalAfter = await globalState();
    check(
      "PF14",
      "toolbar reveal-all button shows every visible amount with navy pressed state",
      globalBefore.rows === 3 &&
        globalBefore.masked &&
        globalBefore.codesNotMasked &&
        globalBefore.label.includes("দাম দেখান") &&
        globalBefore.pressed === "false" &&
        globalAfter.revealed &&
        globalAfter.codesNotMasked &&
        globalAfter.label.includes("দাম লুকান") &&
        globalAfter.pressed === "true" &&
        globalAfter.className.includes("bg-primary"),
      JSON.stringify({ before: globalBefore, after: globalAfter })
    );

    await page.click('[data-testid="parts-price-toggle"]');
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-testid^="service-part-row-"]')]
          .length > 0 &&
        [...document.querySelectorAll('[data-testid^="service-part-row-"]')].every(
          (row) =>
            (row.querySelector("td:nth-child(4)")?.textContent ?? "").includes(
              "৳••••"
            )
        ),
      { polling: 100, timeout: 6000 }
    );
    const globalHidden = await globalState();
    check(
      "PF15",
      "reveal-all toggles back to fully masked amounts",
      globalHidden.masked &&
        globalHidden.codesNotMasked &&
        globalHidden.label.includes("দাম দেখান") &&
        globalHidden.pressed === "false",
      JSON.stringify(globalHidden)
    );

    // ---- PF19: quick ledger jump from the shop manager --------------------
    await page.click('[data-testid="parts-shop-manager-trigger"]');
    await page.waitForSelector('[data-testid="parts-shop-manager-dialog"]', {
      visible: true,
      timeout: 10000,
    });
    await page.evaluate((name) => {
      const row = [
        ...document.querySelectorAll('[data-testid="part-shop-row"]'),
      ].find((item) => item.textContent.includes(name));
      const button = row?.querySelector('[data-testid="part-shop-view-ledger"]');
      if (!button) throw new Error("ledger jump button missing for " + name);
      button.click();
    }, B_SHOP);
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="parts-shop-manager-dialog"]'),
      { polling: 100, timeout: 6000 }
    );
    await page.waitForFunction(
      (value) =>
        document.querySelector('[data-testid="parts-summary-total"]')
          ?.getAttribute("data-value") === value,
      { polling: 100, timeout: 12000 },
      "৳500"
    );
    const jump = await page.evaluate(() => ({
      shop: (document.querySelector("#parts-supplier")?.textContent ?? "").trim(),
      rows: document.querySelectorAll('[data-testid^="service-part-row-"]').length,
      total: document
        .querySelector('[data-testid="parts-summary-total"]')
        ?.getAttribute("data-value"),
    }));
    check(
      "PF19",
      "ledger jump selects the shop filter, closes the dialog and shows that shop's ledger",
      jump.shop.includes(B_SHOP) && jump.rows === 1 && jump.total === "৳500",
      JSON.stringify(jump)
    );

    check("PF9", "no browser errors", errors.length === 0, errors.join(" | "));
  } catch (err) {
    check("PFX", "suite completed", false, err.stack || String(err));
  } finally {
    if (db) db.close();
    await closeBrowser(browser);
  }

  for (const line of results) console.log(line);
  const passed = results.filter((line) => line.startsWith("PASS")).length;
  console.log(`\n${passed}/${results.length} parts date/shop filter checks passed`);
  if (failed) process.exit(1);
})();
