/* New-entry and Edit must walk the shopkeeper through the SAME field order.
 *
 * Regression: the edit form used a second, flat layout (model/technician,
 * problem, IMEI, bill, advance, due, status) followed by an empty device card
 * and a parts section parked at the very bottom. It also rendered eight
 * duplicate svc-* ids, so labels/tab order pointed at the wrong input.
 */
const {
  api,
  clickDailyRowButton,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const CUSTOMER = uniqueName("OrderCustomer");
const EXPECTED = [
  "svc-name",
  "svc-phone",
  "svc-address",
  "svc-condition",
  "svc-tech",
  "form-more",
  "svc-model",
  "svc-problem",
  "svc-bill",
  "svc-delivery-date",
  "svc-imei",
  "device-warranty-0",
  "svc-parts",
  "svc-total-bill",
  "svc-adv",
  "svc-due",
];
const PART_NAMES = ["First ordered part", "Second ordered part", "Third ordered part"];

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

function visibleOrder(ids) {
  return ids
    .map((id) => {
      const el =
        document.getElementById(id) ||
        document.querySelector(`[data-testid="${id}"]`);
      if (!el) return null;
      const box = el.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return null;
      return { id, top: Math.round(box.top), left: Math.round(box.left) };
    })
    .filter(Boolean)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((x) => x.id);
}

function duplicateIds() {
  const seen = {};
  for (const el of document.querySelectorAll("[id]")) {
    seen[el.id] = (seen[el.id] || 0) + 1;
  }
  return Object.entries(seen)
    .filter(([id, n]) => n > 1 && /^svc-/.test(id))
    .map(([id]) => id);
}

function partNames() {
  return [...document.querySelectorAll('[data-testid="svc-parts-row-0"], [data-testid^="svc-parts-row-"]')]
    .map((row) => row.querySelector('input[id^="svc-parts-name-"]')?.value ?? "")
    .filter(Boolean);
}

function partRows() {
  return [...document.querySelectorAll('[data-testid^="svc-parts-row-"]')].map(
    (row) => ({
      name: row.querySelector('input[id^="svc-parts-name-"]')?.value ?? "",
      qty: row.querySelector('input[id^="svc-parts-qty-"]')?.value ?? "",
      damaged:
        row.querySelector('input[data-testid^="svc-parts-damage-"]')?.checked ??
        null,
      damageDisabled:
        row.querySelector('input[data-testid^="svc-parts-damage-"]')?.disabled ??
        null,
      split: !!row.querySelector('[data-testid^="svc-parts-split-"]'),
    })
  );
}

function partsTotalText() {
  const spans = document.querySelectorAll('[data-testid="svc-parts"] span');
  const total = [...spans].find((el) =>
    (el.textContent || "").trim().startsWith("মোট")
  );
  return (total?.textContent || "").trim();
}

/** The saved row must be edited in the SAME structure it was entered in:
 *  a numbered device card inside ডিভাইসের তথ্য, the same field labels, and a
 *  populated visit-bill preview. No second flat layout, no form-internal. */
function structure() {
  const more = document.querySelector('[data-testid="form-more"]');
  const parts = document.querySelector('[data-testid="svc-parts"]');
  const billLabel = document.querySelector('label[for="svc-bill"]');
  const total = document.getElementById("svc-total-bill");
  return {
    hasFormMore: !!more,
    formMoreTitle: more?.querySelector("summary")?.textContent.trim() || "",
    billLabel: billLabel?.textContent.trim() || "",
    totalBill: total ? String(total.value) : "",
    totalReadOnly: total ? !!total.readOnly : false,
    hasFormInternal: !!document.querySelector('[data-testid="form-internal"]'),
    partsInsideFormMore: !!(more && parts && more.contains(parts)),
    deviceCards: document.querySelectorAll('[data-testid="device-1"]').length,
  };
}

/** Decluttered copy contract: every label/placeholder below must stay clean.
 *  The surrounding DOM and testids are deliberately not part of this check. */
function formCopy() {
  const text = (el) => (el?.textContent || "").trim();
  const attr = (el, name) => el?.getAttribute(name) || "";
  const parts = document.querySelector('[data-testid="svc-parts"]');
  const formText = text(document.querySelector("form"));
  return {
    addressLabel: text(document.querySelector('label[for="svc-address"]')),
    conditionLabel: text(
      document.querySelector('[data-testid="form-condition"] summary')
    ),
    warrantyLabel: text(
      document.querySelector('label[for="device-warranty-0"]')
    ),
    partsLabel: text(parts?.querySelector('[aria-expanded] span')),
    billLabel: text(document.querySelector('label[for="svc-bill"]')),
    modelPlaceholder: attr(document.querySelector("#svc-model"), "placeholder"),
    problemPlaceholder: attr(document.querySelector("#svc-problem"), "placeholder"),
    warrantyPlaceholder: attr(
      document.querySelector('[data-testid="device-warranty-0"]'),
      "placeholder"
    ),
    billPlaceholder: attr(document.querySelector("#svc-bill"), "placeholder"),
    imeiPlaceholder: attr(
      document.querySelector('[data-testid="device-imei-0"]'),
      "placeholder"
    ),
    // Every input/textarea inside the entry form must be pristine: no gray
    // dummy preview text may sit inside a box that already has a clear label.
    nonEmptyPlaceholders: [
      ...document.querySelectorAll(
        "form input[placeholder], form textarea[placeholder]"
      ),
    ]
      .filter((el) => (el.getAttribute("placeholder") || "") !== "")
      .map((el) => ({
        id: el.id || el.getAttribute("data-testid") || el.name || el.type,
        placeholder: el.getAttribute("placeholder"),
      })),
    hasOptionalTag: formText.includes("ঐচ্ছিক"),
    hasPartsHelper: formText.includes("এখনো কোনো পার্টস"),
  };
}

(async () => {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const errors = trackErrors(page);

    await page.goto(`${BASE}/service`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="daily-services"]', { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));

    const newOrder = await page.evaluate(visibleOrder, EXPECTED);
    const newStructure = await page.evaluate(structure);
    const newCopy = await page.evaluate(formCopy);

    const roster = await api(page, "/api/technicians");
    if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
      await api(page, "/api/technicians", { method: "POST", body: JSON.stringify({ name: "NURUL" }) });
    }
    const created = await api(page, "/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: CUSTOMER,
        phone: `01${String(Date.now()).slice(-9)}`,
        model: "Order Model",
        technician: "NURUL",
        problem: "Order problem",
        totalBill: 3000,
        advance: 1000,
        status: "In-Progress",
        serviceDate: TODAY,
        parts: PART_NAMES.map((name, i) => ({
          name,
          quantity: i === 0 ? 2 : 1,
          price: 1000 + i,
          supplier: "Order Shop",
          purchaseDate: TODAY,
        })),
      }),
    });
    if (!created.ok) throw new Error("create failed: " + JSON.stringify(created.body));

    await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForSelector('[data-testid="daily-services"]', { timeout: 30000 });
    await clickDailyRowButton(page, CUSTOMER, "এডিট");
    await page.waitForSelector("#svc-model", { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 400));

    const editOrder = await page.evaluate(visibleOrder, EXPECTED);
    const editStructure = await page.evaluate(structure);
    const dupes = await page.evaluate(duplicateIds);
    const savedPartNames = await page.evaluate(partNames);

    // In Edit both money inputs write the same saved bill: the device card and
    // the visit summary must stay in sync whichever one the shopkeeper uses.
    await typeInto(page, "svc-bill", "3500");
    const syncedFromDevice = await page.evaluate(() => ({
      total: String(document.querySelector("#svc-total-bill")?.value ?? ""),
      due: String(document.querySelector("#svc-due")?.value ?? ""),
    }));
    await typeInto(page, "svc-total-bill", "3700");
    const syncedFromSummary = await page.evaluate(() => ({
      bill: String(document.querySelector("#svc-bill")?.value ?? ""),
      total: String(document.querySelector("#svc-total-bill")?.value ?? ""),
      due: String(document.querySelector("#svc-due")?.value ?? ""),
    }));

    check(
      "O1",
      "edit form keeps the new-entry field sequence",
      JSON.stringify(newOrder) === JSON.stringify(editOrder),
      `new=${newOrder.join(",")} | edit=${editOrder.join(",")}`
    );
    check(
      "O2",
      "edit form has no duplicate svc-* ids",
      dupes.length === 0,
      dupes.join(",")
    );
    check(
      "O3",
      "saved part rows keep their entry order",
      JSON.stringify(savedPartNames) === JSON.stringify(PART_NAMES),
      savedPartNames.join(",")
    );
    check(
      "O4",
      "edit uses the same device structure as new entry",
      editStructure.hasFormMore &&
        editStructure.formMoreTitle === newStructure.formMoreTitle &&
        editStructure.billLabel === newStructure.billLabel &&
        !editStructure.hasFormInternal &&
        editStructure.partsInsideFormMore &&
        editStructure.deviceCards === newStructure.deviceCards,
      `new=${JSON.stringify(newStructure)} | edit=${JSON.stringify(editStructure)}`
    );
    check(
      "O5",
      "edit shows the saved bill in the visit-bill preview",
      editStructure.totalBill === "3000",
      `edit=${editStructure.totalBill}`
    );
    check(
      "O6",
      "edit lets either money input change the bill and keeps both in sync",
      !editStructure.totalReadOnly &&
        syncedFromDevice.total === "3500" &&
        syncedFromDevice.due === "2,500" &&
        syncedFromSummary.bill === "3700" &&
        syncedFromSummary.total === "3700" &&
        syncedFromSummary.due === "2,700",
      `readOnly=${editStructure.totalReadOnly} | device=${JSON.stringify(syncedFromDevice)} | summary=${JSON.stringify(syncedFromSummary)}`
    );
    // A 2-unit part must be splittable into two single-unit lines so only the
    // damaged unit is charged to the shop's loss; the visit's part cost stays
    // exactly the same (2×1,000 = 1,000 + 1,000).
    const beforeSplit = await page.evaluate(partRows);
    const totalBefore = await page.evaluate(partsTotalText);
    const splitOffered = beforeSplit.filter((row) => row.split).length;
    if (splitOffered > 0) {
      await page.click('[data-testid="svc-parts-split-0"]');
      await new Promise((r) => setTimeout(r, 250));
    }
    const afterSplit = await page.evaluate(partRows);
    const totalAfter = await page.evaluate(partsTotalText);
    if (afterSplit.length === 4) {
      await page.click('[data-testid="svc-parts-damage-0"]');
      await new Promise((r) => setTimeout(r, 150));
    }
    const afterDamage = await page.evaluate(partRows);
    await submitButton(page, "আপডেট করুন");
    await waitDailyRow(page, CUSTOMER, true);
    const saved = (await api(page, `/api/services/${created.body.id}`)).body;
    const savedParts = saved.parts ?? [];
    const damagedRows = savedParts.filter((part) => part.partStatus === "DAMAGED");

    check(
      "O7",
      "a 2-unit part splits into single lines so one damaged unit costs one price",
      splitOffered === 1 &&
        beforeSplit.length === 3 &&
        beforeSplit[0]?.qty === "2" &&
        totalBefore === "মোট ৳4,003" &&
        afterSplit.length === 4 &&
        afterSplit[0]?.qty === "1" &&
        afterSplit[1]?.qty === "1" &&
        afterSplit[0]?.name === PART_NAMES[0] &&
        afterSplit[1]?.name === PART_NAMES[0] &&
        totalAfter === totalBefore &&
        afterDamage[0]?.damaged === true &&
        afterDamage[1]?.damaged === false &&
        savedParts.length === 4 &&
        damagedRows.length === 1 &&
        damagedRows[0]?.quantity === 1 &&
        saved.partsCost === 3003 &&
        saved.damageLoss === 1000,
      JSON.stringify({
        beforeSplit,
        totalBefore,
        splitOffered,
        afterSplit,
        totalAfter,
        afterDamage: afterDamage.map((r) => r.damaged),
        saved: {
          parts: savedParts.map((p) => ({
            name: p.name,
            qty: p.quantity,
            status: p.partStatus,
          })),
          partsCost: saved.partsCost,
          damageLoss: saved.damageLoss,
        },
      })
    );
    check(
      "O6b",
      "an edit typed into the visit summary saves as the device bill",
      saved.totalBill === 3700 && saved.due === 2700,
      JSON.stringify({
        totalBill: saved.totalBill,
        advance: saved.advance,
        due: saved.due,
      })
    );
    check(
      "O8",
      "a saved part's damage toggle is locked; only the new split line can be marked",
      beforeSplit[0]?.damageDisabled === true &&
        afterSplit[0]?.damageDisabled === false &&
        afterSplit[1]?.damageDisabled === true,
      JSON.stringify({
        savedRow: beforeSplit[0],
        splitRow: afterSplit[0],
        remainingSavedRow: afterSplit[1],
      })
    );
    check(
      "O9",
      "entry form copy is decluttered (empty placeholders, no optional tags, dummy examples or parts helper)",
      newCopy.addressLabel === "কাস্টমারের ঠিকানা" &&
        newCopy.conditionLabel === "কাস্টমারের শর্ত" &&
        newCopy.warrantyLabel === "ওয়ারেন্টির মেয়াদ" &&
        newCopy.partsLabel === "পার্টস" &&
        newCopy.billLabel === "ডিভাইস বিল (৳)" &&
        newCopy.modelPlaceholder === "" &&
        newCopy.problemPlaceholder === "" &&
        newCopy.warrantyPlaceholder === "" &&
        newCopy.billPlaceholder === "" &&
        newCopy.imeiPlaceholder === "" &&
        newCopy.nonEmptyPlaceholders.length === 0 &&
        !newCopy.hasOptionalTag &&
        !newCopy.hasPartsHelper,
      JSON.stringify(newCopy)
    );
    check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check("FATAL", "suite completed", false, e && e.message ? e.message : String(e));
  } finally {
    for (const line of results) console.log(line);
    await closeBrowser(browser);
    if (failed) process.exitCode = 1;
  }
})();
