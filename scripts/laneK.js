/* Lane K — customer history by normalized mobile number. */
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
    const phone = `017${String(Date.now()).slice(-8)}`;
    const name = uniqueName("HistoryCustomer");
    const created = await post(page, "/api/services", {
      customerName: name,
      phone,
      model: "A20",
      technician: "NURUL",
      problem: "Display dead",
      solution: "নতুন ডিসপ্লে লাগিয়ে টেস্ট করা হয়েছে",
      condition: "পানিতে নষ্ট হলে দায় দোকানের নয়",
      totalBill: 3000,
      advance: 500,
      status: "Completed",
      shopExpense: "",
      deliveryDate: dhakaToday(),
      serviceDate: dhakaToday(),
    });
    check("K1", "history fixture stores solution and condition", created.status === 201);

    const history = await api(page, `/api/services/history?phone=${encodeURIComponent(`+880${phone.slice(1)}`)}`);
    const row = history.body?.services?.find((s) => s.id === created.body?.id);
    check(
      "K2",
      "mobile history finds the customer by normalized phone and returns solution/condition",
      history.status === 200 && row?.phone === phone && row?.solution?.includes("ডিসপ্লে") && row?.condition?.includes("পানিতে"),
      JSON.stringify(row)
    );

    const missing = await api(page, "/api/services/history?phone=01900000000");
    check("K3", "unknown mobile history returns an empty result", missing.status === 200 && missing.body?.total === 0);

    // Header search bar: a number query must find the customer's old rows and
    // the result rows must carry the stored সমাধান/শর্ত notes.
    const localSearch = await api(page, `/api/services/search?q=${encodeURIComponent(phone)}`);
    const localRow = localSearch.body?.services?.find((s) => s.id === created.body?.id);
    check(
      "K4",
      "header search by local number returns the row with its solution and condition",
      localSearch.status === 200 &&
        localRow?.solution?.includes("ডিসপ্লে") &&
        localRow?.condition?.includes("পানিতে"),
      JSON.stringify(localRow)
    );

    const intlSearch = await api(
      page,
      `/api/services/search?q=${encodeURIComponent(`+880${phone.slice(1)}`)}`
    );
    check(
      "K5",
      "header search matches the same row for the +880 number format",
      intlSearch.status === 200 &&
        intlSearch.body?.services?.some((s) => s.id === created.body?.id)
    );

    const bodyText = () =>
      page.evaluate(() => document.body.innerText);
    const waitFor = async (predicate, timeoutMs = 10000) => {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return false;
    };

    await page.click('[data-testid="mobile-search-open"]');
    await page.waitForSelector("#global-search-mobile", { timeout: 8000 });
    await page.type("#global-search-mobile", phone);
    const phoneShown = await waitFor(async () =>
      (await bodyText()).includes("সমাধান:")
    );
    const phoneText = await bodyText();
    check(
      "K6",
      "header search bar shows full history details for a number query",
      phoneShown &&
        phoneText.includes("টেকনিশিয়ান:") &&
        phoneText.includes("NURUL") &&
        phoneText.includes("বিল") &&
        phoneText.includes("৳3,000") &&
        phoneText.includes("জমা") &&
        phoneText.includes("৳500") &&
        phoneText.includes("বাকি") &&
        phoneText.includes("৳2,500") &&
        phoneText.includes("ডেলিভারি:") &&
        phoneText.includes("নতুন ডিসপ্লে লাগিয়ে টেস্ট করা হয়েছে") &&
        phoneText.includes("শর্ত:")
    );

    // Privacy rule: a name query never reveals the internal solution note.
    await page.click("#global-search-mobile");
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type("#global-search-mobile", name);
    const nameHiddenNote = await waitFor(async () => {
      const text = await bodyText();
      return text.includes(name) && !text.includes("সমাধান:");
    });
    check(
      "K7",
      "header search by name still hides the internal solution note",
      nameHiddenNote
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
