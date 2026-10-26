/* Responsive regression: page overflow, header ladder, search mode, card/table
 * views, dashboard grid and phone/tablet dialogs at the sizes the shop uses.
 * Run directly only against MAHER_TEST_URL (npm test sets it).
 */
const {
  api,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
} = require("./test-support");

const BASE = resolveTestBase();
const WIDTHS = [360, 390, 640, 768, 960, 1024, 1280, 1366, 1440, 1920];
const RESPONSIVE_REF = "ResponsiveProbe";
const failures = [];

function check(id, name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures.push(id);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDashboard(page) {
  await page.waitForFunction(
    () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
    { polling: 500, timeout: 30000 }
  );
  // Let the media-query effect and the initial API fetches settle.
  await sleep(1200);
}

async function closeDialog(page, selector) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    { polling: 100, timeout: 8000 },
    selector
  );
}

async function measureDialog(page, selector) {
  return page.evaluate((sel) => {
    const dialog = document.querySelector(sel);
    if (!dialog) return null;
    const rect = dialog.getBoundingClientRect();
    return {
      pageOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
    };
  }, selector);
}

async function openAndCheckDialog(page, width, openSelector, dialogSelector, extra) {
  await page.evaluate((sel) => document.querySelector(sel)?.click(), openSelector);
  await page.waitForSelector(dialogSelector, { timeout: 10000 });
  await sleep(250);
  const measured = await measureDialog(page, dialogSelector);
  check(
    `R${width}-${dialogSelector.includes("dues") ? "dues" : "report"}`,
    `${width}px ${dialogSelector.includes("dues") ? "dues" : "report"} dialog fits without horizontal scroll`,
    !!measured &&
      !measured.pageOverflow &&
      !measured.dialogOverflow &&
      measured.left >= 0 &&
      measured.right <= width,
    JSON.stringify({ ...measured, ...extra })
  );
  await closeDialog(page, dialogSelector);
}

