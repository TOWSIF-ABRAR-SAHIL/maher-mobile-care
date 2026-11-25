/* Service-part resolution (USED / MOVED_TO_STOCK / RETURNED / DAMAGED /
 * KEPT_IN_LEDGER) on the throwaway DB supplied by scripts/run-tests.js.
 *
 * Pins the money/stock rules end to end: only USED lines are device cost,
 * DAMAGED moves the full line into Service.damageLoss exactly once, stock moves
 * are atomic and reversible, RETURNED leaves supplier balances,
 * KEPT_IN_LEDGER keeps the line in the parts ledger with no stock and no
 * supplier-write-off, and none of the internal numbers ever reach a receipt.
 */
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

async function send(page, method, path, body) {
  return api(page, path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
const post = (page, path, body) => send(page, "POST", path, body);
const put = (page, path, body) => send(page, "PUT", path, body);
const patch = (page, path, body) => send(page, "PATCH", path, body);
const del = (page, path, body) => send(page, "DELETE", path, body);

function part(overrides = {}) {
  return {
    name: "Resolution test part",
    quantity: 1,
    price: 1200,
    supplier: uniqueName("ResolveShop"),
    purchaseDate: TODAY,
    ...overrides,
  };
}

async function createService(page, overrides = {}) {
  return post(page, "/api/services", {
    customerName: uniqueName("ResolveCustomer"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "Samsung A20",
    technician: "NURUL",
    problem: "Display dead",
    totalBill: 3000,
    advance: 0,
    status: "In-Progress",
    serviceDate: TODAY,
    ...overrides,
  });
}

(async () => {
  let browser = null;
  let db = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(`${BASE}/service`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    const roster = await api(page, "/api/technicians");
    if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
      await post(page, "/api/technicians", { name: "NURUL" });
    }
    if (!process.env.MAHER_DB_PATH) throw new Error("MAHER_DB_PATH missing");
    db = new Database(process.env.MAHER_DB_PATH);
    db.pragma("busy_timeout = 5000");
    const damageOf = (id) =>
      db.prepare("SELECT damageLoss FROM Service WHERE id = ?").get(id)?.damageLoss;
    const productByName = (name) =>
      db.prepare("SELECT * FROM Product WHERE name = ? ORDER BY id DESC").get(name);
    const movementsOf = (productId, refId) =>
      db
        .prepare(
          "SELECT * FROM StockMovement WHERE productId = ? AND refType = 'SERVICE_PART' AND refId = ? ORDER BY id"
        )
        .all(productId, refId);

    /* ---------------- default USED + device cost ---------------- */

    const usedShop = uniqueName("UsedShop");
    const used = await createService(page, {
      parts: [part({ name: "R-USED-PART", quantity: 2, price: 1200, supplier: usedShop })],
    });
    assert.equal(used.status, 201, JSON.stringify(used.body));
    const usedRow = (await api(page, `/api/services/${used.body.id}`)).body;
    const usedPart = usedRow.parts[0];
    check(
      "R1",
      "a new part line defaults to USED with no resolution metadata",
      usedPart.partStatus === "USED" &&
        usedPart.resolutionNote === null &&
        usedPart.targetProductId === null &&
        usedPart.resolvedAt === null &&
        usedRow.partsCost === 2400,
      JSON.stringify({ part: usedPart, cost: usedRow.partsCost })
    );

    const usedLedger = await api(page, "/api/service-parts?resolution=USED");
    const damagedLedger = await api(page, "/api/service-parts?resolution=DAMAGED");
    check(
      "R2",
      "resolution query filters ledger rows without hiding other states from the summary",
      usedLedger.ok &&
        usedLedger.body.rows.some((r) => r.id === usedPart.id) &&
        damagedLedger.ok &&
        !damagedLedger.body.rows.some((r) => r.id === usedPart.id) &&
        usedLedger.body.summary.count >= 1,
      JSON.stringify({
        used: usedLedger.body.rows.length,
        damaged: damagedLedger.body.rows.length,
      })
    );

    /* ---------------- DAMAGED: loss once, no device cost ---------------- */

    const damaged = await patch(page, `/api/service-parts/${usedPart.id}`, {
      partStatus: "DAMAGED",
      resolutionNote: "ভেঙে গেছে",
    });
    const afterDamage = (await api(page, `/api/services/${used.body.id}`)).body;
    check(
      "R3",
      "DAMAGED removes device cost and adds the full line to damageLoss once",
      damaged.ok &&
        damaged.body.part.partStatus === "DAMAGED" &&
        damaged.body.part.resolutionNote === "ভেঙে গেছে" &&
        afterDamage.partsCost === 0 &&
        damageOf(used.body.id) === 2400,
      JSON.stringify({
        status: damaged.body?.part?.partStatus,
        cost: afterDamage.partsCost,
        loss: damageOf(used.body.id),
      })
    );

    await patch(page, `/api/service-parts/${usedPart.id}`, {
      partStatus: "DAMAGED",
      resolutionNote: "ভেঙে গেছে",
    });
    check(
      "R4",
      "re-applying DAMAGED is idempotent (no second damage charge)",
      damageOf(used.body.id) === 2400,
      `damageLoss=${damageOf(used.body.id)}`
    );

    await patch(page, `/api/service-parts/${usedPart.id}`, {
      partStatus: "USED",
      resolutionNote: "আবার ব্যবহৃত",
    });
    check(
      "R5",
      "reverting DAMAGED to USED removes the loss and restores device cost",
      damageOf(used.body.id) === 0 &&
        (await api(page, `/api/services/${used.body.id}`)).body.partsCost === 2400,
      `damageLoss=${damageOf(used.body.id)}`
    );

    /* ---------------- DAMAGED at entry time (same save, no /parts trip) -- */

    const entryShop = uniqueName("EntryDamageShop");
    const entry = await createService(page, {
      totalBill: 5000,
      advance: 5000,
      parts: [
        part({
          name: "R-ENTRY-DAMAGED",
          price: 1200,
          supplier: entryShop,
          partStatus: "DAMAGED",
        }),
      ],
    });
    assert.equal(entry.status, 201, JSON.stringify(entry.body));
    const entryRow = (await api(page, `/api/services/${entry.body.id}`)).body;
    const entryPart = entryRow.parts[0];
    check(
      "R22",
      "a part flagged DAMAGED on the entry form is resolved in the same save",
      entryPart.partStatus === "DAMAGED" &&
        entryPart.resolutionNote != null &&
        entryRow.partsCost === 0 &&
        entryRow.due === 0 &&
        damageOf(entry.body.id) === 1200,
      JSON.stringify({
        part: entryPart,
        cost: entryRow.partsCost,
        due: entryRow.due,
        loss: damageOf(entry.body.id),
      })
    );

    // Re-saving the row with the same damaged line must not charge twice:
    // existing resolved lines stay frozen and only new lines move the loss.
    const resave = await put(page, `/api/services/${entry.body.id}`, {
      parts: [
        part({
          id: entryPart.id,
          name: "R-ENTRY-DAMAGED",
          price: 1200,
          supplier: entryShop,
          partStatus: "DAMAGED",
        }),
      ],
    });
    const resavedRow = (await api(page, `/api/services/${entry.body.id}`)).body;
    check(
      "R23",
      "re-saving an already-damaged entry line does not double the loss",
      resave.ok &&
        resavedRow.parts[0].partStatus === "DAMAGED" &&
        damageOf(entry.body.id) === 1200,
      JSON.stringify({ status: resave.status, loss: damageOf(entry.body.id) })
    );

    // The form must never be able to reserve stock or force a return: any
    // status other than DAMAGED is coerced to USED by the validator.
    const coerced = await createService(page, {
      parts: [
        part({
          name: "R-ENTRY-COERCED",
          price: 500,
          partStatus: "MOVED_TO_STOCK",
        }),
      ],
    });
    const coercedRow = (await api(page, `/api/services/${coerced.body.id}`)).body;
    check(
      "R24",
      "a client cannot use the form to move stock or return a part",
      coerced.status === 201 &&
        coercedRow.parts[0].partStatus === "USED" &&
        coercedRow.partsCost === 500 &&
        damageOf(coerced.body.id) === 0,
      JSON.stringify({ part: coercedRow.parts[0], cost: coercedRow.partsCost })
    );

    // The shopkeeper's full case: one broken part and one good replacement on
    // the same device, paid in full. The day's expense card must read ৳8,000
    // (4,000 parts + 4,000 loss) and profit must be −৳3,000.
    const exactStatsBefore = (await api(page, `/api/stats?date=${TODAY}`)).body.today;
    const exactMonthBefore = (
      await api(page, `/api/stats/monthly?from=${TODAY}&to=${TODAY}`)
    ).body.summary;
    const exact = await createService(page, {
      customerName: "নুসরাত জাহান",
      phone: "01711000004",
      model: "Vivo Y20",
      problem: "ডিসপ্লে পরিবর্তন",
      totalBill: 5000,
      advance: 5000,
      parts: [
        part({
          name: "Y20 Display-1 (Broken)",
          price: 4000,
          supplier: "Dhaka Shop",
          partStatus: "DAMAGED",
        }),
        part({
          name: "Y20 Display-2 (Ok)",
          price: 4000,
          supplier: "Dhaka Shop",
        }),
      ],
    });
    const exactRow = (await api(page, `/api/services/${exact.body.id}`)).body;
    const exactStatsAfter = (await api(page, `/api/stats?date=${TODAY}`)).body.today;
    const exactMonthAfter = (
      await api(page, `/api/stats/monthly?from=${TODAY}&to=${TODAY}`)
    ).body.summary;
    const broken = exactRow.parts.find((p) => p.name === "Y20 Display-1 (Broken)");
    const good = exactRow.parts.find((p) => p.name === "Y20 Display-2 (Ok)");
    check(
      "R25",
      "entry-time damage + replacement gives ৳8,000 cost, ৳5,000 bill and −৳3,000 profit",
      exact.status === 201 &&
        broken?.partStatus === "DAMAGED" &&
        good?.partStatus === "USED" &&
        exactRow.partsCost === 4000 &&
        exactRow.due === 0 &&
        damageOf(exact.body.id) === 4000 &&
        exactStatsAfter.bill - exactStatsBefore.bill === 5000 &&
        exactStatsAfter.expense - exactStatsBefore.expense === 4000 &&
        exactStatsAfter.damageLoss - exactStatsBefore.damageLoss === 4000 &&
        exactMonthAfter.profit - exactMonthBefore.profit === -3000,
      JSON.stringify({
        partsCost: exactRow.partsCost,
        due: exactRow.due,
        expenseDelta: exactStatsAfter.expense - exactStatsBefore.expense,
        lossDelta: exactStatsAfter.damageLoss - exactStatsBefore.damageLoss,
        profitDelta: exactMonthAfter.profit - exactMonthBefore.profit,
      })
    );

    /* ---------------- MOVED_TO_STOCK: product + stock + movement ------- */

    const catName = uniqueName("ResolveCat");
    const prodName = uniqueName("ResolveProduct");
    const stocked = await patch(page, `/api/service-parts/${usedPart.id}`, {
      partStatus: "MOVED_TO_STOCK",
      resolutionNote: "স্টকে রাখা হয়েছে",
      categoryName: catName,
      productName: prodName,
      sellingPrice: 1800,
    });
    const product = productByName(prodName);
    const movements = product ? movementsOf(product.id, usedPart.id) : [];
    const stockedRow = (await api(page, `/api/services/${used.body.id}`)).body;
    check(
      "R6",
      "MOVED_TO_STOCK creates a product, increments stock and writes the exact note",
      stocked.ok &&
        stocked.body.part.partStatus === "MOVED_TO_STOCK" &&
        !!product &&
        product.purchasePrice === 1200 &&
        product.sellingPrice === 1800 &&
        product.stock === 2 &&
        stocked.body.part.targetProductId === product.id &&
        stockedRow.partsCost === 0 &&
        movements.length === 1 &&
        movements[0].movementType === "STOCK_IN" &&
        movements[0].quantity === 2 &&
        movements[0].note === `সার্ভিস #${used.body.id} থেকে স্টকে যুক্ত` &&
        movements[0].reason === `সার্ভিস #${used.body.id} থেকে স্টকে যুক্ত`,
      JSON.stringify({
        product,
        movements,
        target: stocked.body?.part?.targetProductId,
      })
    );

    // Insufficient stock must block the reversal with 409 and roll back.
    await post(page, `/api/products/${product.id}/adjust`, {
      stock: 0,
      reason: "resolution test drain",
    });
    const blocked = await patch(page, `/api/service-parts/${usedPart.id}`, {
      partStatus: "USED",
    });
    const stillStocked = (await api(page, `/api/services/${used.body.id}`)).body;
    check(
      "R7",
      "reversal with insufficient stock is refused and leaves the line unchanged",
      blocked.status === 409 &&
        stillStocked.parts[0].partStatus === "MOVED_TO_STOCK" &&
        stillStocked.parts[0].targetProductId === product.id,
      JSON.stringify({ status: blocked.status, body: blocked.body })
    );

    // Restore stock, then a clean reversal writes STOCK_OUT and restores cost.
    await post(page, `/api/products/${product.id}/adjust`, {
      stock: 2,
      reason: "resolution test restore",
    });
    await patch(page, `/api/service-parts/${usedPart.id}`, { partStatus: "USED" });
    const reversedMovements = movementsOf(product.id, usedPart.id);
    const reversedRow = (await api(page, `/api/services/${used.body.id}`)).body;
    check(
      "R8",
      "reversal writes STOCK_OUT, clears the target and restores device cost",
      reversedMovements.length === 2 &&
        reversedMovements[1].movementType === "STOCK_OUT" &&
        reversedMovements[1].quantity === -2 &&
        productByName(prodName).stock === 0 &&
        reversedRow.parts[0].targetProductId === null &&
        reversedRow.partsCost === 2400,
      JSON.stringify({ movements: reversedMovements, cost: reversedRow.partsCost })
    );

    /* ---------------- RETURNED: no stock, no payable, no Paid ---------- */

    const retShop = uniqueName("ReturnShop");
    const ret = await createService(page, {
      parts: [part({ name: "R-RETURN-PART", price: 700, supplier: retShop })],
    });
    const retPart = (await api(page, `/api/services/${ret.body.id}`)).body.parts[0];
    const retKey = retPart.supplierKey;
    const beforeReturn = await api(
      page,
      `/api/service-parts?supplier=${encodeURIComponent(retKey)}&status=all`
    );
    check(
      "R9",
      "the supplier balance includes the line before it is returned",
      beforeReturn.body.summary.paidTotal + beforeReturn.body.summary.unpaidTotal >= 700,
      JSON.stringify(beforeReturn.body.summary)
    );

    await patch(page, `/api/service-parts/${retPart.id}`, {
      paid: true,
      note: "paid before return",
    });
    const returned = await patch(page, `/api/service-parts/${retPart.id}`, {
      partStatus: "RETURNED",
      resolutionNote: "দোকান ফেরত নিল",
    });
    const afterReturn = await api(
      page,
      `/api/service-parts?supplier=${encodeURIComponent(retKey)}&status=all`
    );
    const retRow = (await api(page, `/api/services/${ret.body.id}`)).body;
    check(
      "R10",
      "RETURNED clears Paid, appends the return reason and leaves supplier balances",
      returned.ok &&
        returned.body.part.partStatus === "RETURNED" &&
        returned.body.part.paidAt === null &&
        /ফেরতকৃত — দোকান ফেরত নিল/.test(returned.body.part.paidNote ?? "") &&
        afterReturn.body.rows.some((r) => r.id === retPart.id) &&
        afterReturn.body.summary.paidTotal === 0 &&
        afterReturn.body.summary.unpaidTotal === 0 &&
        afterReturn.body.summary.total === 0 &&
        retRow.partsCost === 0,
      JSON.stringify({
        part: returned.body?.part,
        summary: afterReturn.body.summary,
      })
    );

    const repaid = await patch(page, `/api/service-parts/${retPart.id}`, {
      paid: true,
      note: "try again",
    });
    const removed = await del(page, `/api/service-parts/${retPart.id}`, {
      note: "try delete",
    });
    check(
      "R11",
      "a returned line cannot be re-marked Paid or deleted",
      repaid.status === 409 && removed.status === 409,
      JSON.stringify({ repaid: repaid.status, removed: removed.status })
    );

    /* ---------------- UI chips, badges and dialog ---------------------- */

    // Start tracking only now: the conflict checks above intentionally produce
    // 409 fetch responses, which Chrome reports as resource console errors.
    const errors = trackErrors(page);
    const uiShop = uniqueName("UiSecretShop");
    const secretPart = `UI-SECRET-PART-${Date.now()}`;
    const ui = await createService(page, {
      customerName: uniqueName("UiReceiptCustomer"),
      parts: [part({ name: secretPart, price: 900, supplier: uiShop })],
    });
    const uiPart = (await api(page, `/api/services/${ui.body.id}`)).body.parts[0];

    await page.goto(`${BASE}/parts`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector(`[data-testid="service-part-row-${uiPart.id}"]`, {
      timeout: 20000,
    });
    const chips = await page.evaluate(() => {
      const lifecycle = document.querySelector('[aria-label="নিষ্পত্তির অবস্থা"]');
      const payment = document.querySelector('[data-testid="parts-payment-filter"]');
      return {
        lifecycle: lifecycle
          ? [...lifecycle.querySelectorAll("button")].map((b) => b.textContent.trim())
          : null,
        payment: payment
          ? [...payment.options].map((o) => o.textContent.trim())
          : null,
        paymentValue: payment ? payment.value : null,
        legacyChipBarGone: !document.querySelector(
          '[aria-label="Paid চিহ্নের অবস্থা"] button'
        ),
      };
    });
    check(
      "R12",
      "one unified toolbar: lifecycle tabs plus a payment-mark dropdown",
      JSON.stringify(chips.lifecycle) ===
        JSON.stringify([
          "সব",
          "ব্যবহৃত",
          "স্টকে যুক্ত",
          "মহাজনে ফেরত",
          "ড্যামেজ",
          "খাতায় রাখা",
        ]) &&
        JSON.stringify(chips.payment) ===
          JSON.stringify(["সব", "Paid চিহ্ন", "চিহ্ন নেই", "তারিখহীন"]) &&
        chips.paymentValue === "all" &&
        chips.legacyChipBarGone,
      JSON.stringify(chips)
    );

    const rowUi = await page.evaluate((id) => {
      const row = document.querySelector(`[data-testid="service-part-row-${id}"]`);
      const statusCell = row?.querySelector("td:nth-child(7)");
      return {
        badge: row.querySelector(`[data-testid="service-part-status-${id}"]`)?.textContent.trim(),
        resolve: !!row.querySelector(`[data-testid="service-part-resolve-${id}"]`),
        paymentMark:
          row.querySelector(`[data-testid="part-payment-mark-${id}"]`)?.textContent.trim() ??
          null,
        statusBadges: statusCell
          ? statusCell.querySelectorAll('[data-testid^="service-part-status-"]').length
          : -1,
      };
    }, uiPart.id);
    check(
      "R13",
      "each row shows one resolution badge, a subtle payment mark and a নিষ্পত্তি action",
      rowUi.badge === "ব্যবহৃত" &&
        rowUi.resolve &&
        rowUi.paymentMark !== null &&
        rowUi.statusBadges === 1,
      JSON.stringify(rowUi)
    );

    await page.click(`[data-testid="service-part-resolve-${uiPart.id}"]`);
    await page.waitForSelector('[data-testid="service-part-resolution-dialog"]', {
      timeout: 10000,
    });
    const options = await page.evaluate(() =>
      [...document.querySelectorAll("[data-testid^='resolution-option-']")].map(
        (b) => b.textContent.replace(/\s+/g, " ").trim()
      )
    );
    check(
      "R14",
      "resolution dialog offers all five states, including keep-in-ledger",
      options.length === 5 &&
        options.some((o) => o.includes("ব্যবহৃত")) &&
        options.some((o) => o.includes("স্টকে যুক্ত")) &&
        options.some((o) => o.includes("ফেরত")) &&
        options.some((o) => o.includes("ড্যামেজ ক্ষতি")) &&
        options.some((o) => o.includes("খাতায় রাখা")),
      JSON.stringify(options)
    );

    await page.click('[data-testid="resolution-option-DAMAGED"]');
    await page.click('[data-testid="service-part-resolution-submit"]');
    await page.waitForFunction(
      (id) =>
        document.querySelector(`[data-testid="service-part-status-${id}"]`)
          ?.textContent.includes("ড্যামেজ ক্ষতি"),
      { polling: 500, timeout: 12000 },
      uiPart.id
    );
    check(
      "R15",
      "choosing DAMAGED in the dialog updates the row badge and the loss",
      damageOf(ui.body.id) === 900 &&
        (await api(page, `/api/services/${ui.body.id}`)).body.partsCost === 0,
      `damageLoss=${damageOf(ui.body.id)}`
    );

    /* ---------------- receipt stays customer-safe --------------------- */

    // Deep link opens the receipt directly, independent of the daily list date.
    await page.goto(`${BASE}/service?receipt=${ui.body.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () => document.body.textContent.includes("বিল প্রিভিউ"),
      { polling: 500, timeout: 10000 }
    );
    const receipt = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog ? dialog.textContent : "";
    });
    check(
      "R16",
      "receipt never shows a part name, supplier shop or damage loss",
      !receipt.includes(secretPart) &&
        !receipt.includes(uiShop) &&
        !receipt.includes("ড্যামেজ") &&
        !receipt.includes("৯০০"),
      receipt.slice(0, 200)
    );

    /* ---------------- responsive layout of the new controls ----------- */

    const responsive = [];
    for (const width of [1920, 1440, 820, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(`${BASE}/parts`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector('[aria-label="নিষ্পত্তির অবস্থা"]', {
        timeout: 20000,
      });
      responsive.push(
        await page.evaluate(async (w) => {
          const group = document.querySelector('[aria-label="নিষ্পত্তির অবস্থা"]');
          const row = document.querySelector('[data-testid^="service-part-row-"]');
          // shadcn's Table already wraps <table> in its own overflow-auto div,
          // so walk up from a button to the element that actually scrolls.
          let scroller = row?.querySelector('[data-testid^="service-part-resolve-"]')
            ?.parentElement;
          while (scroller && scroller.scrollWidth <= scroller.clientWidth) {
            scroller = scroller.parentElement;
          }
          if (scroller) {
            scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
            // Let Chrome apply the scroll offset before measuring the buttons.
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve))
            );
          }
          const sr = scroller?.getBoundingClientRect();
          let actions = [];
          if (row && sr) {
            actions = [...row.querySelectorAll("td:last-child button")].map((b) => {
              const r = b.getBoundingClientRect();
              return (
                r.left >= sr.left - 1 &&
                r.right <= sr.right + 1 &&
                r.right <= innerWidth + 1
              );
            });
          }
          const doc = document.documentElement;
          return {
            width: w,
            chips: group ? group.querySelectorAll("button").length : 0,
            chipsVisible: !!group && getComputedStyle(group).display !== "none",
            docOverflow: doc.scrollWidth - doc.clientWidth,
            actions,
            scrolled: !!scroller,
          };
        }, width)
      );
    }
    check(
      "R17",
      "resolution chips and row actions work at 1920/1440/820/390 without document overflow",
      responsive.every(
        (r) => r.chips === 6 && r.chipsVisible && r.docOverflow <= 0
      ) &&
        responsive.every(
          (r) => r.actions.length === 0 || r.actions.every(Boolean)
        ),
      JSON.stringify(responsive)
    );

    // The dialog itself must fit the smallest supported phone width.
    await page.waitForSelector('[data-testid^="service-part-resolve-"]', {
      timeout: 15000,
    });
    await page.click('[data-testid^="service-part-resolve-"]');
    await page.waitForSelector('[data-testid="service-part-resolution-dialog"]', {
      timeout: 10000,
    });
    const dialogFit = { ok: true, why: "" };
    const dialogBox = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="service-part-resolution-dialog"]');
      const r = el?.getBoundingClientRect();
      return r
        ? { left: r.left, right: r.right, viewport: innerWidth }
        : null;
    });
    check(
      "R18",
      "resolution dialog fits at 390px",
      dialogFit.ok &&
        !!dialogBox &&
        dialogBox.left >= -1 &&
        dialogBox.right <= dialogBox.viewport + 1,
      JSON.stringify({ dialogFit, dialogBox })
    );

    // A refunded (Returned) job is a closed ledger row: its part resolution,
    // damageLoss and supplier balance must be frozen. The refund endpoint
    // resolves parts before stamping Returned, so only later PATCHes are 409.
    const frozen = await createService(page, {
      parts: [part({ name: "R-FROZEN-PART", supplier: uniqueName("FrozenShop") })],
    });
    assert.equal(frozen.status, 201, JSON.stringify(frozen.body));
    const frozenPart = (await api(page, `/api/services/${frozen.body.id}`)).body.parts[0];
    const frozenRefund = await post(page, `/api/services/${frozen.body.id}/refund`, {
      partResolution: "DAMAGED",
    });
    // The refund's bulk resolution changes the line to DAMAGED before it stamps
    // the row Returned. Re-read it so the assertion checks the post-resolution
    // state, not the pre-refresh snapshot captured above.
    const frozenPartAfter = (
      await api(page, `/api/services/${frozen.body.id}`)
    ).body.parts[0];
    const lossBefore = damageOf(frozen.body.id);
    const frozenPatch = await patch(page, `/api/service-parts/${frozenPart.id}`, {
      partStatus: "USED",
    });
    check(
      "R20",
      "a part cannot be re-resolved after its service was returned (closed ledger)",
      frozenRefund.ok &&
        (await api(page, `/api/services/${frozen.body.id}`)).body.status === "Returned" &&
        frozenPatch.status === 409 &&
        frozenPartAfter.partStatus === "DAMAGED" &&
        damageOf(frozen.body.id) === lossBefore &&
        lossBefore > 0,
      JSON.stringify({
        refund: frozenRefund.status,
        patch: frozenPatch.status,
        patchBody: frozenPatch.body,
        lossBefore,
        lossAfter: damageOf(frozen.body.id),
      })
    );

    // The /parts page owns an all-time shop-bill summary in its parent. Any
    // ledger write in the child must refetch it, not just the filtered table.
    await page.setViewport({ width: 1280, height: 900 });
    const usedLedgerRows = (
      await api(page, "/api/service-parts?status=all&resolution=USED")
    ).body.rows;
    if (!usedLedgerRows.length) throw new Error("no USED part row for parent-refresh check");
    const refreshRow = usedLedgerRows[0];
    await page.goto(`${BASE}/parts`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    // Shop totals now live in the masthead's management dialog; the ledger
    // underneath stays interactive once the dialog is dismissed. Wait for the
    // reactive ledger before clicking so hydration has attached the handler.
    await page.waitForSelector('[data-testid="service-parts-ledger"]', {
      timeout: 20000,
    });
    await page.click('[data-testid="parts-shop-manager-trigger"]');
    await page.waitForSelector('[data-testid="parts-shop-manager-dialog"]', {
      timeout: 20000,
    });
    await page.waitForSelector('[data-testid="part-shops-total"]', {
      timeout: 20000,
    });
    const totalBefore = await page.$eval(
      '[data-testid="part-shops-total"]',
      (el) => el.textContent
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="parts-shop-manager-dialog"]'),
      { polling: 100, timeout: 6000 }
    );
    await page.waitForSelector(
      `[data-testid="service-part-resolve-${refreshRow.id}"]`,
      { timeout: 10000 }
    );
    await page.click(`[data-testid="service-part-resolve-${refreshRow.id}"]`);
    await page.waitForSelector('[data-testid="service-part-resolution-dialog"]', {
      timeout: 10000,
    });
    await page.click('[data-testid="resolution-option-RETURNED"]');
    await page.type("#resolution-note", "অডিট: প্যারেন্ট হিসাব refresh");
    await page.click('[data-testid="service-part-resolution-submit"]');
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="service-part-resolution-dialog"]'),
      { polling: 100, timeout: 8000 }
    );
    await page.click('[data-testid="parts-shop-manager-trigger"]');
    await page.waitForSelector('[data-testid="parts-shop-manager-dialog"]', {
      timeout: 10000,
    });
    await page.waitForSelector('[data-testid="part-shops-total"]', {
      timeout: 10000,
    });
    await page.waitForFunction(
      (prev) =>
        document.querySelector('[data-testid="part-shops-total"]')?.textContent !==
        prev,
      { polling: 500, timeout: 12000 },
      totalBefore
    );
    const totalAfter = await page.$eval(
      '[data-testid="part-shops-total"]',
      (el) => el.textContent
    );
    check(
      "R21",
      "a ledger resolution refreshes the parent shop totals, not only the filtered rows",
      totalBefore !== totalAfter &&
        (await api(page, "/api/service-parts?status=all&resolution=RETURNED")).body.rows.some(
          (r) => r.id === refreshRow.id
        ),
      JSON.stringify({ totalBefore, totalAfter, rowId: refreshRow.id })
    );

    /* ---------------- KEPT_IN_LEDGER: external part, no own stock ---------------- */

    const keepShop = uniqueName("KeepLedgerShop");
    const keepPartName = uniqueName("KeepLedgerPart");
    const keepSvc = await createService(page, {
      parts: [
        part({ name: keepPartName, quantity: 2, price: 450, supplier: keepShop }),
      ],
    });
    assert.equal(keepSvc.status, 201, JSON.stringify(keepSvc.body));
    const keepPart = (await api(page, `/api/services/${keepSvc.body.id}`)).body.parts[0];

    const kept = await patch(page, `/api/service-parts/${keepPart.id}`, {
      partStatus: "KEPT_IN_LEDGER",
      resolutionNote: "বাইরের দোকানের খাতায় রাখা",
    });
    const afterKeep = (await api(page, `/api/services/${keepSvc.body.id}`)).body;
    const keepMovements =
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM StockMovement WHERE refType = 'SERVICE_PART' AND refId = ?"
        )
        .get(keepPart.id)?.n ?? -1;
    check(
      "R26",
      "KEPT_IN_LEDGER keeps the line in /parts with no product stock and no damage charge",
      kept.ok &&
        kept.body.part.partStatus === "KEPT_IN_LEDGER" &&
        kept.body.part.resolutionNote === "বাইরের দোকানের খাতায় রাখা" &&
        !!kept.body.part.resolvedAt &&
        kept.body.part.targetProductId === null &&
        afterKeep.partsCost === 0 &&
        damageOf(keepSvc.body.id) === 0 &&
        !productByName(keepPartName) &&
        keepMovements === 0,
      JSON.stringify({
        status: kept.status,
        error: kept.body?.error,
        partStatus: kept.body?.part?.partStatus,
        cost: afterKeep.partsCost,
        loss: damageOf(keepSvc.body.id),
        product: !!productByName(keepPartName),
        movements: keepMovements,
      })
    );

    const keptLedger = await api(
      page,
      `/api/service-parts?supplier=${encodeURIComponent(keepShop)}&status=all&resolution=KEPT_IN_LEDGER`
    );
    const keepAllLedger = await api(
      page,
      `/api/service-parts?supplier=${encodeURIComponent(keepShop)}&status=all&resolution=all`
    );
    check(
      "R27",
      "a kept line still counts toward the supplier payable balance and its own ledger tab",
      keptLedger.ok &&
        keptLedger.body.rows.some((r) => r.id === keepPart.id) &&
        keptLedger.body.rows.every((r) => r.partStatus === "KEPT_IN_LEDGER") &&
        keptLedger.body.summary.total === 900 &&
        keepAllLedger.ok &&
        keepAllLedger.body.summary.total === 900 &&
        keepAllLedger.body.summary.unpaidTotal === 900,
      JSON.stringify({
        tabTotal: keptLedger.body?.summary?.total,
        tabRows: keptLedger.body?.rows?.length,
        allTotal: keepAllLedger.body?.summary?.total,
        unpaid: keepAllLedger.body?.summary?.unpaidTotal,
      })
    );

    // R20's 409 (Conflict) and R26's 400 (Bad Request) before the feature is
    // wired are expected outcomes, not browser regressions.
    const unexpectedErrors = errors.filter(
      (entry) => !/409 \(Conflict\)/.test(entry) && !/400 \(Bad Request\)/.test(entry)
    );
    check(
      "R19",
      "no unexpected browser errors on the parts or receipt screens",
      unexpectedErrors.length === 0,
      JSON.stringify(unexpectedErrors)
    );
  } catch (err) {
    check("R-FATAL", "suite completed without throwing", false, err.stack || String(err));
  } finally {
    if (db) db.close();
    await closeBrowser(browser);
    console.log(results.join("\n"));
    console.log(
      `\n${results.length - (failed ? 1 : 0)}/${results.length} checks passed`
    );
    process.exitCode = failed ? 1 : 0;
  }
})();
