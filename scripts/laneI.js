/* Lane I — Phase 2: customer payments, the retired verify tick, paid-slip lock
 * and shop purchases. Runs only on the throwaway DB supplied by run-tests.js.
 *
 *   I1–I6   payment ledger: oldest-first allocation, exact pay, overpay 400
 *   I7      the retired "যাচাই" tick: endpoint is gone (404)
 *   I8–I9   a paid slip may only raise its bill; advance may rise with it
 *           (extra part paid at the counter) but never fall or move alone,
 *           and descriptive edits still work
 *   I10     invalid payment method rejected
 *   I11–I16 purchases: stock-in, totals, supplier payments, isolation from
 *           service expense/profit and from unrelated product stock
 *   I17–I18 UI: payment dialog (inline overpay), inventory-only stock page
 *           and the service-form purchase dialog
 *   I20     the service list no longer renders the verify tick
 */
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
  uniqueName,
  waitDailyRow,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function digits(seed) {
  return String(seed).replace(/\D/g, "").slice(-11).padStart(11, "0");
}

async function post(page, path, body) {
  return api(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function put(page, path, body) {
  return api(page, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

(async () => {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 1000 });
    const errors = trackErrors(page);
    await page.goto(`${BASE}/service`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    // Roster: the create endpoint validates against active technicians.
    const roster = (await api(page, "/api/technicians")).body;
    if (!roster.technicians?.some((t) => t.name === "NURUL")) {
      await post(page, "/api/technicians", { name: "NURUL" });
    }

    const phone = digits(Date.now());
    const name = uniqueName("PayCustomer");
    const base = {
      customerName: name,
      phone,
      model: "M",
      technician: "NURUL",
      problem: "Phase2 test",
      status: "In-Progress",
      shopExpense: "",
    };
    const older = await post(page, "/api/services", {
      ...base,
      model: "OLD",
      totalBill: 1000,
      advance: 200,
      serviceDate: shiftDay(TODAY, -3),
    });
    const newer = await post(page, "/api/services", {
      ...base,
      model: "NEW",
      totalBill: 500,
      advance: 0,
      serviceDate: TODAY,
    });

    // ---- I1: ledger lists both slips, oldest first ----
    const ledger = await api(
      page,
      `/api/payments?phone=${phone}&name=${encodeURIComponent(name)}`
    );
    check(
      "I1",
      "customer ledger lists open slips oldest first",
      ledger.ok &&
        ledger.body.slips.length === 2 &&
        ledger.body.slips[0].id === older.body.id &&
        ledger.body.totalDue === 1300,
      JSON.stringify({
        status: ledger.status,
        ids: ledger.body.slips?.map((s) => s.id),
        due: ledger.body.totalDue,
      })
    );

    // ---- I2: partial payment settles the older slip, not the newer ----
    const partial = await post(page, "/api/payments", {
      phone,
      customerName: name,
      amount: 800,
      method: "BKASH",
    });
    check(
      "I2",
      "partial payment allocates oldest first",
      partial.ok &&
        partial.body.allocations.length === 1 &&
        partial.body.allocations[0].serviceId === older.body.id &&
        partial.body.allocations[0].amount === 800,
      JSON.stringify({ status: partial.status, body: partial.body })
    );

    // ---- I3: first slip is paid, second still owes ----
    let rows = (await api(page, `/api/services?date=${shiftDay(TODAY, -3)}`))
      .body.services;
    const oldRow = rows.find((r) => r.id === older.body.id);
    const newRows = (
      await api(page, `/api/services?date=${TODAY}`)
    ).body.services;
    const newRow = newRows.find((r) => r.id === newer.body.id);
    check(
      "I3",
      "paid is derived from due 0 (older 0, newer 500)",
      oldRow?.due === 0 &&
        oldRow?.advance === 1000 &&
        newRow?.due === 500 &&
        newRow?.advance === 0,
      JSON.stringify({ old: oldRow?.due, newer: newRow?.due })
    );

    // ---- I4: overpay refused, nothing changes ----
    const overpay = await post(page, "/api/payments", {
      phone,
      customerName: name,
      amount: 600,
      method: "CASH",
    });
    const afterOverpay = (
      await api(page, `/api/services?date=${TODAY}`)
    ).body.services.find((r) => r.id === newer.body.id);
    check(
      "I4",
      "payment above outstanding balance is 400 and stores nothing",
      overpay.status === 400 &&
        String(overpay.body.error || "").includes("বেশি") &&
        afterOverpay?.due === 500,
      String(overpay.status)
    );

    // ---- I5: exact remainder clears the customer ----
    const exact = await post(page, "/api/payments", {
      phone,
      customerName: name,
      amount: 500,
      method: "CASH",
    });
    const cleared = await api(
      page,
      `/api/payments?phone=${phone}&name=${encodeURIComponent(name)}`
    );
    check(
      "I5",
      "exact remainder clears both slips and the ledger",
      exact.ok &&
        exact.body.allocations[0].serviceId === newer.body.id &&
        cleared.body.totalDue === 0 &&
        cleared.body.slips.length === 0,
      JSON.stringify({ ids: exact.body.allocations, totalDue: cleared.body.totalDue })
    );

    // ---- I6: paying a cleared customer is refused ----
    const again = await post(page, "/api/payments", {
      phone,
      customerName: name,
      amount: 100,
      method: "CASH",
    });
    check(
      "I6",
      "payment with no outstanding is 400",
      again.status === 400 && String(again.body.error || "").includes("বাকি"),
      String(again.status)
    );

    // ---- I7: the manual "যাচাই" tick was retired (no API, no UI) ----
    // Run from Node, not inside the page: an expected 404 must not trip I19's
    // console-error guard.
    const verifyGone = await fetch(`${BASE}/api/services/${newer.body.id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    check(
      "I7",
      "verify tick is retired: the endpoint answers 404",
      verifyGone.status === 404,
      JSON.stringify({ status: verifyGone.status })
    );

    // ---- I8: paid slip can raise the bill (extra fault found after opening).
    // The customer may pay that extra amount in the same save, so a rise in
    // advance is allowed ONLY when the bill also rises. Lowering either, or
    // changing advance on its own, stays blocked ----
    const loweredBill = await put(page, `/api/services/${older.body.id}`, {
      totalBill: 800,
    });
    const changedAdvance = await put(page, `/api/services/${older.body.id}`, {
      advance: 900,
    });
    const descriptive = await put(page, `/api/services/${older.body.id}`, {
      solution: "মAIN BOARD ঠিক",
      condition: "ওয়ারেন্টি ৭ দিন",
    });
    // The shopkeeper's case: a new part pushes the bill to 1500 and the
    // customer pays it at the counter, so bill and advance rise together.
    const raisedBoth = await put(page, `/api/services/${older.body.id}`, {
      totalBill: 1500,
      advance: 1500,
    });
    const lowerAdvanceWithBill = await put(
      page,
      `/api/services/${older.body.id}`,
      { totalBill: 1600, advance: 1400 }
    );
    const overpaidBoth = await put(page, `/api/services/${older.body.id}`, {
      totalBill: 1600,
      advance: 1700,
    });
    const raisedBill = await put(page, `/api/services/${older.body.id}`, {
      totalBill: 1600,
    });
    const sameMoney = await put(page, `/api/services/${older.body.id}`, {
      totalBill: 1600,
      advance: 1500,
      problem: "এডিট করা সমস্যা",
    });
    check(
      "I8",
      "paid slip: bill+advance rise 200, bill-only rise 200 with due; decreases/alone/overpay 400",
      loweredBill.status === 400 &&
        changedAdvance.status === 400 &&
        descriptive.ok &&
        descriptive.body.solution === "মAIN BOARD ঠিক" &&
        raisedBoth.ok &&
        raisedBoth.body.totalBill === 1500 &&
        raisedBoth.body.advance === 1500 &&
        raisedBoth.body.due === 0 &&
        lowerAdvanceWithBill.status === 400 &&
        overpaidBoth.status === 400 &&
        raisedBill.ok &&
        raisedBill.body.totalBill === 1600 &&
        raisedBill.body.advance === 1500 &&
        raisedBill.body.due === 100 &&
        sameMoney.ok &&
        sameMoney.body.totalBill === 1600,
      JSON.stringify({
        lowered: loweredBill.status,
        advance: changedAdvance.status,
        descriptive: descriptive.status,
        raisedBoth: raisedBoth.status,
        raisedBothDue: raisedBoth.body?.due,
        lowerWithBill: lowerAdvanceWithBill.status,
        overpaid: overpaidBoth.status,
        raised: raisedBill.status,
        raisedDue: raisedBill.body?.due,
        sameMoney: sameMoney.status,
      })
    );

    // ---- I9: an unpaid slip can still change its money ----
    const unpaid = await post(page, "/api/services", {
      ...base,
      customerName: uniqueName("PayUnpaid"),
      phone: digits(Date.now() + 7),
      model: "DUE",
      totalBill: 300,
      advance: 0,
      serviceDate: TODAY,
    });
    const repriced = await put(page, `/api/services/${unpaid.body.id}`, {
      totalBill: 700,
      advance: 100,
    });
    check(
      "I9",
      "unpaid slip keeps editable bill/advance (due 600)",
      repriced.ok && repriced.body.due === 600,
      JSON.stringify({ status: repriced.status, due: repriced.body.due })
    );

    // ---- I10: invalid method rejected ----
    const badMethod = await post(page, "/api/payments", {
      phone,
      customerName: name,
      amount: 1,
      method: "HACK",
    });
    check(
      "I10",
      "invalid payment method is 400",
      badMethod.status === 400,
      String(badMethod.status)
    );

    // ---- Purchases: stock now enters through a supplier bill ----
    const expenseBefore = (await api(page, "/api/stats?all=1")).body.today.expense;
    const category = await post(page, "/api/product-categories", {
      name: uniqueName("PayCat"),
    });
    const product = await post(page, "/api/products", {
      name: uniqueName("PayProduct"),
      categoryId: category.body?.category?.id,
      sellingPrice: 300,
      purchasePrice: 100,
      openingStock: 5,
      lowStockThreshold: 2,
    });
    const productId = product.body?.product?.id;

    const supplier = uniqueName("Supplier");
    const purchase = await post(page, "/api/purchases", {
      supplier,
      invoiceNo: "INV-1",
      purchaseDate: TODAY,
      paid: 0,
      method: "CASH",
      items: [{ productId, quantity: 3, unitCost: 120 }],
    });
    const productsAfter = (await api(page, "/api/products?sort=name")).body
      .products;
    const tracked = productsAfter.find((p) => p.id === productId);
    check(
      "I11",
      "purchase receives stock and updates the last purchase price",
      purchase.ok &&
        purchase.body.total === 360 &&
        tracked?.stock === 8 &&
        tracked?.purchasePrice === 120,
      JSON.stringify({
        category: category.status,
        product: product.status,
        purchase: purchase.status,
        error: purchase.body?.error ?? null,
        total: purchase.body.total,
        stock: tracked?.stock,
        cost: tracked?.purchasePrice,
      })
    );

    // ---- I12: the bill starts on credit ----
    const list = await api(page, "/api/purchases");
    const bill = list.body.purchases.find((p) => p.id === purchase.body.purchaseId);
    check(
      "I12",
      "unpaid purchase shows total as due",
      bill?.total === 360 && bill?.paid === 0 && bill?.due === 360,
      JSON.stringify(bill)
    );

    // ---- I13: supplier overpay refused ----
    const supplierOverpay = await post(page, "/api/purchases/payments", {
      supplier,
      amount: 500,
      method: "CASH",
    });
    check(
      "I13",
      "supplier overpay is 400",
      supplierOverpay.status === 400 &&
        String(supplierOverpay.body.error || "").includes("বেশি"),
      String(supplierOverpay.status)
    );

    // ---- I14: supplier payment settles the oldest open bill first ----
    const olderPurchase = await post(page, "/api/purchases", {
      supplier,
      purchaseDate: shiftDay(TODAY, -2),
      paid: 0,
      items: [{ name: "one-off cable", quantity: 2, unitCost: 100 }],
    });
    const supplierPay = await post(page, "/api/purchases/payments", {
      supplier,
      amount: 400,
      method: "BKASH",
    });
    const list2 = await api(page, "/api/purchases");
    const olderBill = list2.body.purchases.find(
      (p) => p.id === olderPurchase.body.purchaseId
    );
    const newerBill = list2.body.purchases.find(
      (p) => p.id === purchase.body.purchaseId
    );
    check(
      "I14",
      "supplier payment allocates oldest bill first",
      supplierPay.ok &&
        olderBill?.paid === 200 &&
        olderBill?.due === 0 &&
        newerBill?.paid === 200 &&
        newerBill?.due === 160,
      JSON.stringify({
        allocations: supplierPay.body.allocations,
        older: olderBill,
        newer: newerBill,
      })
    );

    // ---- I15: purchases never enter service expense/profit ----
    const expenseAfter = (await api(page, "/api/stats?all=1")).body.today.expense;
    check(
      "I15",
      "purchase money never becomes service expense",
      expenseBefore === expenseAfter,
      `before=${expenseBefore} after=${expenseAfter}`
    );

    // ---- I16: an untracked purchase line leaves tracked stock alone ----
    const stockAfterUntracked = (await api(page, "/api/products?sort=name")).body
      .products.find((p) => p.id === productId)?.stock;
    check(
      "I16",
      "untracked purchase line does not move product stock",
      stockAfterUntracked === 8,
      String(stockAfterUntracked)
    );

    // ---- I17: the payment dialog opens with an inline overpay warning ----
    const dialogRow = await post(page, "/api/services", {
      ...base,
      customerName: uniqueName("PayDialog"),
      phone: digits(Date.now() + 11),
      model: "DIALOG",
      totalBill: 900,
      advance: 0,
      serviceDate: TODAY,
    });
    await page.goto(`${BASE}/service`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await waitDailyRow(page, dialogRow.body.customerName, true);
    const opened = await page.evaluate((id) => {
      const button = document.querySelector(
        `[data-testid="take-payment-${id}"], [data-testid="take-payment-visit-${id}"]`
      );
      if (!button) return false;
      button.click();
      return true;
    }, dialogRow.body.id);
    let dialogReady = false;
    for (let i = 0; i < 40 && opened; i += 1) {
      dialogReady = await page.evaluate(
        () => !!document.querySelector('[data-testid="payment-dialog"]')
      );
      if (dialogReady) break;
      await sleep(250);
    }
    if (dialogReady) {
      await page.$eval(
        '[data-testid="payment-amount"]',
        (el) => {
          el.focus();
          Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          ).set.call(el, "99999");
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      );
    }
    const overpayVisible = dialogReady
      ? await page.evaluate(
          () => !!document.querySelector('[data-testid="payment-overpay"]')
        )
      : false;
    check(
      "I17",
      "payment dialog opens and warns inline on overpay",
      opened && dialogReady && overpayVisible,
      JSON.stringify({ opened, dialogReady, overpayVisible })
    );
    await page.keyboard.press("Escape");
    await sleep(300);

    // ---- I20: the list no longer offers the retired যাচাই tick ----
    const verifyUi = await page.evaluate((id) => {
      const row =
        document.querySelector(`[data-testid="svc-money-${id}"]`)?.closest("tr") ||
        document.querySelector(`[data-testid="svc-money-${id}"]`)?.closest("article");
      const money = row?.innerText.replace(/\s+/g, " ").trim() || "";
      return {
        verifyButton: !!document.querySelector(`[data-testid="verify-${id}"]`),
        verifyBadge: !!document.querySelector(`[data-testid="svc-verified-${id}"]`),
        anyVerify: document.querySelectorAll('[data-testid^="verify-"]').length,
        anyBadge: document.querySelectorAll('[data-testid^="svc-verified-"]').length,
        rowSaysVerify: money.includes("যাচাই"),
        money,
      };
    }, dialogRow.body.id);
    const verifyRow = (
      await api(page, `/api/services?date=${TODAY}`)
    ).body.services.find((row) => row.id === dialogRow.body.id);
    check(
      "I20",
      "service list no longer offers the যাচাই tick (bill/due untouched)",
      !verifyUi.verifyButton &&
        !verifyUi.verifyBadge &&
        verifyUi.anyVerify === 0 &&
        verifyUi.anyBadge === 0 &&
        !verifyUi.rowSaysVerify &&
        verifyRow?.totalBill === 900 &&
        verifyRow?.due === 900,
      JSON.stringify({
        verifyUi,
        totalBill: verifyRow?.totalBill,
        due: verifyRow?.due,
      })
    );

    // ---- I18: the stock page is inventory-only; part bills are opened from
    // the saved service form (the old purchases tab was retired in 43c7c2a) ----
    await page.goto(`${BASE}/products`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    const stockPage = await page.evaluate(() => ({
      productSearch: !!document.querySelector('[data-testid="product-search"]'),
      purchaseTab: [...document.querySelectorAll('[role="tab"]')].some(
        (el) => (el.textContent || "").includes("দোকান ও ক্রয়")
      ),
      purchasesPanel: !!document.querySelector('[data-testid="purchases-panel"]'),
    }));

    await page.goto(`${BASE}/service?edit=${dialogRow.body.id}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await page.waitForSelector("#svc-model", { timeout: 8000 });
    // Parts are entered with the visit itself; the edit form no longer offers
    // a separate wholesale supplier-bill action.
    const editPurchaseUi = await page.evaluate(() => ({
      trigger: [...document.querySelectorAll("button")].some((el) =>
        (el.textContent || "").includes("পার্টস কেনার বিল যোগ করুন")
      ),
      dialog: !!document.querySelector('[data-testid="purchase-dialog"]'),
    }));
    check(
      "I18",
      "stock page stays inventory-only and the service form has no part-purchase action",
      stockPage.productSearch &&
        !stockPage.purchaseTab &&
        !stockPage.purchasesPanel &&
        !editPurchaseUi.trigger &&
        !editPurchaseUi.dialog,
      JSON.stringify({ ...stockPage, ...editPurchaseUi })
    );

    // The negative API cases above deliberately produce HTTP 400s, and Chrome
    // logs each one as a console error. Only real page/console errors count.
    const realErrors = errors.filter((text) => !text.includes("status of 400"));
    check(
      "I19",
      "no unexpected page/console errors during the Phase 2 flows",
      realErrors.length === 0,
      realErrors.slice(0, 2).join(" | ")
    );
  } catch (err) {
    check("I0", "suite completed", false, err.message);
  } finally {
    await closeBrowser(browser);
  }

  console.log(results.join("\n"));
  if (failed) process.exitCode = 1;
})();