async function main() {
  const browser = await launchBrowser();
  try {
    // Seed one real row so the suite exercises the card list and the table
    // (and its sticky action column), not just empty-state chrome.
    const setupPage = await browser.newPage();
    try {
      await setupPage.setViewport({ width: 1366, height: 900 });
      await setupPage.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
      await waitForDashboard(setupPage);
      const seed = await api(setupPage, "/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: RESPONSIVE_REF,
          phone: "01700000031",
          model: "Responsive Model",
          technician: "NURUL",
          problem: "Responsive probe",
          totalBill: 1000,
          advance: 300,
          status: "Pending",
          shopExpense: "1500",
          partsShop: "Responsive Parts",
          serviceDate: dhakaToday(),
        }),
      });
      if (!seed.ok) {
        throw new Error(`responsive seed failed: ${JSON.stringify(seed.body)}`);
      }
    } finally {
      await setupPage.close();
    }

    for (const width of WIDTHS) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width, height: 900 });
        const errors = trackErrors(page);
        await page.goto(`${BASE}/service`, { waitUntil: "networkidle0", timeout: 60000 });
        await waitForDashboard(page);

        const state = await page.evaluate(() => {
          const header = document.querySelector('[data-testid="app-header"]');
          const nav = document.querySelector('[data-testid="header-nav"]');
          const navLinks = nav
            ? [...nav.querySelectorAll("a")].filter(
                (link) => link.offsetParent !== null
              )
            : [];
          const desktopSearch = document.querySelector("#global-search");
          const mobileSearch = document.querySelector(
            '[data-testid="mobile-search-open"]'
          );
          const section = document.querySelector('[data-testid="daily-services"]');
          const dateNav = document.querySelector(
            '[data-testid="service-date-nav"]'
          );
          const form = document.querySelector("form");
          // The form's own <section> starts at the grid top; the <form> starts
          // below the "new entry" heading. Compare the container, not the form.
          const formSection = form?.closest("section") ?? form;
          const headerRect = header?.getBoundingClientRect();
          const formRect = formSection?.getBoundingClientRect();
          const sectionRect = section?.getBoundingClientRect();
          const actionHeader = section?.querySelector("thead th:last-child");
          const tableWrap = section?.querySelector("table")?.parentElement;
          const actionHeaderRect = actionHeader?.getBoundingClientRect();
          const tableWrapRect = tableWrap?.getBoundingClientRect();
          return {
            pageOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth + 1,
            pageWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            headerHeight: headerRect ? Math.round(headerRect.height) : -1,
            headerLeft: headerRect ? Math.round(headerRect.left) : -1,
            headerRight: headerRect ? Math.round(headerRect.right) : -1,
            navCount: navLinks.length,
            navLabels: navLinks.map((link) => link.textContent.trim()),
            navOverflow: nav ? nav.scrollWidth > nav.clientWidth + 1 : true,
            dateNavVisible: !!dateNav && dateNav.offsetParent !== null,
            desktopSearchVisible:
              !!desktopSearch && desktopSearch.offsetParent !== null,
            mobileSearchVisible:
              !!mobileSearch && mobileSearch.offsetParent !== null,
            dataView: section?.getAttribute("data-view") ?? null,
            sectionOverflow: section
              ? section.scrollWidth > section.clientWidth + 1
              : true,
            actionHeaderRight: actionHeaderRect
              ? Math.round(actionHeaderRect.right)
              : -1,
            tableWrapRight: tableWrapRect ? Math.round(tableWrapRect.right) : -1,
            formTop: formRect ? Math.round(formRect.top) : -1,
            formBottom: formRect ? Math.round(formRect.bottom) : -1,
            formRight: formRect ? Math.round(formRect.right) : -1,
            sectionTop: sectionRect ? Math.round(sectionRect.top) : -1,
            sectionLeft: sectionRect ? Math.round(sectionRect.left) : -1,
          };
        });

        check(
          `R${width}`,
          `${width}px has no horizontal page overflow`,
          !state.pageOverflow,
          JSON.stringify({ scrollWidth: state.pageWidth, clientWidth: state.clientWidth })
        );
        check(
          `H${width}`,
          `${width}px header stays compact`,
          state.headerHeight > 0 &&
            state.headerHeight <=
              (width < 640 ? 220 : width < 768 ? 200 : width < 1280 ? 180 : 120) &&
            state.headerLeft >= 0 &&
            state.headerRight <= width,
          `height=${state.headerHeight}px`
        );
        check(
          `A${width}`,
          `${width}px shows exactly three nav destinations`,
          state.navCount === 3 &&
            state.navLabels.join(",") === "হোম,সার্ভিস,প্রোডাক্ট" &&
            !state.navOverflow &&
            state.dateNavVisible,
          `links=${state.navCount}, labels=${state.navLabels.join("|")}, overflow=${state.navOverflow}`
        );
        check(
          `S${width}`,
          `${width}px uses the correct search mode`,
          width >= 1280
            ? state.desktopSearchVisible && !state.mobileSearchVisible
            : !state.desktopSearchVisible && state.mobileSearchVisible,
          JSON.stringify({
            desktop: state.desktopSearchVisible,
            mobile: state.mobileSearchVisible,
          })
        );
        const actionsReachable =
          width < 1024 ||
          (state.actionHeaderRight > 0 &&
            state.tableWrapRight > 0 &&
            state.actionHeaderRight <= state.tableWrapRight + 1);
        check(
          `V${width}`,
          `${width}px uses ${width >= 1024 ? "the service table" : "service cards"}`,
          state.dataView === (width >= 1024 ? "table" : "cards") &&
            !state.sectionOverflow &&
            actionsReachable,
          JSON.stringify({
            view: state.dataView,
            sectionOverflow: state.sectionOverflow,
            actionHeaderRight: state.actionHeaderRight,
            tableWrapRight: state.tableWrapRight,
          })
        );

        if (width < 1024) {
          // Phones/tablets own one workspace surface at a time: the list is the
          // default tab and the entry form replaces it, instead of stacking.
          const tabs = await page.evaluate(() => {
            const listTab = document.querySelector(
              '[data-testid="service-tab-list"]'
            );
            const formTab = document.querySelector(
              '[data-testid="service-tab-form"]'
            );
            return {
              listTab: !!listTab,
              formTab: !!formTab,
              listPressed: listTab?.getAttribute("aria-pressed") === "true",
              formVisibleFirst: !!document.querySelector("form")?.offsetParent,
            };
          });
          await page.evaluate(() =>
            document.querySelector('[data-testid="service-tab-form"]')?.click()
          );
          await sleep(200);
          const formTabState = await page.evaluate(() => {
            const form = document.querySelector("form");
            const box =
              form?.closest("section")?.getBoundingClientRect() ??
              form?.getBoundingClientRect();
            const section = document.querySelector(
              '[data-testid="daily-services"]'
            );
            return {
              formVisible: !!form && !!form.offsetParent,
              formTop: box ? Math.round(box.top) : 0,
              formRight: box ? Math.round(box.right) : 0,
              listHidden: !section || !section.offsetParent,
            };
          });
          await page.evaluate(() =>
            document.querySelector('[data-testid="service-tab-list"]')?.click()
          );
          await sleep(200);
          check(
            `G${width}`,
            `${width}px switches between list and entry tabs`,
            tabs.listTab &&
              tabs.formTab &&
              tabs.listPressed &&
              !tabs.formVisibleFirst &&
              formTabState.formVisible &&
              formTabState.formTop > 0 &&
              formTabState.formRight > 0 &&
              formTabState.listHidden,
            JSON.stringify({ ...tabs, ...formTabState })
          );
        } else {
          const sideBySide =
            Math.abs(state.formTop - state.sectionTop) <= 2 &&
            state.sectionLeft > state.formRight;
          const stacked =
            state.sectionTop >= state.formBottom - 1 &&
            state.sectionLeft <= state.formRight;
          check(
            `G${width}`,
            width >= 1280
              ? `${width}px dashboard is side by side at xl`
              : `${width}px dashboard stacks the form above the list`,
            width >= 1280 ? sideBySide : stacked,
            JSON.stringify({
              formTop: state.formTop,
              formBottom: state.formBottom,
              formRight: state.formRight,
              sectionTop: state.sectionTop,
              sectionLeft: state.sectionLeft,
            })
          );
        }

        if (width === 390 || width === 768) {
          await openAndCheckDialog(
            page,
            width,
            '[data-testid="open-report"]',
            '[data-testid="report-dialog"]'
          );
          await page.evaluate(() =>
            document.querySelector('[data-testid="open-dues"]')?.click()
          );
          await page.waitForSelector('[data-testid="dues-dialog"]', {
            timeout: 10000,
          });
          await sleep(250);
          const duesState = await page.evaluate(() => {
            const dialog = document.querySelector('[data-testid="dues-dialog"]');
            const section = document.querySelector(
              '[data-testid="outstanding-dues"]'
            );
            const rect = dialog.getBoundingClientRect();
            return {
              pageOverflow:
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth + 1,
              dialogOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              dataView: section?.getAttribute("data-view") ?? null,
            };
          });
          check(
            `R${width}-dues`,
            `${width}px dues dialog uses cards and does not scroll sideways`,
            !duesState.pageOverflow &&
              !duesState.dialogOverflow &&
              duesState.left >= 0 &&
              duesState.right <= width &&
              duesState.dataView === "cards",
            JSON.stringify(duesState)
          );
          await closeDialog(page, '[data-testid="dues-dialog"]');
        }

        check(
          `E${width}`,
          `${width}px has zero JS errors`,
          errors.length === 0,
          errors.slice(0, 2).join(" | ")
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`RESPONSIVE SUITE FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("RESPONSIVE SUITE PASSED");
}

main().catch((e) => {
  console.error("RESPONSIVE SUITE CRASH:", e.message);
  process.exit(1);
});
