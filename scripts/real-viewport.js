/* Laptop-height viewport contract for the service desk.
 *
 * The shop's counter PC is not always 1920x1080: 1280x585 and 1366x650 are
 * real windows on a 1080p screen with the Windows taskbar and browser chrome
 * eating the height. These checks pin the compact counter layout at the five
 * sizes the shop actually uses: no horizontal overflow, one aligned container,
 * a 340/380px form column, money fields clear of the sticky save bar, a single
 * action band, a list that never scrolls sideways, and the empty-state CTA
 * reachable and focused.
 *
 * Run only through `npm test` (scripts/run-tests.js), which supplies a fresh
 * throwaway database, backup folder and server.
 */
const {
  api,
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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  [1280, 585],
  [1280, 650],
  [1366, 650],
  [1536, 730],
  [1920, 1080],
];

const GROUP_NAME = uniqueName("ViewportGroup");
const LONG_NAME = uniqueName("ViewportLong");

let failed = false;
const results = [];
const check = (id, name, ok, extra = "") => {
  results.push(
    `${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`
  );
  if (!ok) failed = true;
};

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = trackErrors(page);

  const get = async (url) => (await api(page, url)).body;
  const post = (url, body) =>
    api(page, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });

  const roster = await get("/api/technicians");
  if (!roster.technicians?.some((t) => t.name === "NURUL" && t.isActive)) {
    const added = await post("/api/technicians", { name: "NURUL" });
    if (!added.ok) {
      throw new Error("NURUL not available: " + JSON.stringify(added.body));
    }
  }

  // A brand-new day is the only moment the empty-state CTA exists. Check it
  // before seeding, on the shop's shortest laptop window.
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="empty-new-entry"]', {
    polling: 100,
    timeout: 15000,
  });
  const emptyBefore = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="empty-new-entry"]');
    const r = btn.getBoundingClientRect();
    return {
      y: Math.round(r.y),
      bottom: Math.round(r.bottom),
      fullyVisible: r.top >= 0 && r.bottom <= window.innerHeight,
    };
  });
  await page.click('[data-testid="empty-new-entry"]');
  await sleep(300);
  const emptyAfter = await page.evaluate(() => {
    const name = document.querySelector("#svc-name");
    const r = name?.getBoundingClientRect();
    return {
      focused: document.activeElement === name,
      visible: !!r && r.top >= 0 && r.bottom <= window.innerHeight,
      scrollY: Math.round(window.scrollY),
    };
  });
  check(
    "RV8",
    "empty-state নতুন এন্ট্রি is fully visible and focuses the name field",
    emptyBefore.fullyVisible && emptyAfter.focused && emptyAfter.visible,
    JSON.stringify({ emptyBefore, emptyAfter })
  );

  // A grouped visit with long model names + one long customer name: enough to
  // exercise the widest row content the table has to fit at 1280px.
  const group = await post("/api/services/batch", {
    customerName: GROUP_NAME,
    phone: "01722000001",
    technician: "NURUL",
    serviceDate: TODAY,
    devices: [
      {
        model: "iPhone 14 Pro Max display assembly",
        problem: "ডিসপ্লে পরিবর্তন ও টাচ সমস্যা",
        totalBill: 12000,
        advance: 3000,
        status: "In-Progress",
      },
      {
        model: "Samsung Galaxy S24 Ultra back glass",
        problem: "ব্যাক গ্লাস পরিবর্তন",
        totalBill: 4500,
        advance: 1000,
        status: "Pending",
      },
    ],
  });
  if (!group.ok) {
    throw new Error("viewport seed failed: " + JSON.stringify(group.body));
  }
  const single = await post("/api/services", {
    customerName: LONG_NAME,
    phone: "01722000002",
    model: "Redmi Note 13 Pro plus 5G",
    problem: "চার্জিং পোর্ট মেরামত",
    technician: "NURUL",
    serviceDate: TODAY,
    totalBill: 2800,
    advance: 800,
    status: "Delivered",
  });
  if (!single.ok) {
    throw new Error("viewport single seed failed: " + JSON.stringify(single.body));
  }

  const measure = () =>
    page.evaluate(() => {
      const round = (n) => Math.round(n);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: round(r.x),
          y: round(r.y),
          w: round(r.width),
          h: round(r.height),
          right: round(r.right),
          bottom: round(r.bottom),
        };
      };
      const visible = (el) => {
        if (!el) return false;
        // Closed <details> still report a rect in this Chrome build, so treat
        // anything inside one as hidden.
        if (el.closest("details:not([open])")) return false;
        const r = el.getBoundingClientRect();
        return el.offsetParent !== null && r.width > 0 && r.height > 0;
      };
      // The masthead lives in the root layout now (persistent across routes),
      // so it is no longer a descendant of the page's <main>.
      const header = document.querySelector('[data-testid="app-header"]');
      // The daily-summary bar and masthead action band are gone from the
      // front desk; the aligned panel is now the service list itself.
      const listPanel = document.querySelector('[data-testid="daily-services"]');
      const footerCard = document.querySelector("footer > div");
      const formSection = document.querySelector("form")?.closest("section");
      const saveBar = [...document.querySelectorAll("div")].find((d) =>
        d.className.includes("sticky bottom-0")
      );
      const actions = document.querySelector('[data-testid="page-actions"]');
      const dashboardLink = document.querySelector(
        '[data-testid="service-dashboard-link"]'
      );
      const bill = [...document.querySelectorAll("#svc-total-bill")].find(
        visible
      );
      const due = [...document.querySelectorAll("#svc-due")].find(visible);
      const name = document.querySelector("#svc-name");
      const wrap = document.querySelector(
        '[data-testid="daily-services"] .overflow-auto'
      );
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        doc: {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        },
        header: box(header),
        listPanel: box(listPanel),
        footerCard: box(footerCard),
        formSection: box(formSection),
        saveBar: box(saveBar),
        actions: box(actions),
        dashboardLink: box(dashboardLink),
        bill: box(bill),
        due: box(due),
        nameVisible: visible(name),
        listOverflow: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
      };
    });

  // The money block sits at the bottom of the entry form. Since product lines
  // and the visit/cost sections were added the desk is taller than a 585px
  // laptop screen, so the money may need one scroll — what must never happen is
  // the sticky save bar covering the bill or the auto-due input.
  const centerMoney = () =>
    page.evaluate(() => {
      const bill = [...document.querySelectorAll("#svc-total-bill")].find(
        (el) => el.offsetParent !== null
      );
      bill?.scrollIntoView({ block: "center" });
    });

  const measureMoney = () =>
    page.evaluate(() => {
      const round = (n) => Math.round(n);
      const bill = [...document.querySelectorAll("#svc-total-bill")].find(
        (el) => el.offsetParent !== null
      );
      const due = [...document.querySelectorAll("#svc-due")].find(
        (el) => el.offsetParent !== null
      );
      const saveBar = [...document.querySelectorAll("div")].find((d) =>
        d.className.includes("sticky bottom-0")
      );
      const b = bill?.getBoundingClientRect();
      const d = due?.getBoundingClientRect();
      const s = saveBar?.getBoundingClientRect();
      return {
        viewportH: window.innerHeight,
        bill: b && { y: round(b.y), bottom: round(b.bottom) },
        due: d && { y: round(d.y), bottom: round(d.bottom) },
        saveBar: s && { y: round(s.y) },
      };
    });

  const rows = [];
  for (const [width, height] of VIEWPORTS) {
    await page.setViewport({ width, height });
    await page.goto(`${BASE}/service?date=${TODAY}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await waitDailyRow(page, GROUP_NAME, true);
    await sleep(150);
    const row = { label: `${width}x${height}`, ...(await measure()) };
    await centerMoney();
    await sleep(350);
    row.money = await measureMoney();
    rows.push(row);
  }

  check(
    "RV1",
    "no horizontal page overflow at 1280x585 / 1280x650 / 1366x650 / 1536x730 / 1920x1080",
    rows.every((r) => r.doc.scrollWidth <= r.doc.clientWidth + 1),
    rows
      .map((r) => `${r.label}:${r.doc.scrollWidth}/${r.doc.clientWidth}`)
      .join(" ")
  );

  check(
    "RV2",
    "header and footer share the outer container edges; the list shares the right edge",
    // The list sits in the xl:340px + 1fr desk grid, so its left edge is the
    // right column, not the page gutter. What must stay aligned is the shared
    // right edge (same container) and the masthead/footer outer left edge.
    rows.every(
      (r) =>
        r.header &&
        r.listPanel &&
        r.footerCard &&
        Math.abs(r.header.x - r.footerCard.x) <= 1 &&
        Math.abs(r.header.right - r.footerCard.right) <= 1 &&
        Math.abs(r.header.right - r.listPanel.right) <= 1
    ),
    JSON.stringify(
      rows.map((r) => ({
        size: r.label,
        header: r.header && [r.header.x, r.header.right],
        list: r.listPanel && [r.listPanel.x, r.listPanel.right],
        footer: r.footerCard && [r.footerCard.x, r.footerCard.right],
      }))
    )
  );

  check(
    "RV3",
    "the form column is 340px below 1536 and 380px from 1536",
    rows.every(
      (r) =>
        r.formSection &&
        Math.abs(
          r.formSection.w - (r.viewport.w >= 1536 ? 380 : 340)
        ) <= 1
    ),
    rows.map((r) => `${r.label}:${r.formSection?.w}`).join(" ")
  );

  const laptopHeights = rows.filter((r) => r.viewport.h <= 700);
  check(
    "RV4",
    "bill and auto-due are never covered by the sticky save bar on laptop heights",
    laptopHeights.length === 3 &&
      laptopHeights.every((r) => {
        const m = r.money;
        return (
          m?.bill &&
          m?.due &&
          m?.saveBar &&
          m.bill.y >= 0 &&
          m.due.bottom <= m.viewportH &&
          m.bill.bottom <= m.saveBar.y - 4 &&
          m.due.bottom <= m.saveBar.y - 4
        );
      }),
    laptopHeights
      .map(
        (r) =>
          `${r.label}:bill=${r.money?.bill?.bottom} due=${r.money?.due?.bottom} ` +
          `save=${r.money?.saveBar?.y} h=${r.money?.viewportH}`
      )
      .join(" ")
  );

  check(
    "RV5",
    "Service has no masthead action band; the form/list lead the page",
    rows.every(
      (r) =>
        r.actions === null &&
        r.dashboardLink === null &&
        r.formSection &&
        r.listPanel &&
        r.listPanel.y >= r.header.bottom
    ),
    JSON.stringify(
      rows.map((r) => ({
        size: r.label,
        actions: r.actions,
        dashboardLink: r.dashboardLink,
        list: r.listPanel && r.listPanel.y,
      }))
    )
  );

  check(
    "RV6",
    "the service list never needs horizontal scrolling",
    rows.every((r) => r.listOverflow >= 0 && r.listOverflow <= 1),
    rows.map((r) => `${r.label}:${r.listOverflow}`).join(" ")
  );

  check(
    "RV7",
    "1920x1080 shows the whole desk without a vertical scrollbar",
    rows.every(
      (r) =>
        r.label !== "1920x1080" ||
        r.doc.scrollHeight <= r.doc.clientHeight + 1
    ),
    JSON.stringify(
      rows
        .filter((r) => r.label === "1920x1080")
        .map((r) => `${r.doc.scrollHeight}/${r.doc.clientHeight}`)
    )
  );

  check("RV9", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("REAL-VIEWPORT CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
