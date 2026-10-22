/* Shared helpers for the temp-database browser suites.
 * Every suite must run against MAHER_TEST_URL (set by scripts/run-tests.js),
 * never assume live shop rows, and never assume a fixed calendar date.
 */
const puppeteer = require("puppeteer-core");

/** These suites mutate and archive rows, so they must never fall back to a
 *  developer's live shop server. scripts/run-tests.js (npm test) is the only
 *  supported entry point; it always sets both variables. */
function requireTestEnv() {
  const missing = ["MAHER_TEST_URL", "MAHER_TEST_DB_FILE"].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) {
    throw new Error(
      `Refusing to run against a possibly-live database: ${missing.join(
        ", "
      )} not set. Run "npm test" (scripts/run-tests.js) instead of invoking this suite directly.`
    );
  }
}

function resolveTestBase() {
  requireTestEnv();
  return process.env.MAHER_TEST_URL;
}

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const candidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const found = candidates.find((candidate) => {
    try {
      require("node:fs").accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (!found) {
    throw new Error(
      "Chrome/Chromium not found. Set PUPPETEER_EXECUTABLE_PATH to a browser executable."
    );
  }
  return found;
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    protocolTimeout: 60000,
  });
}

/** Close a browser even when the suite threw part-way through, so a failed
 *  run never leaves orphaned Chrome processes holding the machine's memory. */
async function closeBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    /* already closed or crashed */
  }
}

function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    const text = m.text();
    if (
      m.type() === "error" &&
      !text.includes("favicon") &&
      !text.toLowerCase().includes("download")
    ) {
      errors.push("console: " + text.slice(0, 150));
    }
  });
  return errors;
}

/** Current YYYY-MM-DD day in Asia/Dhaka, computed from the test runner clock. */
function dhakaToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDay(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 24 * 60 * 60 * 1000;
  const dt = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function monthContaining(key) {
  const [y, m] = key.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

function monthLabel(key) {
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return months[Number(key.slice(5, 7)) - 1];
}

function dayLabel(key) {
  return `${Number(key.slice(8, 10))} ${monthLabel(key)}`;
}

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

async function api(page, path, options = {}) {
  return page.evaluate(async ({ p, init }) => {
    const response = await fetch(p, init);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }, { p: path, init: options });
}

async function typeInto(page, id, value) {
  await page.$eval(
    `#${id}`,
    (el, v) => {
      el.focus();
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

async function submitButton(page, text) {
  await page.evaluate((t) => {
    const button = [...document.querySelectorAll("form button[type='submit']")].find(
      (x) => x.textContent.includes(t)
    );
    if (!button) throw new Error("submit missing: " + t);
    button.click();
  }, text);
}

async function waitToast(page, text) {
  await page.waitForFunction((t) => document.body.textContent.includes(t), {
    polling: 500,
    timeout: 8000,
  });
}

const DAILY_SECTION = '[data-testid="daily-services"]';

/** Daily rows are a table on desktop and cards below 1024px. */
const DAILY_CARD_SELECTOR = '[data-testid^="service-card-"]';

async function dailyRows(page) {
  return page.evaluate(
    (selector, cardSelector) => {
      const section = document.querySelector(selector);
      if (!section) return [];
      const rows = [...section.querySelectorAll("tbody tr")];
      if (rows.length > 0) return rows.map((tr) => tr.textContent);
      return [...section.querySelectorAll(cardSelector)].map(
        (card) => card.textContent
      );
    },
    DAILY_SECTION,
    DAILY_CARD_SELECTOR
  );
}

async function clickDailyRowButton(page, name, title) {
  await page.evaluate(
    (selector, cardSelector, rowName, buttonTitle) => {
      const section = document.querySelector(selector);
      if (!section) throw new Error("daily services section missing");
      const row =
        [...section.querySelectorAll("tbody tr")].find((tr) =>
          tr.textContent.includes(rowName)
        ) ||
        [...section.querySelectorAll(cardSelector)].find((card) =>
          card.textContent.includes(rowName)
        );
      if (!row) throw new Error("daily row missing: " + rowName);
      const button = row.querySelector(`button[title='${buttonTitle}']`);
      if (!button) throw new Error(`${buttonTitle} missing for ${rowName}`);
      button.click();
    },
    DAILY_SECTION,
    DAILY_CARD_SELECTOR,
    name,
    title
  );
}

async function clickDailyStatus(page, name) {
  await page.evaluate(
    (selector, cardSelector, rowName) => {
      const section = document.querySelector(selector);
      if (!section) throw new Error("daily services section missing");
      const row =
        [...section.querySelectorAll("tbody tr")].find((tr) =>
          tr.textContent.includes(rowName)
        ) ||
        [...section.querySelectorAll(cardSelector)].find((card) =>
          card.textContent.includes(rowName)
        );
      if (!row) throw new Error("daily row missing: " + rowName);
      const button = row.querySelector("td button, button");
      if (!button) throw new Error("status button missing for " + rowName);
      button.click();
    },
    DAILY_SECTION,
    DAILY_CARD_SELECTOR,
    name
  );
}

async function waitDailyRow(page, name, present = true, timeout = 15000) {
  await page.waitForFunction(
    (selector, cardSelector, rowName, shouldBePresent) => {
      const section = document.querySelector(selector);
      if (!section) return false;
      const found = [
        ...section.querySelectorAll("tbody tr"),
        ...section.querySelectorAll(cardSelector),
      ].some((row) => row.textContent.includes(rowName));
      return shouldBePresent ? found : !found;
    },
    { polling: 500, timeout },
    DAILY_SECTION,
    DAILY_CARD_SELECTOR,
    name,
    present
  );
}

module.exports = {
  api,
  clickDailyRowButton,
  clickDailyStatus,
  closeBrowser,
  dailyRows,
  dayLabel,
  dhakaToday,
  launchBrowser,
  monthContaining,
  monthLabel,
  requireTestEnv,
  resolveChromePath,
  resolveTestBase,
  shiftDay,
  submitButton,
  trackErrors,
  typeInto,
  uniqueName,
  waitDailyRow,
  waitToast,
};
