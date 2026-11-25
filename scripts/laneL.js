/* Lane L — optional service parts purchase ledger + simplified products.
 *
 * Runs on the throwaway DB supplied by scripts/run-tests.js. Covers:
 *  - parts are optional; zero rows write nothing and keep the shop-cost lump
 *  - a new part line requires supplier, quantity, price and a purchase date
 *  - one price field: plain number is encoded to a code, typed code kept as-is
 *  - edit merges existing purchase info; a legacy NULL date is never silently
 *    filled or cleared
 *  - Paid is a whole-line flag with append-only history, never a payment
 *  - paid/history lines cannot be removed; returned jobs freeze parts
 *  - part lines and a linked SERVICE_PART bill cannot coexist
 *  - ledger summary depends only on date + supplier, not the status tab
 *  - bulk caps (100 ids / 500 supplier rows) reject the whole operation
 *  - the internal Excel export gets a separate "সার্ভিস পার্টস" sheet
 *  - dropping SKU/barcode from a product update keeps the stored values
 */
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
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
    name: "Samsung A20 display",
    quantity: 1,
    price: 1200,
    supplier: uniqueName("PartsShop"),
    purchaseDate: TODAY,
    ...overrides,
  };
}

async function createService(page, extra = {}) {
  const res = await post(page, "/api/services", {
    customerName: uniqueName("PartCustomer"),
    phone: `01${String(Date.now()).slice(-9)}`,
    model: "Samsung A20",
    technician: "NURUL",
    problem: "Display dead",
    totalBill: 3000,
    advance: 0,
    status: "In-Progress",
    shopExpense: "",
    serviceDate: TODAY,
    ...extra,
  });
  return res;
}

async function getService(page, id) {
  const res = await api(page, `/api/services/${id}`);
  return res.body;
}

