/* Optional customer address (visit) + device warranty (row) end-to-end.
 *
 * Runs only on the throwaway DB supplied by scripts/run-tests.js. Covers:
 *   1. optional TEXT columns exist
 *   2. single create/edit/clear stores both fields
 *   3. 200/100-char boundaries and validation messages
 *   4. grouped visit: shared address, per-device warranty, product anchor
 *   5. entry form controls, warranty chips and a real UI save
 *   6. edit form restores both values
 *   7. header/global search matches both fields
 *   8. in-list search matches both fields
 *   9. single receipt prints both, and omits empty labels
 *  10. group receipt prints the address once and every device warranty
 *  11. an old snapshot without the new columns still restores (NULL)
 */
const path = require("node:path");
const Database = require("better-sqlite3");
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
const BACKUP_DIR = process.env.MAHER_BACKUP_DIR;

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function basePayload(name, model, overrides = {}) {
  return {
    customerName: name,
    phone: `01${String(Date.now()).slice(-9)}`,
    technician: "NURUL",
    model,
    problem: "Address warranty probe",
    totalBill: 500,
    advance: 0,
    status: "In-Progress",
    serviceDate: TODAY,
    ...overrides,
  };
}

async function addRoster(page) {
  const roster = await api(page, "/api/technicians");
  if (!roster.body.technicians?.some((t) => t.name === "NURUL")) {
    const added = await post(page, "/api/technicians", { name: "NURUL" });
    if (!added.ok) throw new Error("NURUL setup failed");
  }
}

