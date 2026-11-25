/* Lane J — service-part purchase ledger (TDD red phase).
 * Runs on the throwaway DB supplied by scripts/run-tests.js.
 */
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

async function post(page, path, body) {
  return api(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

(async () => {
  let browser = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });

    const roster = (await api(page, "/api/technicians")).body;
    if (!roster.technicians?.some((t) => t.name === "NURUL")) {
      await post(page, "/api/technicians", { name: "NURUL" });
    }

    const service = await post(page, "/api/services", {
      customerName: uniqueName("PartCustomer"),
      phone: `01${String(Date.now()).slice(-9)}`,
      model: "Samsung A20",
      technician: "NURUL",
      problem: "Display dead",
      totalBill: 3000,
      advance: 0,
      status: "In-Progress",
      shopExpense: "",
      serviceDate: dhakaToday(),
    });
    const serviceId = service.body?.id;
    check("J1", "service fixture created", service.status === 201 && serviceId > 0);
    const beforeStats = await api(page, `/api/stats?date=${dhakaToday()}`);
    const expenseBefore = beforeStats.body?.today?.expense ?? 0;

    const purchase = await post(page, "/api/purchases", {
      purchaseType: "SERVICE_PART",
      serviceId,
      supplier: uniqueName("WholesaleDisplay"),
      purchaseDate: dhakaToday(),
      paid: 500,
      items: [
        { name: "Samsung A20 display", quantity: 1, unitCost: 1500 },
        { name: "Display glue", quantity: 2, unitCost: 100 },
      ],
    });
    check(
      "J2",
      "service-part purchase accepts multiple free-text lines and partial payment",
      purchase.status === 201 && purchase.body?.total === 1700 && purchase.body?.paid === 500,
      JSON.stringify(purchase.body)
    );

    const list = await api(page, "/api/purchases");
    const saved = list.body?.purchases?.find((p) => p.id === purchase.body?.purchaseId);
    check(
      "J3",
      "service-part purchase is listed with type, service link and due",
      list.status === 200 && saved?.purchaseType === "SERVICE_PART" && saved?.serviceId === serviceId && saved?.due === 1200,
      JSON.stringify(saved)
    );

    const stats = await api(page, `/api/stats?date=${dhakaToday()}`);
    check(
      "J4",
      "service-part purchase cost is counted once in service expense",
      stats.status === 200 && stats.body?.today?.expense - expenseBefore === 1700,
      JSON.stringify(stats.body?.today)
    );

    const paid = await post(page, "/api/purchases/payments", {
      supplier: saved.supplier,
      amount: 1200,
      method: "CASH",
    });
    const afterPay = await api(page, "/api/purchases");
    const settled = afterPay.body?.purchases?.find((p) => p.id === saved.id);
    check(
      "J5",
      "service-part supplier due can be settled later without overpay",
      paid.status === 201 && settled?.paid === 1700 && settled?.due === 0,
      JSON.stringify({ paid: paid.body, purchase: settled })
    );

    console.log(results.join("\n"));
  } catch (err) {
    console.error(err);
    failed = true;
  } finally {
    await closeBrowser(browser);
  }
  if (failed) process.exitCode = 1;
})();