(async () => {
  let browser = null;
  let db = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(`${BASE}/service`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    const roster = (await api(page, "/api/technicians")).body;
    if (!roster.technicians?.some((t) => t.name === "NURUL")) {
      await post(page, "/api/technicians", { name: "NURUL" });
    }

    /* ---------------- optional parts ---------------- */

    const noParts = await createService(page);
    const noPartsRow = noParts.ok ? await getService(page, noParts.body.id) : null;
    check(
      "L1",
      "a device with no parts payload saves and writes no part rows",
      noParts.status === 201 &&
        Array.isArray(noPartsRow?.parts) &&
        noPartsRow.parts.length === 0 &&
        noPartsRow.partsCost === null,
      JSON.stringify({ status: noParts.status, parts: noPartsRow?.parts, cost: noPartsRow?.partsCost })
    );

    const emptyParts = await createService(page, { parts: [] });
    const emptyRow = emptyParts.ok ? await getService(page, emptyParts.body.id) : null;
    check(
      "L2",
      "an explicit empty parts list is the same as no parts",
      emptyParts.status === 201 && emptyRow?.parts.length === 0 && emptyRow?.partsCost === null,
      JSON.stringify({ status: emptyParts.status, parts: emptyRow?.parts })
    );

    const shop = uniqueName("ShopA");
    const priced = await createService(page, {
      parts: [
        {
          name: "Samsung A20 display",
          quantity: 2,
          price: 1200,
          // A stale client cost must be ignored: lineCost is server-derived.
          lineCost: 999999,
          supplier: shop,
          purchaseDate: TODAY,
        },
      ],
    });
    const pricedRow = priced.ok ? await getService(page, priced.body.id) : null;
    const pricedPart = pricedRow?.parts?.[0];
    check(
      "L3",
      "a valid part line stores supplier/date, encodes the price and derives lineCost server-side",
      priced.status === 201 &&
        pricedRow.parts.length === 1 &&
        pricedPart.unitCost === 1200 &&
        pricedPart.lineCost === 2400 &&
        pricedPart.supplier === shop &&
        pricedPart.supplierKey === shop.toLowerCase() &&
        pricedPart.priceCode === "*A#" &&
        pricedPart.purchaseDate === TODAY &&
        pricedRow.partsCost === 2400,
      JSON.stringify({ status: priced.status, part: pricedPart, cost: pricedRow?.partsCost })
    );

    const coded = await createService(page, {
      parts: [part({ name: "Keypad code part", quantity: 1, price: "*J#" })],
    });
    const codedPart = coded.ok ? (await getService(page, coded.body.id)).parts[0] : null;
    check(
      "L4",
      "a keypad price code decodes to money and keeps the typed code separately",
      coded.status === 201 &&
        codedPart?.unitCost === 1500 &&
        codedPart?.lineCost === 1500 &&
        codedPart?.priceCode === "*J#",
      JSON.stringify(codedPart)
    );

    const missingDate = await createService(page, {
      parts: [part({ purchaseDate: "" })],
    });
    check(
      "L5",
      "a new part line without a purchase date is 400",
      missingDate.status === 400 && /তারিখ/.test(missingDate.body?.error ?? ""),
      JSON.stringify(missingDate.body)
    );

    const missingShop = await createService(page, {
      parts: [part({ supplier: "" })],
    });
    check(
      "L6",
      "a new part line without a shop is 400",
      missingShop.status === 400 &&
        /দোকান|সাপ্লায়ার/.test(missingShop.body?.error ?? ""),
      JSON.stringify(missingShop.body)
    );

    const missingPrice = await createService(page, {
      parts: [part({ price: "" })],
    });
    check(
      "L7",
      "a new part line without a price is 400",
      missingPrice.status === 400 && /দাম/.test(missingPrice.body?.error ?? ""),
      JSON.stringify(missingPrice.body)
    );

    const badQty = await createService(page, {
      parts: [part({ quantity: 0 })],
    });
    check(
      "L8",
      "a part line with quantity 0 is 400",
      badQty.status === 400,
      JSON.stringify(badQty.body)
    );

    const tooMany = await createService(page, {
      parts: Array.from({ length: 9 }, (_, i) =>
        part({ name: `Part ${i + 1}` })
      ),
    });
    check(
      "L9",
      "more than eight part lines on one device is 400",
      tooMany.status === 400 && /৮|8/.test(tooMany.body?.error ?? ""),
      JSON.stringify(tooMany.body)
    );

    /* ---------------- edit merge ---------------- */

    const editable = await createService(page, {
      parts: [part({ name: "Original part", price: 700, supplier: shop })],
    });
    const editableRow = await getService(page, editable.body.id);
    const editablePart = editableRow.parts[0];
    const merged = await put(page, `/api/services/${editable.body.id}`, {
      parts: [
        {
          id: editablePart.id,
          name: "Renamed part",
          quantity: 2,
          price: 800,
          // Blank supplier/date on an existing line must keep the old values.
          supplier: "",
          purchaseDate: "",
        },
      ],
    });
    const mergedRow = await getService(page, editable.body.id);
    const mergedPart = mergedRow.parts[0];
    check(
      "L10",
      "editing an existing part keeps omitted supplier/date and updates the name",
      merged.ok &&
        mergedPart.name === "Renamed part" &&
        mergedPart.quantity === 2 &&
        mergedPart.lineCost === 1600 &&
        mergedPart.supplier === shop &&
        mergedPart.purchaseDate === TODAY,
      JSON.stringify({ status: merged.status, part: mergedPart, error: merged.body?.error })
    );

    const clearTarget = await createService(page, {
      parts: [part({ name: "Removable part" })],
    });
    const cleared = await put(page, `/api/services/${clearTarget.body.id}`, {
      parts: [],
    });
    const clearedRow = await getService(page, clearTarget.body.id);
    check(
      "L11",
      "sending an empty list removes unpaid parts and clears the parts cost",
      cleared.ok && clearedRow.parts.length === 0 && clearedRow.partsCost === null,
      JSON.stringify({ status: cleared.status, parts: clearedRow.parts, cost: clearedRow.partsCost })
    );

    /* ---------------- legacy unknown-date rows ---------------- */

    if (!process.env.MAHER_DB_PATH) throw new Error("MAHER_DB_PATH missing");
    db = new Database(process.env.MAHER_DB_PATH);
    db.pragma("busy_timeout = 5000");

    const legacyOne = await createService(page, {
      parts: [part({ name: "Legacy one", price: 400 })],
    });
    const legacyTwo = await createService(page, {
      parts: [part({ name: "Legacy two", price: 600 })],
    });
    const legacyOnePart = (await getService(page, legacyOne.body.id)).parts[0];
    const legacyTwoPart = (await getService(page, legacyTwo.body.id)).parts[0];
    db.prepare("UPDATE ServicePart SET purchaseDate = NULL WHERE id = ?").run(
      legacyOnePart.id
    );
    db.prepare("UPDATE ServicePart SET purchaseDate = NULL WHERE id = ?").run(
      legacyTwoPart.id
    );

    const legacySummary = await api(
      page,
      `/api/service-parts?status=legacy&supplier=${encodeURIComponent(
        legacyOnePart.supplierKey
      )}`
    );
    check(
      "L12",
      "unknown-date lines are listed but excluded from the Paid/Unpaid totals",
      legacySummary.ok &&
        legacySummary.body.summary.legacyCount >= 1 &&
        legacySummary.body.summary.count === 0 &&
        legacySummary.body.summary.total === 0 &&
        legacySummary.body.rows.every((row) => row.purchaseDate === null),
      JSON.stringify(legacySummary.body?.summary)
    );

    const legacyPaidNoDate = await patch(
      page,
      `/api/service-parts/${legacyOnePart.id}`,
      { paid: true, note: "paid now" }
    );
    check(
      "L13",
      "marking an unknown-date line Paid without a date/confirmation is 409",
      legacyPaidNoDate.status === 409,
      String(legacyPaidNoDate.status)
    );

    const legacyPaidNoConfirm = await patch(
      page,
      `/api/service-parts/${legacyOnePart.id}`,
      { paid: true, purchaseDate: TODAY }
    );
    check(
      "L14",
      "a date alone is not enough — the legacy confirmation is required",
      legacyPaidNoConfirm.status === 409,
      String(legacyPaidNoConfirm.status)
    );

    const legacyPaid = await patch(
      page,
      `/api/service-parts/${legacyOnePart.id}`,
      {
        paid: true,
        purchaseDate: TODAY,
        confirmUnknownDate: true,
        note: "date confirmed",
      }
    );
    check(
      "L15",
      "a confirmed unknown-date line becomes Paid with a real purchase date",
      legacyPaid.ok &&
        !!legacyPaid.body.part.paidAt &&
        legacyPaid.body.part.purchaseDate === TODAY,
      JSON.stringify(legacyPaid.body)
    );

    const legacyDeleteBare = await del(
      page,
      `/api/service-parts/${legacyTwoPart.id}`
    );
    check(
      "L16",
      "deleting an unknown-date line without confirmation/reason is 409",
      legacyDeleteBare.status === 409,
      String(legacyDeleteBare.status)
    );

    const legacyDelete = await del(
      page,
      `/api/service-parts/${legacyTwoPart.id}`,
      { confirmUnknownDate: true, note: "entered by mistake" }
    );
    check(
      "L17",
      "a confirmed unknown-date line can be deleted with a reason",
      legacyDelete.ok,
      String(legacyDelete.status)
    );

    /* ---------------- paid flag + append-only history ---------------- */

    const paidTarget = await createService(page, {
      parts: [part({ name: "Paid target", price: 900, supplier: shop })],
    });
    const paidPart = (await getService(page, paidTarget.body.id)).parts[0];
    const paidOn = await patch(page, `/api/service-parts/${paidPart.id}`, {
      paid: true,
      note: "supplier settled",
    });
    check(
      "L18",
      "Paid sets the whole-line marker and appends a timestamped history note",
      paidOn.ok &&
        !!paidOn.body.part.paidAt &&
        /supplier settled/.test(paidOn.body.part.paidNote ?? "") &&
        /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(paidOn.body.part.paidNote ?? ""),
      JSON.stringify(paidOn.body)
    );

    const paidEdit = await put(page, `/api/services/${paidTarget.body.id}`, {
      parts: [
        {
          id: paidPart.id,
          name: "Paid target",
          quantity: 1,
          price: 950,
          supplier: shop,
          purchaseDate: TODAY,
        },
      ],
    });
    check(
      "L19",
      "changing a Paid line's money is 409 until it is marked Unpaid",
      paidEdit.status === 409,
      String(paidEdit.status)
    );

    const unpaidNoNote = await patch(page, `/api/service-parts/${paidPart.id}`, {
      paid: false,
    });
    check(
      "L20",
      "marking Paid back to Unpaid requires a reason",
      unpaidNoNote.status === 400 && /কারণ/.test(unpaidNoNote.body?.error ?? ""),
      JSON.stringify(unpaidNoNote.body)
    );

    const unpaid = await patch(page, `/api/service-parts/${paidPart.id}`, {
      paid: false,
      note: "supplier refunded",
    });
    check(
      "L21",
      "Unpaid clears the marker but keeps both history entries",
      unpaid.ok &&
        unpaid.body.part.paidAt === null &&
        /supplier settled/.test(unpaid.body.part.paidNote ?? "") &&
        /supplier refunded/.test(unpaid.body.part.paidNote ?? ""),
      JSON.stringify(unpaid.body)
    );

    const historyDelete = await del(
      page,
      `/api/service-parts/${paidPart.id}`
    );
    check(
      "L22",
      "a line with Paid history cannot be deleted",
      historyDelete.status === 409,
      String(historyDelete.status)
    );

    const stillPaidTarget = await createService(page, {
      parts: [part({ name: "Still paid" })],
    });
    const stillPaidPart = (await getService(page, stillPaidTarget.body.id)).parts[0];
    await patch(page, `/api/service-parts/${stillPaidPart.id}`, {
      paid: true,
      note: "settled",
    });
    const paidDelete = await del(
      page,
      `/api/service-parts/${stillPaidPart.id}`
    );
    check(
      "L23",
      "a currently Paid line cannot be deleted",
      paidDelete.status === 409,
      String(paidDelete.status)
    );

    const longNoteTarget = await createService(page, {
      parts: [part({ name: "Long note" })],
    });
    const longNotePart = (await getService(page, longNoteTarget.body.id)).parts[0];
    const longNote = await patch(
      page,
      `/api/service-parts/${longNotePart.id}`,
      { paid: true, note: "x".repeat(1001) }
    );
    check(
      "L24",
      "an over-long Paid note is rejected (400) instead of truncated",
      longNote.status === 400,
      String(longNote.status)
    );

    /* ---------------- returned jobs freeze parts ---------------- */

    const returned = await createService(page, {
      parts: [part({ name: "Returned part" })],
    });
    const returnedPart = (await getService(page, returned.body.id)).parts[0];
    const refund = await post(page, `/api/services/${returned.body.id}/refund`, {
      note: "customer changed mind",
    });
    const returnedEdit = await put(page, `/api/services/${returned.body.id}`, {
      parts: [],
    });
    check(
      "L25",
      "editing a returned job's parts is 409",
      refund.ok && returnedEdit.status === 409,
      JSON.stringify({ refund: refund.status, edit: returnedEdit.status })
    );

    const returnedPaid = await patch(
      page,
      `/api/service-parts/${returnedPart.id}`,
      { paid: true, note: "paid before return" }
    );
    check(
      "L26",
      "the Paid toggle is still allowed on a returned job",
      returnedPaid.ok,
      String(returnedPaid.status)
    );

    const returnedDelete = await del(
      page,
      `/api/service-parts/${returnedPart.id}`
    );
    check(
      "L27",
      "deleting a returned job's part line is 409",
      returnedDelete.status === 409,
      String(returnedDelete.status)
    );

    /* ---------------- coexistence with SERVICE_PART bills ---------------- */

    const withParts = await createService(page, {
      parts: [part({ name: "Coexist part" })],
    });
    const blockedPurchase = await post(page, "/api/purchases", {
      purchaseType: "SERVICE_PART",
      serviceId: withParts.body.id,
      supplier: uniqueName("BillShop"),
      purchaseDate: TODAY,
      paid: 0,
      items: [{ name: "Display", quantity: 1, unitCost: 1200 }],
    });
    check(
      "L28",
      "a SERVICE_PART bill is refused when the device already has part lines",
      blockedPurchase.status === 409,
      String(blockedPurchase.status)
    );

    const billFirst = await createService(page);
    const bill = await post(page, "/api/purchases", {
      purchaseType: "SERVICE_PART",
      serviceId: billFirst.body.id,
      supplier: uniqueName("BillFirst"),
      purchaseDate: TODAY,
      paid: 0,
      items: [{ name: "Display", quantity: 1, unitCost: 1200 }],
    });
    const partsAfterBill = await put(page, `/api/services/${billFirst.body.id}`, {
      parts: [part({ name: "Late part" })],
    });
    check(
      "L29",
      "adding part lines is refused when the device has a SERVICE_PART bill",
      bill.ok && partsAfterBill.status === 409,
      JSON.stringify({ bill: bill.status, parts: partsAfterBill.status })
    );

    /* ---------------- ledger summary + filters ---------------- */

    const allLedger = await api(page, "/api/service-parts?status=all");
    const paidLedger = await api(page, "/api/service-parts?status=paid");
    check(
      "L30",
      "the summary is identical across status tabs",
      allLedger.ok &&
        paidLedger.ok &&
        JSON.stringify(allLedger.body.summary) ===
          JSON.stringify(paidLedger.body.summary),
      JSON.stringify({
        all: allLedger.body?.summary,
        paid: paidLedger.body?.summary,
      })
    );

    const tomorrow = shiftDay(TODAY, 1);
    const future = await api(page, `/api/service-parts?from=${tomorrow}`);
    check(
      "L31",
      "a future date window excludes today's known-date money",
      future.ok &&
        future.body.summary.count === 0 &&
        future.body.summary.total === 0,
      JSON.stringify(future.body?.summary)
    );

    const knownSupplier = allLedger.body.rows.find(
      (row) => row.supplierKey && row.purchaseDate
    )?.supplierKey;
    const supplierLedger = knownSupplier
      ? await api(
          page,
          `/api/service-parts?supplier=${encodeURIComponent(knownSupplier)}`
        )
      : null;
    check(
      "L32",
      "the supplier filter narrows both rows and the summary",
      !!supplierLedger &&
        supplierLedger.ok &&
        supplierLedger.body.rows.length > 0 &&
        supplierLedger.body.rows.every(
          (row) => row.supplierKey === knownSupplier
        ) &&
        supplierLedger.body.summary.total > 0,
      JSON.stringify(supplierLedger?.body?.summary)
    );

    /* ---------------- bulk caps ---------------- */

    const tooManyIds = await post(page, "/api/service-parts/bulk", {
      ids: Array.from({ length: 101 }, (_, i) => i + 1),
      paid: true,
    });
    check(
      "L33",
      "a bulk change over 100 explicit ids is rejected",
      tooManyIds.status === 400 && /১০০|100/.test(tooManyIds.body?.error ?? ""),
      JSON.stringify(tooManyIds.body)
    );

    const bigSupplierKey = `bigsupplier-${Date.now()}`;
    const insert = db.prepare(
      `INSERT INTO ServicePart
         (serviceId, nameSnapshot, quantity, unitCost, lineCost, supplier, supplierKey, purchaseDate)
       VALUES (?, 'Bulk fixture', 1, 10, 10, 'Bulk Shop', ?, NULL)`
    );
    const insertAll = db.transaction(() => {
      for (let i = 0; i < 501; i += 1) insert.run(billFirst.body.id, bigSupplierKey);
    });
    insertAll();
    const tooManySupplier = await post(page, "/api/service-parts/bulk", {
      supplierKey: bigSupplierKey,
      paid: true,
      note: "bulk",
    });
    check(
      "L34",
      "a supplier-wide change over 500 rows is rejected as a whole",
      tooManySupplier.status === 400 &&
        /৫০০|500/.test(tooManySupplier.body?.error ?? ""),
      JSON.stringify(tooManySupplier.body)
    );

    /* ---------------- internal Excel parts sheet ---------------- */

    const excelPartName = uniqueName("ExcelPart");
    await createService(page, {
      parts: [part({ name: excelPartName, price: "*J#" })],
    });
    const xlsxRes = await fetch(`${BASE}/api/backup?format=xlsx`);
    const xlsxBuffer = Buffer.from(await xlsxRes.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer);
    const partsSheet = workbook.getWorksheet("সার্ভিস পার্টস");
    const summarySheet = workbook.getWorksheet("সারসংক্ষেপ");
    const summaryText = summarySheet
      ? []
          .concat(...summarySheet.getSheetValues())
          .filter((value) => typeof value === "string")
          .join(" | ")
      : "";
    let priceCodeCell = "";
    partsSheet?.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value === "*J#") priceCodeCell = String(cell.value);
      });
    });
    check(
      "L35",
      "the Excel backup has a separate internal parts sheet with the price code",
      xlsxRes.ok && !!partsSheet && priceCodeCell === "*J#" && !summaryText.includes(excelPartName),
      JSON.stringify({ status: xlsxRes.status, sheet: !!partsSheet })
    );

    /* ---------------- product code preservation ---------------- */

    const category = await post(page, "/api/product-categories", {
      name: uniqueName("KeepCat"),
    });
    const sku = `SKU-${Date.now()}`;
    const barcode = `BC-${Date.now()}`;
    const createdProduct = await post(page, "/api/products", {
      name: uniqueName("KeepProduct"),
      categoryId: category.body?.category?.id,
      sku,
      barcode,
      sellingPrice: 300,
      purchasePrice: 100,
      openingStock: 1,
      lowStockThreshold: 1,
    });
    const productId = createdProduct.body?.product?.id;
    const updateWithoutCodes = await put(page, `/api/products/${productId}`, {
      name: createdProduct.body?.product?.name,
      categoryId: category.body?.category?.id,
      sellingPrice: 320,
      purchasePrice: 110,
      lowStockThreshold: 1,
    });
    const afterProduct = productId
      ? (await api(page, `/api/products/${productId}`)).body?.product
      : null;
    check(
      "L36",
      "a product update that omits SKU/barcode keeps the stored values",
      updateWithoutCodes.ok &&
        afterProduct?.sku === sku &&
        afterProduct?.barcode === barcode,
      JSON.stringify({
        status: updateWithoutCodes.status,
        sku: afterProduct?.sku,
        barcode: afterProduct?.barcode,
        error: updateWithoutCodes.body?.error,
      })
    );

    console.log(results.join("\n"));
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    }
    await closeBrowser(browser);
  }
  if (failed) process.exitCode = 1;
})();
