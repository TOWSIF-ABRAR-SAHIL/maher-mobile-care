/* Regression: changing the selected day must not replace the dashboard with
 * loading skeletons. The next day's API calls are delayed so the intermediate
 * state is observable.
 *
 * Run only through `npm test` — the runner provides MAHER_TEST_URL and a
 * throwaway database.
 */
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  shiftDay,
  trackErrors,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const YESTERDAY = shiftDay(TODAY, -1);
let failed = false;

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1366, height: 900 });
    const errors = trackErrors(page);

    await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForFunction(
      () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
      { timeout: 15000 }
    );

    // One row on the current day so the list has something to keep visible.
    const technicians = (await api(page, "/api/technicians")).body.technicians;
    const technician = technicians?.[0]?.name;
    if (!technician) throw new Error("no seeded technician");
    const created = await api(page, "/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerName: "DateNav Flicker",
        phone: "01700000000",
        model: "Flicker Test",
        technician,
        problem: "date navigation regression",
        totalBill: "100",
        advance: "0",
        status: "In-Progress",
        serviceDate: TODAY,
      }),
    });
    if (!created.ok) {
      throw new Error("seed failed: " + JSON.stringify(created.body));
    }

    await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
    await page.waitForFunction(
      () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
      { timeout: 15000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[class*="animate-pulse"]').length === 0,
      { timeout: 10000 }
    );

    // Scroll the list into view: a collapsing list would also move the page.
    await page.evaluate(() => window.scrollTo(0, 420));
    await sleep(150);
    const scrollBefore = await page.evaluate(() => Math.round(window.scrollY));

    const serviceResponse = page.waitForResponse(
      (response) => response.url().includes(`/api/services?date=${YESTERDAY}`),
      { timeout: 15000 }
    );

    // Delay only the next day's data so the in-between state can be measured.
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const slow =
        url.includes(`/api/services?date=${YESTERDAY}`) ||
        url.includes(`/api/stats?date=${YESTERDAY}`);
      if (slow) {
        setTimeout(() => request.continue().catch(() => {}), 700);
      } else {
        request.continue().catch(() => {});
      }
    });

    await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="service-date-nav"] button')]
        .find((button) => button.textContent.includes("আগের দিন"))
        .click()
    );

    // The heading changes immediately, but the list must not blank out.
    await page.waitForFunction(
      (day) => document.querySelector('[data-testid="daily-services"]')?.dataset.date === day,
      { timeout: 5000 },
      YESTERDAY
    );
    await sleep(200);

    const during = await page.evaluate(() => {
      const section = document.querySelector('[data-testid="daily-services"]');
      const rows = section
        ? section.querySelectorAll(
            'tbody tr, [data-testid^="service-card-"]'
          )
        : [];
      return {
        listSkeletons: section
          ? section.querySelectorAll('[class*="animate-pulse"]').length
          : -1,
        statsSkeletons: document.querySelectorAll(
          '[data-testid="today-stats"] [class*="animate-pulse"], ' +
            '[data-testid="technician-stats"] [class*="animate-pulse"]'
        ).length,
        rows: rows.length,
        scrollY: Math.round(window.scrollY),
      };
    });

    check(
      "previous list stays visible while the next day loads",
      during.listSkeletons === 0 &&
        during.statsSkeletons === 0 &&
        during.rows > 0,
      JSON.stringify(during)
    );
    check(
      "date change does not jump the page",
      Math.abs(during.scrollY - scrollBefore) <= 2,
      `before=${scrollBefore}, during=${during.scrollY}`
    );

    await serviceResponse;
    await page.waitForFunction(
      () =>
        document.body.textContent.includes("কোন সার্ভিস এন্ট্রি নেই"),
      { timeout: 10000 }
    );
    check("next day data replaces the old list", true);

    check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await closeBrowser(browser);
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("DATE NAV CRASH:", error);
  process.exit(1);
});
