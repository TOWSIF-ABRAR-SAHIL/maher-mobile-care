/* Stock-room dashboard on the throwaway DB supplied by scripts/run-tests.js.
 *
 * Pins the counter-facing inventory cards, the ten-second privacy reveal,
 * lifecycle/status filters, the quick STOCK_IN ledger write, and the
 * internal-only profit preview in the product dialog.
 */
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const {
  api,
  closeBrowser,
  dhakaToday,
  launchBrowser,
  resolveTestBase,
  trackErrors,
  uniqueName,
  waitToast,
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
const bn = (n) => Number(n || 0).toLocaleString("en-IN");

async function post(page, path, body) {
  return api(page, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

(async () => {
  let browser = null;
  let db = null;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(`${BASE}/products`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    const errors = trackErrors(page);
    if (!process.env.MAHER_DB_PATH) throw new Error("MAHER_DB_PATH missing");
    db = new Database(process.env.MAHER_DB_PATH);
    db.pragma("busy_timeout = 5000");

    const category = await post(page, "/api/product-categories", {
      name: uniqueName("DashCat"),
    });
    assert.equal(category.status, 201, JSON.stringify(category.body));
    const categoryId = category.body.category.id;
    const makeProduct = async (slug, stock, threshold, price) => {
      const res = await post(page, "/api/products", {
        name: uniqueName(slug),
        categoryId,
        sellingPrice: price * 2,
        purchasePrice: price,
        openingStock: stock,
        lowStockThreshold: threshold,
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.product;
    };
    const healthy = await makeProduct("DashHealthy", 10, 2, 100);
    const low = await makeProduct("DashLow", 2, 2, 50);
    const out = await makeProduct("DashOut", 0, 2, 75);

    const summary = (await api(page, "/api/products?sort=name")).body.summary;
    check(
      "P1",
      "three seeded products give an exact inventory summary",
      summary.totalProducts === 3 &&
        summary.units === 12 &&
        summary.lowStock === 1 &&
        summary.outOfStock === 1 &&
        summary.inventoryValue === 1100,
      JSON.stringify(summary)
    );

    await page.goto(`${BASE}/products`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="product-metrics"]', {
      timeout: 20000,
    });
    const metrics = await page.evaluate(() => ({
      total: document
        .querySelector('[data-testid="product-metric-total"]')
        ?.textContent.trim(),
      stock: document
        .querySelector('[data-testid="product-metric-stock"]')
        ?.textContent.trim(),
      low: document
        .querySelector('[data-testid="product-metric-low"]')
        ?.textContent.trim(),
      masked: document
        .querySelector('[data-testid="product-value-hidden"]')
        ?.textContent.trim(),
      revealedEarly: !!document.querySelector(
        '[data-testid="product-value-revealed"]'
      ),
    }));
    check(
      "P2",
      "metric cards mirror the whole inventory with the value masked",
      metrics.total?.includes(`${bn(3)}টি আইটেম`) === true &&
        metrics.stock?.includes(`${bn(12)} পিস`) === true &&
        metrics.low?.includes(`${bn(1)}টি আইটেম`) === true &&
        metrics.masked === "৳••••" &&
        metrics.revealedEarly === false,
      JSON.stringify(metrics)
    );

    await page.click('[data-testid="product-value-toggle"]');
    await page.waitForSelector('[data-testid="product-value-revealed"]', {
      timeout: 5000,
    });
    const revealed = await page.$eval(
      '[data-testid="product-value-revealed"]',
      (el) => el.textContent.trim()
    );
    check(
      "P3",
      "the eye reveals the real internal valuation",
      revealed === `৳${bn(1100)}`,
      revealed
    );
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="product-value-hidden"]'),
      { polling: 250, timeout: 14000 }
    );
    check("P4", "the valuation re-masks itself after ten seconds", true);

    const chips = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[aria-label="স্টক স্ট্যাটাস ফিল্টার"] button'
        ),
      ].map((b) => ({
        id: b.getAttribute("data-testid"),
        label: b.childNodes[0].textContent.trim(),
        count: b.querySelector("span")?.textContent.trim(),
      }))
    );
    check(
      "P5",
      "one status chip strip shows all four lifecycle states with counts",
      JSON.stringify(chips) ===
        JSON.stringify([
          { id: "product-status-all", label: "সব প্রোডাক্ট", count: "3" },
          { id: "product-status-in", label: "পর্যাপ্ত স্টক", count: "1" },
          { id: "product-status-low", label: "⚠️ কম স্টক", count: "1" },
          { id: "product-status-out", label: "❌ স্টক শেষ", count: "1" },
        ]),
      JSON.stringify(chips)
    );

    const rowCount = () =>
      page.evaluate(() => document.querySelectorAll("tbody tr").length);
    const filterBy = async (id) => {
      await page.click(`[data-testid="${id}"]`);
      await new Promise((r) => setTimeout(r, 400));
      return rowCount();
    };
    const allRows = await rowCount();
    const inRows = await filterBy("product-status-in");
    const lowRows = await filterBy("product-status-low");
    const outRows = await filterBy("product-status-out");
    check(
      "P6",
      "each status chip filters the table to its own rows",
      allRows === 3 && inRows === 1 && lowRows === 1 && outRows === 1,
      JSON.stringify({ allRows, inRows, lowRows, outRows })
    );

    await page.click('[data-testid="product-status-all"]');
    await new Promise((r) => setTimeout(r, 400));
    await page.click('[data-testid="product-metric-low"]');
    await new Promise((r) => setTimeout(r, 400));
    const lowCard = await page.evaluate(() => ({
      pressed: document
        .querySelector('[data-testid="product-status-low"]')
        ?.getAttribute("aria-pressed"),
      rows: document.querySelectorAll("tbody tr").length,
    }));
    check(
      "P7",
      "clicking the low-stock card jumps straight to the low-stock filter",
      lowCard.pressed === "true" && lowCard.rows === 1,
      JSON.stringify(lowCard)
    );

    await page.click('[data-testid="product-status-all"]');
    await new Promise((r) => setTimeout(r, 400));
    const rowUi = await page.evaluate(
      ({ lowName, outName, lowId, outId }) => {
        const find = (name) =>
          [...document.querySelectorAll("tbody tr")].find((tr) =>
            tr.textContent.includes(name)
          );
        const lowRow = find(lowName);
        const outRow = find(outName);
        const cell = (row) => row?.querySelector("td:nth-child(3)");
        return {
          categoryClass:
            lowRow?.querySelector(`[data-testid="product-category-${lowId}"]`)
              ?.className ?? null,
          lowBadge: cell(lowRow)?.textContent.includes("কম স্টক") ?? false,
          outBadge: cell(outRow)?.textContent.includes("স্টক শেষ") ?? false,
          quickLow: !!cell(lowRow)?.querySelector(
            `[data-testid="product-stock-add-${lowId}"]`
          ),
          quickOut: !!cell(outRow)?.querySelector(
            `[data-testid="product-stock-add-${outId}"]`
          ),
        };
      },
      { lowName: low.name, outName: out.name, lowId: low.id, outId: out.id }
    );
    check(
      "P8",
      "category chips, status badges and inline quick-add live in the stock cell",
      /rounded-md/.test(rowUi.categoryClass ?? "") &&
        /bg-slate-100/.test(rowUi.categoryClass ?? "") &&
        rowUi.lowBadge &&
        rowUi.outBadge &&
        rowUi.quickLow &&
        rowUi.quickOut,
      JSON.stringify(rowUi)
    );

    // ---- P14–P16: unified toolbar, card micro-icons and empty states ------
    const toolbar = await page.evaluate(() => {
      const box = (sel) => document.querySelector(sel);
      const rect = (el) => el?.getBoundingClientRect();
      const search = box('[data-testid="product-search"]');
      const bar = box('[data-testid="product-filter-bar"]');
      const select = box('[aria-label="ক্যাটাগরি ফিল্টার"]');
      const chips = box('[aria-label="স্টক স্ট্যাটাস ফিল্টার"]');
      const actions = box('[data-testid="page-actions"]');
      const badge = box('[data-testid="product-count-badge"]');
      const title = [...document.querySelectorAll("h1")].find((el) =>
        el.textContent.includes("প্রোডাক্ট ও ইনভেন্টরি")
      );
      return {
        searchInBar: !!bar && !!search && bar.contains(search),
        selectInBar: !!bar && !!select && bar.contains(select),
        searchId: search?.id ?? null,
        searchTestid: search?.getAttribute("data-testid") ?? null,
        sameLine:
          !!rect(search) &&
          !!rect(select) &&
          Math.abs(rect(search).top - rect(select).top) <= 8,
        barAboveChips: !!rect(bar) && !!rect(chips) && rect(bar).bottom <= rect(chips).top,
        titleAboveBar: !!rect(title) && !!rect(bar) && rect(title).bottom <= rect(bar).top,
        actionsHasSearch: !!actions && !!search && actions.contains(search),
        actionLabels: [...(actions?.querySelectorAll("button") ?? [])].map((b) =>
          b.textContent.replace(/\s+/g, " ").trim()
        ),
        actionsRight: rect(actions)?.right ?? null,
        mainRight: rect(document.querySelector("main"))?.right ?? null,
        badgeText: badge?.textContent.replace(/\s+/g, " ").trim() ?? "",
        badgeLeft: rect(badge)?.left ?? null,
        titleLeft: rect(title)?.left ?? null,
      };
    });
    check(
      "P14",
      "search and category sit in one toolbar above the chips, actions stay on the right",
      toolbar.searchInBar &&
        toolbar.selectInBar &&
        toolbar.searchId === "product-search" &&
        toolbar.searchTestid === "product-search" &&
        toolbar.sameLine &&
        toolbar.barAboveChips &&
        toolbar.titleAboveBar &&
        !toolbar.actionsHasSearch &&
        toolbar.actionLabels.length === 2 &&
        toolbar.actionLabels.some((t) => t.includes("ক্যাটাগরি ব্যবস্থাপনা")) &&
        toolbar.actionLabels.some((t) => t.includes("নতুন প্রোডাক্ট")) &&
        Math.abs(toolbar.mainRight - toolbar.actionsRight) <= 24 &&
        toolbar.badgeText.includes("3টি প্রোডাক্ট") &&
        Math.abs(toolbar.badgeLeft - toolbar.titleLeft) <= 220,
      JSON.stringify(toolbar)
    );

    const cards = await page.evaluate(() => {
      const icon = (name, cardId) => {
        const el = document.querySelector(
          `[data-testid="product-metric-icon-${name}"]`
        );
        const card = document.querySelector(`[data-testid="${cardId}"]`);
        if (!el || !card) return null;
        const c = card.getBoundingClientRect();
        const i = el.getBoundingClientRect();
        return {
          cls: el.className,
          svg: !!el.querySelector("svg"),
          topRight: i.right > c.left + c.width * 0.6 && i.top < c.top + c.height * 0.5,
        };
      };
      const eye = document.querySelector('[data-testid="product-value-toggle"]');
      const low = document.querySelector('[data-testid="product-metric-low"]');
      return {
        total: icon("total", "product-metric-total"),
        stock: icon("stock", "product-metric-stock"),
        low: icon("low", "product-metric-low"),
        value: icon("value", "product-metric-value"),
        lowBorder: low?.className ?? "",
        eyeTitle: eye?.getAttribute("title") ?? "",
        eyeLabel: eye?.getAttribute("aria-label") ?? "",
      };
    });
    check(
      "P15",
      "four cards carry corner micro-icons and the eye explains its ten-second reveal",
      cards.total?.svg &&
        cards.total.cls.includes("text-blue-") &&
        cards.total.topRight &&
        cards.stock?.svg &&
        cards.stock.cls.includes("text-emerald-") &&
        cards.stock.topRight &&
        cards.low?.svg &&
        cards.low.cls.includes("text-amber-") &&
        cards.low.topRight &&
        cards.value?.svg &&
        cards.value.cls.includes("text-slate-") &&
        cards.value.topRight &&
        cards.lowBorder.includes("border-maher-warning") &&
        cards.eyeTitle ===
          "দোকানের ক্রয়মূল্য ও ইনভেন্টরি মূল্য দেখুন (১০ সেকেন্ড)" &&
        cards.eyeLabel.includes("ইনভেন্টরি মূল্য"),
      JSON.stringify(cards)
    );

    await page.type(
      '[data-testid="product-search"]',
      "ZzzNoSuchProductInShop"
    );
    await page.waitForSelector('[data-testid="product-empty-filtered"]', {
      timeout: 10000,
    });
    const filteredEmpty = await page.evaluate(() => ({
      text: (
        document.querySelector('[data-testid="product-empty-filtered"]')
          ?.textContent ?? ""
      ).replace(/\s+/g, " "),
      resetText:
        document
          .querySelector('[data-testid="product-empty-reset"]')
          ?.textContent.replace(/\s+/g, " ")
          .trim() ?? "",
    }));
    check(
      "P16",
      "an empty filtered view explains itself and resets search and category",
      filteredEmpty.text.includes("কোনো প্রোডাক্ট খুঁজে পাওয়া যায়নি") &&
        filteredEmpty.resetText.includes("ফিল্টার রিসেট করুন"),
      JSON.stringify(filteredEmpty)
    );
    await page.click('[data-testid="product-empty-reset"]');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="product-search"]')?.value === "" &&
        document.querySelectorAll("tbody tr").length === 3,
      { polling: 100, timeout: 10000 }
    );

    await page.click(`[data-testid="product-stock-add-${out.id}"]`);
    await page.waitForSelector('[data-testid="quick-stock-dialog"]', {
      timeout: 8000,
    });
    const prompt = await page.$eval(
      '[data-testid="quick-stock-dialog"]',
      (el) => el.textContent
    );
    await page.type('[data-testid="quick-stock-qty"]', "5");
    await page.click('[data-testid="quick-stock-confirm"]');
    await waitToast(page, "5 পিস স্টকে যোগ হয়েছে");
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="quick-stock-dialog"]'),
      { polling: 200, timeout: 10000 }
    );
    // The stock cell must refresh in place — the API/DB assertion below cannot
    // catch a regression that drops the parent's await load() after quick-add.
    await page.waitForFunction(
      (name) => {
        const row = [...document.querySelectorAll("tbody tr")].find((tr) =>
          tr.textContent.includes(name)
        );
        return !!row && /5\s*পিস/.test(row.querySelector("td:nth-child(3)")?.textContent || "");
      },
      { polling: 200, timeout: 10000 },
      out.name
    );
    const domStock = await page.evaluate((name) => {
      const row = [...document.querySelectorAll("tbody tr")].find((tr) =>
        tr.textContent.includes(name)
      );
      return row?.querySelector("td:nth-child(3)")?.textContent || "";
    }, out.name);
    const after = (await api(page, `/api/products/${out.id}`)).body.product;
    const movement = db
      .prepare(
        "SELECT * FROM StockMovement WHERE productId = ? AND movementType = 'STOCK_IN' AND refType = 'RESTOCK' ORDER BY id DESC LIMIT 1"
      )
      .get(out.id);
    check(
      "P9",
      "quick add increments stock and writes exactly one STOCK_IN movement",
      prompt.includes("কত পিস যোগ করবেন?") &&
        after.stock === 5 &&
        after.status === "in" &&
        movement?.quantity === 5 &&
        movement?.previousStock === 0 &&
        movement?.newStock === 5 &&
        movement?.reason === "কুইক স্টক ইন" &&
        /5\s*পিস/.test(domStock),
      JSON.stringify({ stock: after.stock, status: after.status, movement, domStock })
    );

    await page.click(`[data-testid="product-stock-add-${low.id}"]`);
    await page.waitForSelector('[data-testid="quick-stock-qty"]', {
      timeout: 8000,
    });
    await page.type('[data-testid="quick-stock-qty"]', "0");
    await page.click('[data-testid="quick-stock-confirm"]');
    await page.waitForFunction(
      () => document.body.textContent.includes("সঠিক সংখ্যা দিন"),
      { polling: 200, timeout: 6000 }
    );
    const unchanged = (await api(page, `/api/products/${low.id}`)).body.product
      .stock;
    check(
      "P10",
      "a zero/blank quick-add is rejected without touching stock",
      unchanged === 2,
      String(unchanged)
    );
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));

    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((b) => b.textContent.includes("নতুন প্রোডাক্ট"))
        ?.click();
    });
    await page.waitForSelector('[data-testid="product-selling"]', {
      timeout: 8000,
    });
    await page.type('[data-testid="product-selling"]', "500");
    await page.type('[data-testid="product-purchase"]', "300");
    const preview = await page.$eval(
      '[data-testid="product-profit-preview"]',
      (el) => el.textContent.replace(/\s+/g, " ").trim()
    );
    const grid = await page.$eval("form.grid", (el) => el.className);
    check(
      "P11",
      "the product dialog previews profit and margin in a two-column grid",
      preview === "💡 আনুমানিক লাভ: ৳200 (40%)" &&
        grid.includes("sm:grid-cols-2"),
      JSON.stringify({ preview, grid })
    );
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 300));

    const responsive = [];
    for (const width of [1280, 820]) {
      await page.setViewport({ width, height: 800 });
      await page.goto(`${BASE}/products`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForSelector('[data-testid="product-metrics"]', {
        timeout: 20000,
      });
      responsive.push(
        await page.evaluate((w) => {
          const doc = document.documentElement;
          return {
            width: w,
            overflow: doc.scrollWidth - doc.clientWidth,
            metrics: !!document.querySelector('[data-testid="product-metrics"]'),
            list: !!document.querySelector('[data-testid="products-list"]'),
          };
        }, width)
      );
    }
    check(
      "P12",
      "metric strip and list stay visible without horizontal overflow at 1280/820",
      responsive.every(
        (r) => r.overflow <= 0 && r.metrics && r.list
      ),
      JSON.stringify(responsive)
    );

    // ---- P18: a real product sale debits tracked stock and logs SALE ------
    const stockBeforeSale = (
      await api(page, `/api/products/${healthy.id}`)
    ).body.product.stock;
    const sale = await post(page, "/api/services", {
      customerName: uniqueName("StockSale"),
      phone: "01700000099",
      serviceDate: dhakaToday(),
      products: [{ productId: healthy.id, quantity: 2 }],
    });
    const stockAfterSale = (
      await api(page, `/api/products/${healthy.id}`)
    ).body.product.stock;
    const saleMovement = db
      .prepare(
        "SELECT * FROM StockMovement WHERE productId = ? AND movementType = 'SALE' ORDER BY id DESC LIMIT 1"
      )
      .get(healthy.id);
    check(
      "P18",
      "a product sale deducts tracked stock and writes a SALE movement",
      sale.ok &&
        stockBeforeSale === 10 &&
        stockAfterSale === 8 &&
        saleMovement?.quantity === -2 &&
        saleMovement?.previousStock === 10 &&
        saleMovement?.newStock === 8,
      JSON.stringify({
        status: sale.status,
        before: stockBeforeSale,
        after: stockAfterSale,
        movement: saleMovement,
      })
    );

    // ---- P17: a genuinely empty shop gets onboarding, not a failed search --
    const seeded = (await api(page, "/api/products?sort=name")).body.products;
    for (const product of seeded) {
      const archived = await api(page, `/api/products/${product.id}`, {
        method: "DELETE",
      });
      if (!archived.ok) {
        throw new Error("archive failed: " + JSON.stringify(archived.body));
      }
    }
    await page.goto(`${BASE}/products`, {
      waitUntil: "networkidle2",
      timeout: 60000,
    });
    await page.waitForSelector('[data-testid="product-empty-onboarding"]', {
      timeout: 10000,
    });
    const onboarding = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="product-empty-onboarding"]');
      const masthead = document.querySelector('[data-testid="page-actions"]');
      return {
        text: (box?.textContent ?? "").replace(/\s+/g, " "),
        mastheadCategory: [...(masthead?.querySelectorAll("button") ?? [])].some(
          (b) => b.textContent.includes("ক্যাটাগরি ব্যবস্থাপনা")
        ),
      };
    });
    check(
      "P17",
      "a true zero-product shop shows onboarding and keeps the category manager reachable",
      onboarding.text.includes(
        "আপনার স্টকে এখনো কোনো প্রোডাক্ট যুক্ত করা হয়নি"
      ) &&
        onboarding.text.includes(
          "প্রথমে একটি ক্যাটাগরি তৈরি করে আপনার মালামাল যুক্ত করা শুরু করুন"
        ) &&
        onboarding.mastheadCategory,
      JSON.stringify(onboarding)
    );

    check(
      "P13",
      "no browser errors on the stock-room screens",
      errors.length === 0,
      JSON.stringify(errors)
    );
  } catch (err) {
    check("P-FATAL", "suite completed without throwing", false, err.stack || String(err));
  } finally {
    if (db) db.close();
    await closeBrowser(browser);
    console.log(results.join("\n"));
    console.log(`\n${results.length - (failed ? 1 : 0)}/${results.length} checks passed`);
    process.exitCode = failed ? 1 : 0;
  }
})();