async function reloadList(page) {
  await page.reload({ waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector('[data-testid="daily-services"]', {
    timeout: 30000,
  });
}

async function openReceiptFor(page, name) {
  return page.evaluate((rowName) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    if (!section) return false;
    const rows = [
      ...section.querySelectorAll("tbody tr"),
      ...section.querySelectorAll('[data-testid^="service-card-"]'),
    ];
    const row = rows.find(
      (r) =>
        r.getAttribute("data-customer") === rowName ||
        (r.textContent || "").includes(rowName)
    );
    const button = row?.querySelector("button[title='বিল প্রিন্ট']");
    if (!button) return false;
    button.click();
    return true;
  }, name);
}

async function closeReceipt(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), {
    polling: 200,
    timeout: 8000,
  });
}

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  // The shop desk's real viewport must keep working with the two new fields.
  await page.setViewport({ width: 1366, height: 768 });
  const errors = trackErrors(page);

  await page.goto(`${BASE}/service`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 500, timeout: 30000 }
  );
  await addRoster(page);

  if (!process.env.MAHER_DB_PATH) throw new Error("MAHER_DB_PATH missing");
  const db = new Database(process.env.MAHER_DB_PATH, { readonly: true });

  /* ---------- AW1: schema ---------- */
  const cols = db.prepare("PRAGMA table_info(Service)").all();
  const addressCol = cols.find((c) => c.name === "customerAddress");
  const warrantyCol = cols.find((c) => c.name === "warranty");
  check(
    "AW1",
    "Service.customerAddress and Service.warranty are optional TEXT columns",
    addressCol?.type === "TEXT" &&
      addressCol?.notnull === 0 &&
      warrantyCol?.type === "TEXT" &&
      warrantyCol?.notnull === 0,
    JSON.stringify({ addressCol, warrantyCol })
  );

  /* ---------- AW2: single create / edit / clear ---------- */
  const SINGLE = uniqueName("AwSingle");
  const ADDRESS = "নিলন্দু রোড, আশুলিয়া";
  const WARRANTY = "7 দিন";
  // Read back through the app's own API after EACH step: the throwaway DB is
  // in WAL mode, so a long-lived external read handle can show a stale snapshot.
  const stored = async () =>
    (await api(page, `/api/services/${created.body.id}`)).body;
  const created = await post(
    page,
    "/api/services",
    basePayload(SINGLE, "Aw Model", {
      customerAddress: ADDRESS,
      warranty: WARRANTY,
    })
  );
  const createdRow = created.ok ? await stored() : null;
  const edited = await put(page, `/api/services/${created.body.id}`, {
    customerAddress: "গ্রাম/রোড, এলাকা/থানা",
    warranty: "1 মাস",
  });
  const editedRow = edited.ok ? await stored() : null;
  const cleared = await put(page, `/api/services/${created.body.id}`, {
    customerAddress: "",
    warranty: "",
  });
  const clearedRow = cleared.ok ? await stored() : null;
  check(
    "AW2",
    "single create saves both fields; edit replaces them and blank clears to NULL",
    created.ok &&
      created.body.customerAddress === ADDRESS &&
      created.body.warranty === WARRANTY &&
      createdRow?.customerAddress === ADDRESS &&
      createdRow?.warranty === WARRANTY &&
      edited.body.customerAddress === "গ্রাম/রোড, এলাকা/থানা" &&
      edited.body.warranty === "1 মাস" &&
      editedRow?.warranty === "1 মাস" &&
      cleared.body.customerAddress === null &&
      cleared.body.warranty === null &&
      clearedRow?.customerAddress === null &&
      clearedRow?.warranty === null,
    JSON.stringify({
      status: created.status,
      responseCreated: [created.body.customerAddress, created.body.warranty],
      responseEdited: [edited.body.customerAddress, edited.body.warranty],
      created: [createdRow?.customerAddress, createdRow?.warranty],
      edited: [editedRow?.customerAddress, editedRow?.warranty],
      cleared: [clearedRow?.customerAddress, clearedRow?.warranty],
    })
  );

  /* ---------- AW3: length boundaries ---------- */
  const maxAddress = "ঠ".repeat(200);
  const maxWarranty = "মা".repeat(50);
  const atLimit = await post(
    page,
    "/api/services",
    basePayload(uniqueName("AwMax"), "Aw Max", {
      customerAddress: maxAddress,
      warranty: maxWarranty,
    })
  );
  const overAddress = await post(
    page,
    "/api/services",
    basePayload(uniqueName("AwLongAddr"), "Aw Long", {
      customerAddress: "ঠ".repeat(201),
    })
  );
  const overWarranty = await post(
    page,
    "/api/services",
    basePayload(uniqueName("AwLongWarranty"), "Aw Long", {
      warranty: "মা".repeat(51),
    })
  );
  const overEdit = await put(page, `/api/services/${created.body.id}`, {
    customerAddress: "ঠ".repeat(201),
  });
  check(
    "AW3",
    "200/100 chars accepted; 201/101 rejected on create and edit",
    atLimit.ok &&
      (atLimit.body.customerAddress || "").length === 200 &&
      (atLimit.body.warranty || "").length === 100 &&
      overAddress.status === 400 &&
      overWarranty.status === 400 &&
      overEdit.status === 400 &&
      String(overAddress.body.error || "").includes("বেশি") &&
      String(overWarranty.body.error || "").includes("বেশি"),
    JSON.stringify({
      atLimit: atLimit.status,
      overAddress: overAddress.status,
      overWarranty: overWarranty.status,
      overEdit: overEdit.status,
    })
  );

  /* ---------- AW4: group visit + product anchor ---------- */
  const GROUP = uniqueName("AwGroup");
  const GROUP_ADDRESS = `GroupRoad${Date.now()}`;
  const group = await post(page, "/api/services/batch", {
    customerName: GROUP,
    phone: `01${String(Date.now()).slice(-8)}`,
    technician: "NURUL",
    serviceDate: TODAY,
    customerAddress: GROUP_ADDRESS,
    devices: [
      {
        model: "Aw Group A",
        problem: "প্রথম",
        totalBill: 200,
        warranty: "7 দিন",
      },
      {
        model: "Aw Group B",
        problem: "দ্বিতীয়",
        totalBill: 300,
        warranty: "1 মাস",
      },
    ],
    products: [
      { name: `Aw Product${Date.now()}`, quantity: 1, unitPrice: 100 },
    ],
  });
  const groupDevices = (group.body.services || [])
    .filter((s) => s.entryKind === "DEVICE")
    .sort((a, b) => a.id - b.id);
  const groupAnchor = (group.body.services || []).find(
    (s) => s.entryKind === "PRODUCT"
  );
  check(
    "AW4",
    "grouped visit shares the address, keeps per-device warranty and stamps the product anchor",
    group.ok &&
      groupDevices.length === 2 &&
      groupDevices.every((r) => r.customerAddress === GROUP_ADDRESS) &&
      groupDevices[0].warranty === "7 দিন" &&
      groupDevices[1].warranty === "1 মাস" &&
      groupAnchor?.customerAddress === GROUP_ADDRESS,
    JSON.stringify({
      status: group.status,
      devices: groupDevices.map((r) => [r.customerAddress, r.warranty]),
      anchor: groupAnchor?.customerAddress,
    })
  );

  /* ---------- AW5: form controls, chips and a real UI save ---------- */
  // This row is made through the API so the search/receipt checks below keep
  // testing real data even while the form is still missing its new controls.
  const SEARCH_NAME = uniqueName("AwSearch");
  const SEARCH_ADDRESS = `SearchRoad${Date.now()}`;
  const SEARCH_WARRANTY = `SearchWarranty${Date.now()}`;
  const searchRow = await post(
    page,
    "/api/services",
    basePayload(SEARCH_NAME, "Aw Search Model", {
      customerAddress: SEARCH_ADDRESS,
      warranty: SEARCH_WARRANTY,
    })
  );

  await reloadList(page);
  const formShape = await page.evaluate(() => {
    const address = document.getElementById("svc-address");
    const warranty = document.getElementById("device-warranty-0");
    const chips = [
      ...document.querySelectorAll(
        '[data-testid^="device-warranty-chip-0-"]'
      ),
    ].map((b) => (b.textContent || "").trim());
    return {
      addressPlaceholder: address?.getAttribute("placeholder") || "",
      addressLabel: document.querySelector('label[for="svc-address"]')
        ?.textContent.trim(),
      warrantyLabel: document.querySelector('label[for="device-warranty-0"]')
        ?.textContent.trim(),
      chips,
      hasWarranty: !!warranty,
    };
  });
  const UI_NAME = uniqueName("AwUi");
  const UI_ADDRESS = `UiRoad${Date.now()}`;
  const UI_WARRANTY = `UiWarranty${Date.now()}`;
  const uiControlsReady =
    !!(await page.$("#svc-address")) && !!(await page.$("#device-warranty-0"));
  let chipValue = "";
  let uiSaved = null;
  if (uiControlsReady) {
    await typeInto(page, "svc-name", UI_NAME);
    await typeInto(page, "svc-phone", "01712345678");
    await typeInto(page, "svc-address", UI_ADDRESS);
    await typeInto(page, "svc-model", "Aw Ui Model");
    await typeInto(page, "svc-problem", "Ui problem");
    await typeInto(page, "svc-bill", "700");
    await page.click("#svc-tech");
    await page.waitForSelector('[role="option"]', {
      polling: 500,
      timeout: 5000,
    });
    await page.evaluate(() => {
      [...document.querySelectorAll('[role="option"]')]
        .find((o) => o.textContent.trim() === "NURUL")
        .click();
    });
    await page.keyboard.press("Escape");
    await sleep(150);
    await page.evaluate(() => {
      const chip = [
        ...document.querySelectorAll('[data-testid^="device-warranty-chip-0-"]'),
      ].find((b) => (b.textContent || "").trim() === "৭ দিন");
      if (!chip) throw new Error("৭ দিন chip missing");
      chip.click();
    });
    chipValue = await page.$eval("#device-warranty-0", (el) => el.value);
    await typeInto(page, "device-warranty-0", UI_WARRANTY);
    await submitButton(page, "সেভ করুন");
    await waitDailyRow(page, UI_NAME, true);
    uiSaved = (
      await api(page, `/api/services/search?q=${encodeURIComponent(UI_NAME)}`)
    ).body.services?.find((s) => s.customerName === UI_NAME);
  }
  check(
    "AW5",
    "form has both inputs with a clean empty address placeholder and warranty chips; a chip fills the input and a UI save persists both fields",
    uiControlsReady &&
      formShape.addressPlaceholder === "" &&
      formShape.addressLabel === "কাস্টমারের ঠিকানা" &&
      formShape.warrantyLabel === "ওয়ারেন্টির মেয়াদ" &&
      JSON.stringify(formShape.chips) ===
        JSON.stringify(["নেই", "৭ দিন", "১৫ দিন", "১ মাস", "৩ মাস", "৬ মাস"]) &&
      chipValue === "7 দিন" &&
      uiSaved?.customerAddress === UI_ADDRESS &&
      uiSaved?.warranty === UI_WARRANTY,
    JSON.stringify({ formShape, chipValue, saved: [uiSaved?.customerAddress, uiSaved?.warranty] })
  );

  /* ---------- AW6: edit form restores both values ---------- */
  await clickDailyRowButton(page, SEARCH_NAME, "এডিট");
  const editFormReady = !!(await page
    .waitForSelector("#svc-address", { timeout: 5000 })
    .catch(() => null));
  const editValues = editFormReady
    ? await page.evaluate(() => ({
        address: document.getElementById("svc-address")?.value,
        warranty: document.getElementById("svc-warranty")?.value,
      }))
    : {};
  const cancelClicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => (b.textContent || "").trim() === "বাতিল"
    );
    if (!button) return false;
    button.click();
    return true;
  });
  if (editFormReady) {
    await page
      .waitForFunction(() => !document.getElementById("svc-address"), {
        polling: 200,
        timeout: 8000,
      })
      .catch(() => null);
  }
  check(
    "AW6",
    "edit form preloads the saved address and warranty",
    editFormReady &&
      editValues.address === SEARCH_ADDRESS &&
      editValues.warranty === SEARCH_WARRANTY &&
      cancelClicked,
    JSON.stringify({ editValues, cancelClicked })
  );

  /* ---------- AW7: header/global search ---------- */
  const byAddress = await api(
    page,
    `/api/services/search?q=${encodeURIComponent(SEARCH_ADDRESS)}`
  );
  const byWarranty = await api(
    page,
    `/api/services/search?q=${encodeURIComponent(SEARCH_WARRANTY)}`
  );
  const searchPlaceholder = await page.$eval("#global-search", (el) =>
    el.getAttribute("placeholder")
  );
  check(
    "AW7",
    "header search matches address and warranty text",
    searchPlaceholder === "🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)" &&
      byAddress.ok &&
      byWarranty.ok &&
      (byAddress.body.services || []).some((s) => s.id === searchRow.body.id) &&
      (byWarranty.body.services || []).some((s) => s.id === searchRow.body.id),
    JSON.stringify({
      placeholder: searchPlaceholder,
      byAddress: byAddress.body.count,
      byWarranty: byWarranty.body.count,
    })
  );

  /* ---------- AW8: in-list search ---------- */
  const waitListMatch = (needle) =>
    page.waitForFunction(
      (selector, name, text) => {
        const rows = [
          ...document.querySelectorAll(`${selector} tbody tr`),
        ].map((tr) => tr.textContent || "");
        return rows.some((line) => line.includes(name) && line.includes(text));
      },
      { polling: 500, timeout: 10000 },
      '[data-testid="daily-services"]',
      SEARCH_NAME,
      needle
    );
  await reloadList(page);
  await typeInto(page, "svc-search", SEARCH_ADDRESS);
  const listByAddress = await waitListMatch(SEARCH_ADDRESS).then(
    () => true,
    () => false
  );
  await typeInto(page, "svc-search", SEARCH_WARRANTY);
  const listByWarranty = await waitListMatch(SEARCH_WARRANTY).then(
    () => true,
    () => false
  );
  await typeInto(page, "svc-search", "");
  check(
    "AW8",
    "in-list search matches address and warranty text",
    listByAddress && listByWarranty,
    JSON.stringify({ listByAddress, listByWarranty })
  );

  /* ---------- AW9: single receipt prints both, skips empty labels ---------- */
  await reloadList(page);
  await waitDailyRow(page, SEARCH_NAME, true);
  const singleOpened = await openReceiptFor(page, SEARCH_NAME);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(400);
  const singleReceipt = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      address: dialog?.querySelector('[data-testid="receipt-customer-address"]')?.textContent || "",
      warranty: dialog?.querySelector('[data-testid="receipt-warranty"]')?.textContent || "",
    };
  });
  check(
    "AW9a",
    "single receipt prints customer address and device warranty",
    singleOpened &&
      singleReceipt.address.includes(SEARCH_ADDRESS) &&
      singleReceipt.warranty.includes(SEARCH_WARRANTY),
    JSON.stringify(singleReceipt)
  );
  await closeReceipt(page);

  const PLAIN = uniqueName("AwPlain");
  await post(page, "/api/services", basePayload(PLAIN, "Aw Plain"));
  await reloadList(page);
  await waitDailyRow(page, PLAIN, true);
  const plainOpened = await openReceiptFor(page, PLAIN);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(300);
  const plainReceipt = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      address: dialog?.querySelectorAll('[data-testid="receipt-customer-address"]').length ?? -1,
      warranty: dialog?.querySelectorAll('[data-testid="receipt-warranty"]').length ?? -1,
    };
  });
  check(
    "AW9b",
    "single receipt leaves no empty address/warranty labels",
    plainOpened && plainReceipt.address === 0 && plainReceipt.warranty === 0,
    JSON.stringify(plainReceipt)
  );
  await closeReceipt(page);

  /* ---------- AW10: group receipt ---------- */
  await reloadList(page);
  await waitDailyRow(page, GROUP, true);
  const groupOpened = await openReceiptFor(page, GROUP);
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await page.waitForFunction(
    () => (document.body.textContent || "").includes("একসাথে সব ডিভাইসের বিল"),
    { polling: 300, timeout: 10000 }
  );
  await sleep(400);
  const groupReceipt = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      address: [...(dialog?.querySelectorAll('[data-testid="receipt-customer-address"]') || [])].map(
        (n) => n.textContent || ""
      ),
      warranties: [...(dialog?.querySelectorAll('[data-testid^="receipt-warranty-"]') || [])].map(
        (n) => n.textContent || ""
      ),
    };
  });
  check(
    "AW10",
    "group receipt prints the shared address once and each device warranty",
    groupOpened &&
      groupReceipt.address.length === 1 &&
      groupReceipt.address[0].includes(GROUP_ADDRESS) &&
      groupReceipt.warranties.some((t) => t.includes("7 দিন")) &&
      groupReceipt.warranties.some((t) => t.includes("1 মাস")),
    JSON.stringify(groupReceipt)
  );
  await closeReceipt(page);

  /* ---------- AW11: old snapshot restore ---------- */
  if (!BACKUP_DIR) throw new Error("MAHER_BACKUP_DIR is required");
  const oldName = "maher-20000103-000000-001.db";
  const oldAbs = path.join(BACKUP_DIR, oldName);
  const OLD_ID = 4343;
  const oldDb = new Database(oldAbs);
  try {
    oldDb.exec(
      `CREATE TABLE Service (
         id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
         customerName TEXT NOT NULL, phone TEXT NOT NULL, model TEXT NOT NULL,
         technician TEXT NOT NULL, problem TEXT NOT NULL,
         totalBill INTEGER NOT NULL DEFAULT 0, advance INTEGER NOT NULL DEFAULT 0,
         due INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'Pending',
         shopExpense TEXT, expenseAmount INTEGER NOT NULL DEFAULT 0,
         serviceDate DATETIME NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
         createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL)`
    );
    oldDb
      .prepare(
        `INSERT INTO Service (id, customerName, phone, model, technician,
           problem, totalBill, advance, due, status, shopExpense,
           expenseAmount, serviceDate, archived, createdAt, updatedAt)
         VALUES (?, 'OldAddressRow', '01000000767', 'M', 'NURUL', 'p',
                 100, 0, 100, 'Pending', '', 0, ?, 0, ?, ?)`
      )
      .run(
        OLD_ID,
        `${TODAY}T06:00:00.000Z`,
        `${TODAY}T06:00:00.000Z`,
        `${TODAY}T06:00:00.000Z`
      );
  } finally {
    oldDb.close();
  }
  const restored = await post(page, "/api/backup/restore", { file: oldName });
  const afterRestore = await api(page, `/api/services?date=${TODAY}`);
  const oldRow = (afterRestore.body.services || []).find(
    (s) => s.id === OLD_ID
  );
  check(
    "AW11",
    "old snapshot without the new columns restores safely (both NULL)",
    restored.ok &&
      !!oldRow &&
      oldRow.customerName === "OldAddressRow" &&
      oldRow.customerAddress === null &&
      oldRow.warranty === null,
    JSON.stringify({
      status: restored.status,
      error: restored.body.error,
      customerAddress: oldRow?.customerAddress,
      warranty: oldRow?.warranty,
    })
  );
  db.close();

  const unexpectedErrors = errors.filter(
    (e) => !/Failed to load resource.*400 \(Bad Request\)/.test(e)
  );
  check(
    "Z",
    "zero unexpected JS errors",
    unexpectedErrors.length === 0,
    unexpectedErrors.slice(0, 3).join(" | ")
  );

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("ADDRESS-WARRANTY CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
