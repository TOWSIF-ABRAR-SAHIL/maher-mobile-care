/* Customer device return / warranty refund / inspection fee workflow.
 *
 * Runs on the throwaway DB supplied by scripts/run-tests.js and pins the four
 * real-world return scenarios end to end: fee retention, post-delivery warranty
 * reversal, grouped-visit cash vs sibling transfer, and the smart parts prompt.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  uniqueName,
  waitDailyRow,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`;
  results.push(line);
  if (!ok) failed = true;
};

async function send(page, method, url, body) {
  return api(page, url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}
const post = (page, url, body) => send(page, "POST", url, body);
const put = (page, url, body) => send(page, "PUT", url, body);

async function text(page, url) {
  return page.evaluate(async (p) => {
    const res = await fetch(p);
    return res.text();
  }, url);
}

function part(overrides = {}) {
  return {
    name: uniqueName("ReturnPart"),
    quantity: 1,
    price: 500,
    supplier: uniqueName("ReturnSupplier"),
    purchaseDate: TODAY,
    ...overrides,
  };
}

async function createService(page, overrides = {}) {
  return post(page, "/api/services", {
    customerName: uniqueName("ReturnCustomer"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "Return Model",
    technician: "NURUL",
    problem: "Return probe",
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
    const rowOf = (id) =>
      db.prepare("SELECT * FROM Service WHERE id = ?").get(id);
    const partsOf = (id) =>
      db.prepare("SELECT * FROM ServicePart WHERE serviceId = ? ORDER BY id").all(id);
    const productOf = (name) =>
      db.prepare("SELECT * FROM Product WHERE name = ? ORDER BY id DESC").get(name);

    /* ---------- S1: inspection fee retained, rest refunded ---------- */

    const feeStatsBefore = (await api(page, `/api/stats?date=${TODAY}`)).body;
    const feeMonthBefore = (await api(page, `/api/stats/monthly?date=${TODAY}`)).body;
    const feeSvc = await createService(page, {
      customerName: uniqueName("FeeCustomer"),
      totalBill: 3000,
      advance: 500,
    });
    assert.equal(feeSvc.status, 201, JSON.stringify(feeSvc.body));
    const feeId = feeSvc.body.id;
    const feeRefund = await post(page, `/api/services/${feeId}/refund`, {
      inspectionFee: 100,
      returnReason: "কাস্টার্ড চেকিংয়ের পর মেরামত প্রত্যাখ্যাত",
    });
    const feeRow = rowOf(feeId);
    check(
      "W1",
      "inspection fee splits the advance into cash refund and retained labor charge",
      feeRefund.ok &&
        feeRow.status === "Returned" &&
        feeRow.refundAmount === 400 &&
        feeRow.totalBill === 100 &&
        feeRow.advance === 100 &&
        feeRow.due === 0 &&
        feeRow.inspectionFee === 100 &&
        feeRow.deliveredAt === null,
      JSON.stringify({
        status: feeRefund.status,
        body: feeRefund.body,
        row: feeRow && {
          status: feeRow.status,
          refund: feeRow.refundAmount,
          bill: feeRow.totalBill,
          advance: feeRow.advance,
          due: feeRow.due,
          fee: feeRow.inspectionFee,
        },
      })
    );

    const feeStatsAfter = (await api(page, `/api/stats?date=${TODAY}`)).body;
    const feeMonthAfter = (await api(page, `/api/stats/monthly?date=${TODAY}`)).body;
    // The baseline was taken before the job existed, so its whole net revenue
    // footprint is exactly the retained fee — real labor profit, not a refund.
    const expectedFeeRevenue = 100;
    check(
      "W2",
      "daily and monthly revenue count the retained fee as pure labor profit",
      feeStatsAfter.today.bill - feeStatsBefore.today.bill === expectedFeeRevenue &&
        feeMonthAfter.summary.bill - feeMonthBefore.summary.bill ===
          expectedFeeRevenue &&
        feeMonthAfter.summary.profit - feeMonthBefore.summary.profit ===
          expectedFeeRevenue,
      JSON.stringify({
        dayDelta: feeStatsAfter.today.bill - feeStatsBefore.today.bill,
        monthBillDelta: feeMonthAfter.summary.bill - feeMonthBefore.summary.bill,
        monthProfitDelta:
          feeMonthAfter.summary.profit - feeMonthBefore.summary.profit,
        expected: expectedFeeRevenue,
      })
    );

    const tooBig = await createService(page, { advance: 50 });
    const badFee = await post(page, `/api/services/${tooBig.body.id}/refund`, {
      inspectionFee: 100,
    });
    const negativeFee = await createService(page, { advance: 500 });
    const badNegative = await post(
      page,
      `/api/services/${negativeFee.body.id}/refund`,
      { inspectionFee: -10 }
    );
    check(
      "W3",
      "a fee above the collected advance or below zero is rejected",
      badFee.status === 400 && badNegative.status === 400,
      JSON.stringify({ big: badFee.status, negative: badNegative.status })
    );

    /* ---------- S2: warranty reversal after delivery ---------- */

    const delivered = await createService(page, {
      customerName: uniqueName("WarrantyCustomer"),
      totalBill: 2000,
      advance: 2000,
    });
    const delivery = await put(page, `/api/services/${delivered.body.id}`, {
      status: "Delivered",
    });
    const deliveredBefore = rowOf(delivered.body.id);
    const reversal = await post(
      page,
      `/api/services/${delivered.body.id}/refund`,
      { note: "মেরামত আবার নষ্ট হয়েছে" }
    );
    const reversedRow = rowOf(delivered.body.id);
    check(
      "W4",
      "a Delivered job can be reversed; it becomes Returned and loses deliveredAt",
      delivery.ok &&
        !!deliveredBefore.deliveredAt &&
        reversal.ok &&
        reversedRow.status === "Returned" &&
        reversedRow.deliveredAt === null &&
        reversedRow.refundAmount === 2000 &&
        reversedRow.due === 0,
      JSON.stringify({
        stamped: !!deliveredBefore.deliveredAt,
        status: reversal.status,
        refund: reversedRow.refundAmount,
        deliveredAt: reversedRow.deliveredAt,
      })
    );

    const custom = await createService(page, {
      customerName: uniqueName("CustomRefundCustomer"),
      totalBill: 1000,
      advance: 1000,
    });
    const customRefund = await post(
      page,
      `/api/services/${custom.body.id}/refund`,
      { refundAmount: 250, returnReason: "আংশিক ফেরত" }
    );
    const customRow = rowOf(custom.body.id);
    check(
      "W5",
      "a custom refund records the paid-back cash and keeps audit bill/advance",
      customRefund.ok &&
        customRow.refundAmount === 250 &&
        customRow.totalBill === 1000 &&
        customRow.advance === 1000 &&
        customRow.due === 0 &&
        customRow.returnReason === "আংশিক ফেরত",
      JSON.stringify({
        refund: customRow.refundAmount,
        bill: customRow.totalBill,
        advance: customRow.advance,
        reason: customRow.returnReason,
      })
    );

    const flagged = await createService(page, {
      parts: [part({ name: uniqueName("WarrantyPart"), price: 700 })],
    });
    const flaggedPart = partsOf(flagged.body.id)[0];
    const flaggedRefund = await post(
      page,
      `/api/services/${flagged.body.id}/refund`,
      { partResolution: "RETURNED" }
    );
    check(
      "W6",
      "returning a job flags its attached part for supplier resolution",
      flaggedRefund.ok &&
        partsOf(flagged.body.id).every(
          (p) =>
            p.partStatus === "RETURNED" &&
            !!p.resolutionNote &&
            !!p.resolvedAt
        ),
      JSON.stringify({
        status: flaggedRefund.status,
        parts: partsOf(flagged.body.id).map((p) => p.partStatus),
      })
    );

    /* ---------- S4: one-click bulk part resolution ---------- */

    const stockNames = [uniqueName("BulkStockA"), uniqueName("BulkStockB")];
    const stockJob = await createService(page, {
      parts: [
        part({ name: stockNames[0], price: 300 }),
        part({ name: stockNames[1], price: 500 }),
      ],
    });
    const stockRefund = await post(
      page,
      `/api/services/${stockJob.body.id}/refund`,
      { partResolution: "MOVED_TO_STOCK" }
    );
    const stockParts = partsOf(stockJob.body.id);
    check(
      "W7",
      "bulk MOVED_TO_STOCK resolves every attached part into real stock",
      stockRefund.ok &&
        stockParts.length === 2 &&
        stockParts.every(
          (p) => p.partStatus === "MOVED_TO_STOCK" && !!p.targetProductId
        ) &&
        stockNames.every((name) => (productOf(name)?.stock ?? 0) >= 1),
      JSON.stringify({
        status: stockRefund.status,
        parts: stockParts.map((p) => ({
          status: p.partStatus,
          target: p.targetProductId,
        })),
      })
    );

    const damageJob = await createService(page, {
      parts: [
        part({ name: uniqueName("BulkDamageA"), price: 400 }),
        part({ name: uniqueName("BulkDamageB"), price: 600 }),
      ],
    });
    const damageRefund = await post(
      page,
      `/api/services/${damageJob.body.id}/refund`,
      { partResolution: "DAMAGED" }
    );
    check(
      "W8",
      "bulk DAMAGED moves every part's full cost into the internal loss once",
      damageRefund.ok &&
        partsOf(damageJob.body.id).every((p) => p.partStatus === "DAMAGED") &&
        rowOf(damageJob.body.id).damageLoss === 1000,
      JSON.stringify({
        loss: rowOf(damageJob.body.id).damageLoss,
        parts: partsOf(damageJob.body.id).map((p) => p.partStatus),
      })
    );

    /* ---------- S4b: keep external parts in the ledger on refund ---------- */

    const keepBulkShop = uniqueName("KeepBulkShop");
    const keepBulkNames = [uniqueName("KeepBulkA"), uniqueName("KeepBulkB")];
    const keepBulkJob = await createService(page, {
      parts: [
        part({ name: keepBulkNames[0], price: 300, supplier: keepBulkShop }),
        part({ name: keepBulkNames[1], price: 500, supplier: keepBulkShop }),
      ],
    });
    const keepBulkQuery = `/api/service-parts?supplier=${encodeURIComponent(
      keepBulkShop
    )}&status=all&resolution=all`;
    const keepBulkBefore = await api(page, keepBulkQuery);
    const keepBulkRefund = await post(
      page,
      `/api/services/${keepBulkJob.body.id}/refund`,
      { partResolution: "KEPT_IN_LEDGER" }
    );
    const keptBulkParts = partsOf(keepBulkJob.body.id);
    const keptBulkMoves =
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM StockMovement WHERE refType = 'SERVICE_PART' AND refId IN (?, ?)"
        )
        .get(
          keptBulkParts[0]?.id ?? -1,
          keptBulkParts[1]?.id ?? -1
        )?.n ?? -1;
    check(
      "W23",
      "bulk KEPT_IN_LEDGER closes the job without product stock or a damage charge",
      keepBulkRefund.ok &&
        rowOf(keepBulkJob.body.id).status === "Returned" &&
        keptBulkParts.length === 2 &&
        keptBulkParts.every(
          (p) =>
            p.partStatus === "KEPT_IN_LEDGER" &&
            !!p.resolvedAt &&
            p.targetProductId === null
        ) &&
        rowOf(keepBulkJob.body.id).expenseWrittenOff === 1 &&
        rowOf(keepBulkJob.body.id).damageLoss === 0 &&
        keepBulkNames.every((name) => !productOf(name)) &&
        keptBulkMoves === 0,
      JSON.stringify({
        status: keepBulkRefund.status,
        error: keepBulkRefund.body?.error,
        row: rowOf(keepBulkJob.body.id)?.status,
        writeoff: rowOf(keepBulkJob.body.id)?.expenseWrittenOff,
        loss: rowOf(keepBulkJob.body.id)?.damageLoss,
        parts: keptBulkParts.map((p) => p.partStatus),
        movements: keptBulkMoves,
      })
    );

    const keepBulkAfter = await api(page, keepBulkQuery);
    const keepBulkTab = await api(
      page,
      `/api/service-parts?supplier=${encodeURIComponent(
        keepBulkShop
      )}&status=all&resolution=KEPT_IN_LEDGER`
    );
    check(
      "W24",
      "the supplier still owes for both parts after a keep-in-ledger refund",
      keepBulkBefore.ok &&
        keepBulkBefore.body.summary.total === 800 &&
        keepBulkAfter.ok &&
        keepBulkAfter.body.summary.total === 800 &&
        keepBulkAfter.body.summary.unpaidTotal === 800 &&
        keepBulkTab.ok &&
        keepBulkTab.body.rows.length === 2 &&
        keepBulkTab.body.rows.every(
          (r) => r.partStatus === "KEPT_IN_LEDGER"
        ) &&
        keepBulkTab.body.summary.total === 800,
      JSON.stringify({
        before: keepBulkBefore.body?.summary?.total,
        after: keepBulkAfter.body?.summary?.total,
        unpaid: keepBulkAfter.body?.summary?.unpaidTotal,
        tabRows: keepBulkTab.body?.rows?.length,
      })
    );

    /* ---------- S3: grouped visit, cash vs sibling transfer ---------- */

    const groupCustomer = uniqueName("GroupReturnCustomer");
    const group = await post(page, "/api/services/batch", {
      customerName: groupCustomer,
      phone: "01700000551",
      technician: "NURUL",
      serviceDate: TODAY,
      // One visit advance, entered once (waterfall). The returned device is
      // first, so it holds exactly 500 of the collected advance.
      visitAdvance: 500,
      // Waterfall allocation fills devices in order; the returned device goes
      // first so it actually holds the advance being refunded/transferred.
      devices: [
        {
          model: "Returned Device",
          problem: "failed",
          totalBill: "1000",
          advance: "500",
          status: "In-Progress",
        },
        {
          model: "Repaired Device",
          problem: "done",
          totalBill: "3000",
          advance: "500",
          status: "In-Progress",
        },
      ],
    });
    assert.equal(group.status, 201, JSON.stringify(group.body));
    const [cashId, keepId] = group.body.services.map((s) => s.id);
    const cashRefund = await post(page, `/api/services/${cashId}/refund`, {
      advanceAction: "cash",
    });
    check(
      "W9",
      "grouped-visit cash option refunds that device's advance in cash",
      cashRefund.ok && rowOf(cashId).refundAmount === 500,
      JSON.stringify({ refund: rowOf(cashId).refundAmount })
    );

    const transferGroup = await post(page, "/api/services/batch", {
      customerName: uniqueName("TransferCustomer"),
      phone: "01700000552",
      technician: "NURUL",
      serviceDate: TODAY,
      visitAdvance: 500,
      devices: [
        {
          model: "Transferred Device",
          problem: "failed",
          totalBill: "1000",
          advance: "500",
          status: "In-Progress",
        },
        {
          model: "Active Sibling",
          problem: "done",
          totalBill: "3000",
          advance: "500",
          status: "In-Progress",
        },
      ],
    });
    assert.equal(transferGroup.status, 201, JSON.stringify(transferGroup.body));
    const [transferId, siblingId] = transferGroup.body.services.map((s) => s.id);
    const siblingBefore = rowOf(siblingId);
    const transfer = await post(page, `/api/services/${transferId}/refund`, {
      advanceAction: "transfer",
      transferToId: siblingId,
    });
    const siblingAfter = rowOf(siblingId);
    const transferredRow = rowOf(transferId);
    check(
      "W10",
      "grouped-visit transfer moves the advance to the active sibling and cuts its due",
      transfer.ok &&
        transferredRow.status === "Returned" &&
        transferredRow.refundAmount === 0 &&
        siblingAfter.advance === siblingBefore.advance + 500 &&
        siblingAfter.due === Math.max(0, siblingAfter.totalBill - siblingAfter.advance) &&
        siblingAfter.due < siblingBefore.due,
      JSON.stringify({
        status: transfer.status,
        refund: transferredRow.refundAmount,
        before: { advance: siblingBefore.advance, due: siblingBefore.due },
        after: { advance: siblingAfter.advance, due: siblingAfter.due },
      })
    );

    const otherGroup = await createService(page, { advance: 500 });
    const badTransfer = await post(page, `/api/services/${otherGroup.body.id}/refund`, {
      advanceAction: "transfer",
      transferToId: siblingId,
    });
    check(
      "W11",
      "a transfer target outside the same live group is refused",
      badTransfer.status === 400,
      JSON.stringify({ status: badTransfer.status, body: badTransfer.body })
    );

    /* ---------- backup audit columns ---------- */

    const csv = await text(page, "/api/backup?format=csv");
    const headerLine = csv.split("\n")[0].replace(/^\uFEFF/, "");
    const feeLine = csv
      .split("\n")
      .find((line) => line.startsWith(`${feeId},`));
    check(
      "W12",
      "CSV audit backup exports the new fee and return-reason columns",
      headerLine.includes("inspectionFee") &&
        headerLine.includes("returnReason") &&
        !!feeLine &&
        /(^|,)100,/.test(feeLine) &&
        feeLine.includes("কাস্টার্ড চেকিংয়ের পর মেরামত প্রত্যাখ্যাত"),
      JSON.stringify({ header: headerLine.slice(0, 200), hasRow: !!feeLine })
    );

    /* ---------- UI: Delivered action + parts prompt ---------- */

    const errors = trackErrors(page);
    const uiJob = await createService(page, {
      customerName: uniqueName("UiReturnCustomer"),
      totalBill: 2000,
      advance: 800,
      parts: [part({ name: uniqueName("UiReturnPart"), price: 650 })],
    });
    assert.equal(uiJob.status, 201, JSON.stringify(uiJob.body));
    const uiId = uiJob.body.id;
    const deliveredUi = await put(page, `/api/services/${uiId}`, {
      status: "Delivered",
    });
    assert.equal(deliveredUi.ok, true, JSON.stringify(deliveredUi.body));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/service`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="daily-services"]', {
      timeout: 20000,
    });
    // Single-device rows have no visit-row testid; wait for the client fetch to
    // paint this customer, then use the shared row-button helper (as laneE does).
    await page.waitForFunction(
      (name) => {
        const section = document.querySelector('[data-testid="daily-services"]');
        return !!section && section.textContent.includes(name);
      },
      { polling: 500, timeout: 20000 },
      uiJob.body.customerName
    );
    await clickDailyRowButton(
      page,
      uiJob.body.customerName,
      "ফেরত / ড্যামেজ ক্ষতি"
    );
    await page.waitForSelector('[data-testid="service-adjust-dialog"]', {
      timeout: 10000,
    });
    const uiDialog = await page.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const parts = document.querySelector('[data-testid="adjust-parts-list"]');
      return {
        fee: !!q("adjust-inspection-fee"),
        refund: !!q("adjust-refund-amount"),
        partsList: !!parts,
        partRows: parts ? parts.querySelectorAll("[data-testid^='adjust-part-row-']").length : 0,
        bulk: [
          "adjust-parts-returned",
          "adjust-parts-stock",
          "adjust-parts-damage",
          "adjust-parts-kept",
        ].every((id) => !!q(id)),
        expensePromptHidden: !q("adjust-expense-choice"),
        confirmDisabledBeforeChoice:
          q("adjust-refund-confirm")?.hasAttribute("disabled") ?? false,
      };
    });
    check(
      "W13",
      "the parts return dialog hides the legacy expense choice until a part decision unlocks refund",
      uiDialog.fee &&
        uiDialog.refund &&
        uiDialog.partsList &&
        uiDialog.partRows === 1 &&
        uiDialog.bulk &&
        uiDialog.expensePromptHidden &&
        uiDialog.confirmDisabledBeforeChoice,
      JSON.stringify(uiDialog)
    );

    await page.click('[data-testid="adjust-parts-returned"]');
    await page.click('[data-testid="adjust-refund-confirm"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="service-adjust-dialog"]'),
      { polling: 500, timeout: 12000 }
    );
    check(
      "W14",
      "one-click supplier return in the dialog resolves the attached part with the refund",
      rowOf(uiId).status === "Returned" &&
        partsOf(uiId).every((p) => p.partStatus === "RETURNED"),
      JSON.stringify({
        row: rowOf(uiId).status,
        parts: partsOf(uiId).map((p) => p.partStatus),
      })
    );

    /* ---------- S5: keep-in-ledger chosen inside the dialog ---------- */

    const keepUiJob = await createService(page, {
      customerName: uniqueName("KeepUiCustomer"),
      parts: [
        part({
          name: uniqueName("KeepUiPart"),
          price: 650,
          supplier: uniqueName("KeepUiShop"),
        }),
      ],
    });
    assert.equal(keepUiJob.status, 201, JSON.stringify(keepUiJob.body));
    await page.goto(`${BASE}/service`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="daily-services"]', {
      timeout: 20000,
    });
    await page.waitForFunction(
      (name) => {
        const section = document.querySelector('[data-testid="daily-services"]');
        return !!section && section.textContent.includes(name);
      },
      { polling: 500, timeout: 20000 },
      keepUiJob.body.customerName
    );
    await clickDailyRowButton(
      page,
      keepUiJob.body.customerName,
      "ফেরত / ড্যামেজ ক্ষতি"
    );
    await page.waitForSelector('[data-testid="service-adjust-dialog"]', {
      timeout: 10000,
    });
    const keptRadio = await page.$('[data-testid="adjust-parts-kept"]');
    if (keptRadio) {
      await keptRadio.click();
      await page.click('[data-testid="adjust-refund-confirm"]');
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="service-adjust-dialog"]'),
        { polling: 500, timeout: 12000 }
      );
    } else {
      await page.keyboard.press("Escape");
    }
    check(
      "W25",
      "the keep-in-ledger radio in the refund dialog resolves parts without stock",
      !!keptRadio &&
        rowOf(keepUiJob.body.id).status === "Returned" &&
        partsOf(keepUiJob.body.id).every(
          (p) => p.partStatus === "KEPT_IN_LEDGER"
        ),
      JSON.stringify({
        radio: !!keptRadio,
        row: rowOf(keepUiJob.body.id)?.status,
        parts: partsOf(keepUiJob.body.id).map((p) => p.partStatus),
      })
    );

    /* ---------- fee + custom refund invariants (audit regression) ---------- */

    const splitSvc = await createService(page, { advance: 500 });
    const splitId = splitSvc.body.id;
    const splitRefund = await post(page, `/api/services/${splitId}/refund`, {
      inspectionFee: 100,
      refundAmount: 400,
    });
    const splitRow = rowOf(splitId);
    check(
      "W18",
      "a matching fee + custom refund keeps the fee invariant and the full advance accounted for",
      splitRefund.ok &&
        splitRow.status === "Returned" &&
        splitRow.totalBill === 100 &&
        splitRow.advance === 100 &&
        splitRow.refundAmount === 400 &&
        splitRow.inspectionFee === 100 &&
        splitRow.due === 0,
      JSON.stringify({
        status: splitRefund.status,
        body: splitRefund.body,
        row: splitRow,
      })
    );

    const badSplit = await createService(page, { advance: 500 });
    const badSplitRefund = await post(page, `/api/services/${badSplit.body.id}/refund`, {
      inspectionFee: 100,
      refundAmount: 50,
    });
    check(
      "W19",
      "a fee with an arbitrary custom refund is refused instead of silently losing cash",
      badSplitRefund.status === 400 &&
        rowOf(badSplit.body.id).status !== "Returned",
      JSON.stringify({ status: badSplitRefund.status, body: badSplitRefund.body })
    );

    const overSplit = await createService(page, { advance: 500 });
    const overSplitRefund = await post(page, `/api/services/${overSplit.body.id}/refund`, {
      inspectionFee: 100,
      refundAmount: 500,
    });
    check(
      "W20",
      "fee + custom refund above the advance is refused (cash and fee cannot both be full)",
      overSplitRefund.status === 400 &&
        rowOf(overSplit.body.id).status !== "Returned",
      JSON.stringify({ status: overSplitRefund.status, body: overSplitRefund.body })
    );

    const feeTransferGroup = await post(page, "/api/services/batch", {
      customerName: uniqueName("FeeTransferCustomer"),
      phone: "01700000553",
      technician: "NURUL",
      serviceDate: TODAY,
      visitAdvance: 500,
      devices: [
        { model: "Fee Transfer Device", problem: "failed", totalBill: "1000", advance: "500", status: "In-Progress" },
        { model: "Fee Transfer Sibling", problem: "done", totalBill: "3000", advance: "0", status: "In-Progress" },
      ],
    });
    const [feeTransferId, feeSiblingId] = feeTransferGroup.body.services.map((s) => s.id);
    const feeTransfer = await post(page, `/api/services/${feeTransferId}/refund`, {
      inspectionFee: 100,
      advanceAction: "transfer",
      transferToId: feeSiblingId,
    });
    check(
      "W21",
      "a checking fee cannot be combined with a grouped advance transfer",
      feeTransfer.status === 400 && rowOf(feeTransferId).status !== "Returned",
      JSON.stringify({ status: feeTransfer.status, body: feeTransfer.body })
    );

    /* ---------- grouped receipt totals exclude a returned device's audit figures ---------- */

    const receiptGroupCustomer = uniqueName("GroupReceiptFee");
    const receiptGroup = await post(page, "/api/services/batch", {
      customerName: receiptGroupCustomer,
      phone: "01700000554",
      technician: "NURUL",
      serviceDate: TODAY,
      visitAdvance: 500,
      devices: [
        { model: "Group Returned Fee", problem: "failed", totalBill: "1000", advance: "500", status: "In-Progress" },
        { model: "Group Still Active", problem: "done", totalBill: "3000", advance: "0", status: "In-Progress" },
      ],
    });
    const [grpReturnedId] = receiptGroup.body.services.map((s) => s.id);
    await post(page, `/api/services/${grpReturnedId}/refund`, { inspectionFee: 100 });
    await page.goto(`${BASE}/service?date=${TODAY}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitDailyRow(page, receiptGroupCustomer, true);
    await clickDailyRowButton(page, receiptGroupCustomer, "বিল প্রিন্ট");
    await page.waitForSelector('[data-receipt-group]', { timeout: 10000 });
    const groupReceipt = await page.evaluate(
      () => document.querySelector('[data-receipt-group]')?.textContent || ""
    );
    // Returned device contributes only its 100 fee (not its 1000 audit bill);
    // active device contributes its full 3000 bill. No raw 500 advance remains.
    check(
      "W22",
      "a group receipt totals the retained fee instead of a returned device's original bill and advance",
      groupReceipt.includes("Group Returned Fee") &&
        groupReceipt.includes("Group Still Active") &&
        groupReceipt.includes("৳3,100") &&
        !groupReceipt.includes("৳4,000") &&
        !groupReceipt.includes("*J#"),
      groupReceipt.slice(0, 500)
    );

    /* ---------- customer copy stays clean ---------- */

    await page.goto(`${BASE}/service?receipt=${feeId}`, {
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
      "W15",
      "the customer receipt never prints the internal return reason or fee label",
      !receipt.includes("কাস্টার্ড চেকিংয়ের পর মেরামত প্রত্যাখ্যাত") &&
        !receipt.includes("চেকিং / সার্ভিস ফি") &&
        !receipt.includes("মহাজনে ফেরত"),
      receipt.slice(0, 160)
    );

    /* ---------- restore: an older snapshot without new columns still works ---------- */

    const backupDir = process.env.MAHER_BACKUP_DIR;
    if (!backupDir) throw new Error("MAHER_BACKUP_DIR missing");
    // Use the server's own snapshot API (never VACUUM from the test's shared
    // handle — that deadlocks against the live server connection).
    const snap = await post(page, "/api/backup");
    if (!snap.ok) throw new Error("backup snapshot failed: " + JSON.stringify(snap.body));
    const legacyName = snap.body.file;
    const legacyPath = path.join(backupDir, legacyName);
    const legacy = new Database(legacyPath);
    try {
      // Simulate a pre-v1.2.0 backup that has neither return-workflow column.
      legacy.exec('ALTER TABLE "Service" DROP COLUMN "inspectionFee"');
      legacy.exec('ALTER TABLE "Service" DROP COLUMN "returnReason"');
    } finally {
      legacy.close();
    }
    const restore = await post(page, "/api/backup/restore", { file: legacyName });
    const restoredFee = rowOf(feeId);
    check(
      "W16",
      "an older snapshot without the new columns restores with safe defaults",
      restore.ok &&
        restoredFee &&
        (restoredFee.inspectionFee ?? 0) === 0 &&
        (restoredFee.returnReason ?? null) === null,
      JSON.stringify({
        status: restore.status,
        body: restore.body,
        fee: restoredFee?.inspectionFee,
        reason: restoredFee?.returnReason,
      })
    );

    // W19-W21 deliberately post invalid refunds; their 400 responses are the
    // expected outcome, not browser regressions.
    const unexpectedErrors = errors.filter(
      (entry) => !/400 \(Bad Request\)/.test(entry)
    );
    check(
      "W17",
      "no unexpected browser errors",
      unexpectedErrors.length === 0,
      JSON.stringify(unexpectedErrors)
    );
  } catch (err) {
    check("W-FATAL", "suite completed without throwing", false, err.stack || String(err));
  } finally {
    if (db) db.close();
    await closeBrowser(browser);
    console.log(results.join("\n"));
    console.log(`\n${results.length - (failed ? 1 : 0)}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
