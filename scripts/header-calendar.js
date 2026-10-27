/* Regression: the navbar calendar must close when its button is clicked a
 * second time. The native date picker is browser-owned and cannot be toggled,
 * so the visible calendar is the app's own popover.
 *
 * Run only through `npm test` — the runner provides MAHER_TEST_URL and a
 * throwaway database.
 */
const {
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
let failed = false;

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
}

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
    await page.waitForSelector('[data-testid="calendar-toggle"]', {
      timeout: 5000,
    });

    // ---- open ----
    await page.click('[data-testid="calendar-toggle"]');
    await page.waitForSelector('[data-testid="calendar-panel"]', {
      timeout: 3000,
    });
    const opened = await page.$eval(
      '[data-testid="calendar-toggle"]',
      (button) => button.getAttribute("aria-expanded")
    );
    check(
      "navbar calendar opens",
      opened === "true",
      `aria-expanded=${opened}`
    );

    // ---- the reported bug: second click must close it ----
    await page.click('[data-testid="calendar-toggle"]');
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="calendar-panel"]'),
      { timeout: 3000 }
    );
    const closed = await page.$eval(
      '[data-testid="calendar-toggle"]',
      (button) => button.getAttribute("aria-expanded")
    );
    check(
      "second click closes the calendar",
      closed === "false",
      `aria-expanded=${closed}`
    );

    // ---- picking a day updates the header and closes the popover ----
    const [year, month, day] = TODAY.split("-").map(Number);
    const pickDay = day === 1 ? 2 : 1;
    const pickKey = `${year}-${String(month).padStart(2, "0")}-${String(
      pickDay
    ).padStart(2, "0")}`;
    await page.click('[data-testid="calendar-toggle"]');
    await page.waitForSelector('[data-testid="calendar-panel"]', {
      timeout: 3000,
    });
    await page.click(`[data-date="${pickKey}"]`);
    await page.waitForFunction(
      (key) =>
        document.querySelector('[data-testid="service-date-nav"] input[type="date"]')?.value === key,
      { timeout: 5000 },
      pickKey
    );
    const panelAfterPick = await page.$('[data-testid="calendar-panel"]');
    check(
      "picking a day updates the date and closes the calendar",
      !panelAfterPick,
      `picked=${pickKey}`
    );

    // ---- click outside closes ----
    await page.click('[data-testid="calendar-toggle"]');
    await page.waitForSelector('[data-testid="calendar-panel"]', {
      timeout: 3000,
    });
    // The service desk has no page heading any more (the old eyebrow/title was
    // removed with the redesign), so there is no `h1` to click. Click the page
    // gutter instead: at every width that is empty background, below the
    // popover, so the click can neither miss the page nor land on a control.
    const panelBox = await (
      await page.$('[data-testid="calendar-panel"]')
    ).boundingBox();
    const viewport = page.viewport();
    const gutterY = Math.min(
      viewport.height - 12,
      Math.round(panelBox.y + panelBox.height + 24)
    );
    await page.mouse.click(6, gutterY);
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="calendar-panel"]'),
      { timeout: 3000 }
    );
    check(
      "outside click closes the calendar",
      true,
      `clicked page at 6,${gutterY}`
    );

    check("zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } finally {
    await closeBrowser(browser);
  }
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error("HEADER CALENDAR CRASH:", error);
  process.exit(1);
});
