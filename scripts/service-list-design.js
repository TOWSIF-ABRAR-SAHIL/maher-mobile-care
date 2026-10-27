/* Service list design contract: the darker brand blue, the ledger masthead,
 * the status index strip, tone-marked rows, the receipt money stack and the
 * mobile job-ticket cards. These assertions intentionally describe the new
 * UI before it exists; they failed on the old list and now guard it.
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
  typeInto,
  uniqueName,
} = require("./test-support");

const BASE = resolveTestBase();
const TODAY = dhakaToday();
const BN = "০১২৩৪৫৬৭৮৯";
const bn = (value) => String(value).replace(/\d/g, (d) => BN[Number(d)]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BN_MONTHS = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];
const BN_WEEKDAYS = [
  "রবিবার",
  "সোমবার",
  "মঙ্গলবার",
  "বুধবার",
  "বৃহস্পতিবার",
  "শুক্রবার",
  "শনিবার",
];

const GROUP_NAME = uniqueName("DesignGroup");
const DUE_NAME = uniqueName("DesignDue");
const PAID_NAME = uniqueName("DesignPaid");
const RETURN_NAME = uniqueName("DesignReturn");

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
  await page.setViewport({ width: 1440, height: 900 });
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

  // Four visits / five devices: a multi-device group, an unpaid job, a paid
  // job and a terminal return. Together they cover every row tone.
  const batch = await post("/api/services/batch", {
    customerName: GROUP_NAME,
    phone: "01722220001",
    technician: "NURUL",
    serviceDate: TODAY,
    devices: [
      {
        model: "Design Group A",
        problem: "Display dead",
        totalBill: 3000,
        advance: 1000,
        status: "In-Progress",
      },
      {
        model: "Design Group B",
        problem: "Battery swap",
        totalBill: 2000,
        advance: 2000,
        status: "Completed",
      },
    ],
  });
  if (!batch.ok) {
    throw new Error("group seed failed: " + JSON.stringify(batch.body));
  }

  const due = await post("/api/services", {
    customerName: DUE_NAME,
    phone: "01722220002",
    model: "Design Due",
    technician: "NURUL",
    problem: "Charging port",
    totalBill: 800,
    advance: 100,
    status: "Pending",
    serviceDate: TODAY,
  });
  if (!due.ok) throw new Error("due seed failed: " + JSON.stringify(due.body));

  const paid = await post("/api/services", {
    customerName: PAID_NAME,
    phone: "01722220003",
    model: "Design Paid",
    technician: "NURUL",
    problem: "Speaker",
    totalBill: 500,
    advance: 500,
    status: "Delivered",
    serviceDate: TODAY,
  });
  if (!paid.ok) throw new Error("paid seed failed: " + JSON.stringify(paid.body));

  const returnedSeed = await post("/api/services", {
    customerName: RETURN_NAME,
    phone: "01722220004",
    model: "Design Return",
    technician: "NURUL",
    problem: "Water damage",
    totalBill: 400,
    advance: 100,
    status: "Pending",
    serviceDate: TODAY,
  });
  if (!returnedSeed.ok) {
    throw new Error("return seed failed: " + JSON.stringify(returnedSeed.body));
  }
  const refunded = await post(
    `/api/services/${returnedSeed.body.id}/refund`,
    { note: "design check" }
  );
  if (!refunded.ok) {
    throw new Error("refund seed failed: " + JSON.stringify(refunded.body));
  }

  const services = (await get(`/api/services?date=${TODAY}`)).services;
  const visits = new Map();
  for (const row of services) {
    const key = row.groupId ? `g:${row.groupId}` : `r:${row.id}`;
    if (!visits.has(key)) {
      visits.set(key, { key, devices: [] });
    }
    visits.get(key).devices.push(row);
  }
  const visitList = [...visits.values()];
  const statusCount = (status) =>
    visitList.filter((v) => v.devices.some((d) => d.status === status)).length;
  const expectedTabs = [
    `সব (${visitList.length})`,
    `পেন্ডিং (${statusCount("Pending")})`,
    `চলছে (${statusCount("In-Progress")})`,
    `সম্পন্ন (${statusCount("Completed")})`,
    `ডেলিভারি (${statusCount("Delivered")})`,
    `ফেরত (${statusCount("Returned")})`,
  ];

  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForFunction(
    (day) =>
      document.querySelector('[data-testid="daily-services"]')?.dataset.date ===
      day,
    { polling: 200, timeout: 20000 },
    TODAY
  );
  await page.waitForSelector('[data-testid="daily-services"] tbody tr', {
    timeout: 20000,
  });

  // ---------- D1: the royal chrome is #1748D8, glossed with a gradient ----
  const brand = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="app-header"]');
    const root = getComputedStyle(document.documentElement);
    const style = getComputedStyle(header);
    const rgb = style.backgroundColor;
    const m = rgb.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    const channel = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance =
      0.2126 * channel(m[0]) + 0.7152 * channel(m[1]) + 0.0722 * channel(m[2]);
    return {
      token: root.getPropertyValue("--maher-navy").trim(),
      hover: root.getPropertyValue("--maher-navy-light").trim(),
      pageBg: root.getPropertyValue("--maher-surface").trim(),
      headerBg: rgb,
      headerGloss: /linear-gradient/.test(style.backgroundImage),
      headerSheen: /inset/.test(style.boxShadow),
      contrast: Number((1.05 / (luminance + 0.05)).toFixed(2)),
    };
  });
  check(
    "D1",
    "header chrome is royal #1748D8 under a gloss gradient with white contrast",
    brand.token === "224.8 80.8% 46.9%" &&
      brand.hover === "225.6 81.8% 38.8%" &&
      brand.pageBg === "216 71.4% 97.3%" &&
      brand.headerBg === "rgb(23, 72, 216)" &&
      brand.headerGloss &&
      brand.headerSheen &&
      brand.contrast >= 6.5,
    JSON.stringify(brand)
  );

  // ---------- D1b: white panels are glossy — hairline + top wash + lift ----
  const panel = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="daily-services"]');
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      bg: style.backgroundColor,
      border: style.borderTopColor,
      wash: /linear-gradient/.test(style.backgroundImage),
      lift: style.boxShadow !== "none" && style.boxShadow.length > 0,
      radius: style.borderTopLeftRadius,
    };
  });
  check(
    "D1b",
    "the service panel is white with a #E0E8F5 hairline, a blue top wash and a soft lift",
    !!panel &&
      panel.bg === "rgb(255, 255, 255)" &&
      panel.border === "rgb(224, 232, 245)" &&
      panel.wash &&
      panel.lift &&
      ["12px", "14px", "16px"].includes(panel.radius),
    JSON.stringify(panel)
  );

  // ---------- D2: the masthead states the day and its real size ----------
  const [year, month, day] = TODAY.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dateLabel = `${BN_WEEKDAYS[weekday]}, ${bn(day)} ${
    BN_MONTHS[month - 1]
  } ${bn(year)}`;
  const facts = await page
    .$eval('[data-testid="service-list-facts"]', (el) =>
      el.textContent.replace(/\s+/g, " ").trim()
    )
    .catch(() => null);
  check(
    "D2",
    "masthead reads the Bengali date plus visit and device counts",
    !!facts &&
      facts.includes(dateLabel) &&
      facts.includes(`${bn(visitList.length)}টি ভিজিট`) &&
      facts.includes(`${bn(services.length)}টি ডিভাইস`) &&
      !facts.includes(TODAY),
    JSON.stringify({ facts, dateLabel })
  );

  // ---------- D3: status filters are one ledger index strip ----------
  const tabs = await page.evaluate(() => {
    const strip = document.querySelector('[data-testid="svc-status-tabs"]');
    if (!strip) return null;
    return {
      inMb3: !!strip.closest("div.mb-3"),
      items: [...strip.querySelectorAll("button")].map((button) => ({
        text: button.textContent.replace(/\s+/g, " ").trim(),
        pressed: button.getAttribute("aria-pressed"),
        bg: getComputedStyle(button).backgroundColor,
      })),
    };
  });
  check(
    "D3a",
    "status tabs keep the exact chip text and the div.mb-3 hook",
    !!tabs &&
      tabs.inMb3 &&
      tabs.items.length === 6 &&
      tabs.items.every((item, i) => item.text === expectedTabs[i]) &&
      tabs.items[0].pressed === "true" &&
      tabs.items[0].bg === "rgb(23, 72, 216)" &&
      tabs.items.slice(1).every((item) => item.pressed === "false"),
    JSON.stringify(tabs)
  );

  await page.evaluate(() => {
    [...document.querySelectorAll('[data-testid="svc-status-tabs"] button')]
      .find((b) => b.textContent.trim().startsWith("ডেলিভারি"))
      ?.click();
  });
  await sleep(400);
  const deliveredView = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('[data-testid="daily-services"] tbody tr')].map(
      (tr) => tr.textContent
    ),
    pressed: [
      ...document.querySelectorAll('[data-testid="svc-status-tabs"] button'),
    ].map((b) => b.getAttribute("aria-pressed")),
  }));
  check(
    "D3b",
    "the strip filters to the delivered visit and marks itself pressed",
    deliveredView.pressed[4] === "true" &&
      deliveredView.pressed[0] === "false" &&
      deliveredView.rows.length === statusCount("Delivered") &&
      deliveredView.rows[0].includes(PAID_NAME),
    JSON.stringify({ rows: deliveredView.rows.length, pressed: deliveredView.pressed })
  );
  await page.evaluate(() => {
    [...document.querySelectorAll('[data-testid="svc-status-tabs"] button')]
      .find((b) => b.textContent.trim().startsWith("সব"))
      ?.click();
  });
  await sleep(400);

  // ---------- D4: rows are ledger entries with a tone edge ----------
  const tones = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "hsl(var(--maher-due))";
    document.body.appendChild(probe);
    const dueColor = getComputedStyle(probe).color;
    probe.style.color = "hsl(var(--maher-money))";
    const moneyColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      dueColor,
      moneyColor,
      rows: [...document.querySelectorAll('[data-testid="daily-services"] tbody tr')].map(
        (tr) => {
          const first = tr.children[0];
          const style = first ? getComputedStyle(first) : null;
          return {
            text: tr.textContent,
            tone: tr.getAttribute("data-tone"),
            leftWidth: style?.borderLeftWidth ?? "",
            leftColor: style?.borderLeftColor ?? "",
          };
        }
      ),
    };
  });
  const rowFor = (name) => tones.rows.find((r) => r.text.includes(name));
  const dueRow = rowFor(DUE_NAME);
  const paidRow = rowFor(PAID_NAME);
  const returnRow = rowFor(RETURN_NAME);
  check(
    "D4",
    "due, paid and returned rows carry the right tone edge",
    !!dueRow &&
      dueRow.tone === "due" &&
      dueRow.leftWidth === "3px" &&
      dueRow.leftColor === tones.dueColor &&
      paidRow?.tone === "normal" &&
      !!returnRow &&
      returnRow.tone === "returned" &&
      returnRow.leftColor === tones.moneyColor,
    JSON.stringify({
      due: dueRow?.tone,
      paid: paidRow?.tone,
      returned: returnRow?.tone,
    })
  );

  // ---------- D5: money is printed as a receipt ----------
  const money = await page.evaluate((name) => {
    const row = [...document.querySelectorAll('[data-testid="daily-services"] tbody tr')]
      .find((tr) => tr.textContent.includes(name));
    if (!row) return null;
    const box = row.querySelector('[data-testid^="svc-money-"]');
    if (!box) return null;
    const due = [...box.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && el.textContent.includes("বাকি")
    );
    return {
      text: box.textContent.replace(/\s+/g, " ").trim(),
      dueColor: due ? getComputedStyle(due).color : "",
      dueWeight: due ? getComputedStyle(due).fontWeight : "",
      fontVariant: getComputedStyle(box).fontVariantNumeric,
    };
  }, DUE_NAME);
  check(
    "D5",
    "due row money stack shows bill, deposit and a red tabular balance",
    !!money &&
      money.text.includes("বিল") &&
      money.text.includes("৳800") &&
      money.text.includes("জমা") &&
      money.text.includes("৳100") &&
      money.text.includes("বাকি") &&
      money.text.includes("৳700") &&
      money.dueWeight === "600",
    JSON.stringify(money)
  );

  // ---------- D6: 390px becomes job-ticket cards ----------
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="service-cards"]', { timeout: 20000 });
  const mobile = await page.evaluate((dueName, groupName) => {
    const section = document.querySelector('[data-testid="daily-services"]');
    const strip = document.querySelector('[data-testid="svc-status-tabs"]');
    const findCard = (name) =>
      [...document.querySelectorAll('[data-testid^="service-card-"]')].find((c) =>
        c.textContent.includes(name)
      ) || null;
    const card = findCard(dueName);
    const groupCard = [...document.querySelectorAll('[data-testid^="visit-card-"]')].find(
      (c) => c.textContent.includes(groupName)
    );
    const moneyStrip =
      card?.querySelector('[data-testid^="money-strip-"]') ||
      groupCard?.querySelector('[data-testid^="money-strip-"]');
    return {
      view: section?.dataset.view ?? null,
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      tabs: strip ? strip.querySelectorAll("button").length : 0,
      scrollable: strip ? strip.scrollWidth > strip.clientWidth : false,
      fade: !!strip?.parentElement?.querySelector("span[aria-hidden].absolute"),
      dueCardTone: card?.getAttribute("data-tone") ?? null,
      moneyStrip: moneyStrip
        ? {
            cells: moneyStrip.children.length,
            text: moneyStrip.textContent.replace(/\s+/g, " ").trim(),
          }
        : null,
      receipt: !!card?.querySelector("button[title='বিল প্রিন্ট']"),
      groupTotal: groupCard?.textContent.includes("ভিজিটের মোট") ?? false,
    };
  }, DUE_NAME, GROUP_NAME);
  check(
    "D6",
    "390px: cards keep the tone, the receipt strip, actions and no page overflow",
    mobile.view === "cards" &&
      !mobile.overflow &&
      mobile.tabs === 6 &&
      mobile.scrollable &&
      mobile.fade &&
      mobile.dueCardTone === "due" &&
      mobile.moneyStrip?.cells === 3 &&
      mobile.moneyStrip.text.includes("বিল") &&
      mobile.moneyStrip.text.includes("জমা") &&
      mobile.moneyStrip.text.includes("বাকি") &&
      mobile.receipt &&
      mobile.groupTotal,
    JSON.stringify(mobile)
  );

  // ---------- D7: search and its clear control still work ----------
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="daily-services"] tbody tr', {
    timeout: 20000,
  });
  await typeInto(page, "svc-search", PAID_NAME);
  await page.waitForFunction(
    (name) => {
      const rows = [
        ...document.querySelectorAll('[data-testid="daily-services"] tbody tr'),
      ];
      return rows.length === 1 && rows[0].textContent.includes(name);
    },
    { polling: 200, timeout: 8000 },
    PAID_NAME
  );
  const searchState = await page.evaluate(() => ({
    value: document.querySelector("#svc-search")?.value ?? "",
    placeholder:
      document.querySelector("#svc-search")?.getAttribute("placeholder") ?? "",
    clear: !!document.querySelector('[data-testid="svc-search-clear"]'),
  }));
  let restoredRows = -1;
  if (searchState.clear) {
    await page.click('[data-testid="svc-search-clear"]');
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('[data-testid="daily-services"] tbody tr').length ===
        count,
      { polling: 200, timeout: 8000 },
      visitList.length
    );
    restoredRows = await page.$$eval(
      '[data-testid="daily-services"] tbody tr',
      (rows) => rows.length
    );
  }
  check(
    "D7",
    "search keeps its id/placeholder and has a working clear button",
    searchState.value === PAID_NAME &&
      searchState.placeholder === "নাম, আইডি, ফোন বা মডেল খুঁজুন..." &&
      searchState.clear &&
      restoredRows === visitList.length,
    JSON.stringify({ searchState, restoredRows })
  );

  // ---------- D8: laptop widths keep the action palette compact ----------
  const measureActions = async (name) => {
    const info = await page.evaluate((customer) => {
      const row = [
        ...document.querySelectorAll('[data-testid="daily-services"] tbody tr'),
      ].find(
        (tr) =>
          tr.querySelector('[data-testid^="svc-money-"]') &&
          tr.textContent.includes(customer)
      );
      const cell = row?.lastElementChild;
      const tops = [
        ...(cell?.querySelectorAll("button, a[title]") || []),
      ].map((b) => Math.round(b.getBoundingClientRect().top));
      const rows = [...new Set(tops)].map(
        (top) => tops.filter((value) => value === top).length
      );
      const badge = document.querySelector('[data-testid^="visit-badge-"]');
      const wrap = document.querySelector(
        '[data-testid="daily-services"] .overflow-auto'
      );
      return {
        actions: tops.length,
        rows,
        overflow: wrap ? wrap.scrollWidth - wrap.clientWidth : -1,
        badge: badge
          ? {
              h: Math.round(badge.getBoundingClientRect().height),
              text: badge.textContent.replace(/\s+/g, " ").trim(),
            }
          : null,
      };
    }, name);
    return info;
  };
  const loadList = async () => {
    await page.goto(`${BASE}/service?date=${TODAY}`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="daily-services"] tbody tr', {
      timeout: 20000,
    });
  };

  await page.setViewport({ width: 1280, height: 900 });
  await loadList();
  const laptop = await measureActions(DUE_NAME);
  check(
    "D8",
    "1280px tiles the six row actions in two neat rows, no table overflow and the badge unbroken",
    laptop.actions === 6 &&
      laptop.rows.length === 2 &&
      laptop.rows.every((count) => count === 3) &&
      laptop.overflow <= 1 &&
      !!laptop.badge &&
      laptop.badge.h <= 24 &&
      laptop.badge.text.includes("২টি ডিভাইস"),
    JSON.stringify(laptop)
  );

  await page.setViewport({ width: 1440, height: 900 });
  await loadList();
  const wide = await measureActions(DUE_NAME);
  check(
    "D8b",
    "1440px puts the six row actions back on one line without table overflow",
    wide.actions === 6 &&
      wide.rows.length === 1 &&
      wide.rows[0] === 6 &&
      wide.overflow <= 1,
    JSON.stringify(wide)
  );

  // ---------- D9: tablets lay the job tickets out in two columns ----------
  await page.setViewport({ width: 768, height: 1024 });
  await page.goto(`${BASE}/service?date=${TODAY}`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.waitForSelector('[data-testid="service-cards"] > article', {
    timeout: 20000,
  });
  const tablet = await page.evaluate(() => {
    const grid = document.querySelector('[data-testid="service-cards"]');
    const cards = [...grid.querySelectorAll(":scope > article")].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
      };
    });
    return {
      count: cards.length,
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      cards,
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    };
  });
  check(
    "D9",
    "768px places two job tickets side by side without page overflow",
    tablet.count >= 2 &&
      tablet.columns === 2 &&
      tablet.cards[0].y === tablet.cards[1].y &&
      tablet.cards[0].x !== tablet.cards[1].x &&
      !tablet.overflow,
    JSON.stringify(tablet)
  );

  check("Z", "zero JS errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("SERVICE-LIST-DESIGN CRASH:", e.stack || e.message);
    await closeBrowser(browser);
    process.exit(1);
  });
