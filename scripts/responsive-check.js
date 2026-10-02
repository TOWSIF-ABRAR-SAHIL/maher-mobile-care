/* Responsive regression: no page-level horizontal overflow at key widths.
 * Run directly only against MAHER_TEST_URL (npm test sets it).
 */
const { launchBrowser, resolveTestBase, trackErrors } = require("./test-support");

const BASE = resolveTestBase();
const failures = [];

function check(id, name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures.push(id);
}

async function main() {
  const browser = await launchBrowser();
  try {
    for (const width of [360, 768, 1024]) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width, height: 900 });
        const errors = trackErrors(page);
        await page.goto(BASE, { waitUntil: "networkidle0", timeout: 60000 });
        await page.waitForFunction(
          () => document.body.textContent.includes("টেকনিশিয়ান অনুযায়ী"),
          { polling: 500, timeout: 30000 }
        );
        await new Promise((r) => setTimeout(r, 1200));
        const overflow = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        check(
          `R${width}`,
          `${width}px has no horizontal page overflow`,
          overflow.scrollWidth <= overflow.clientWidth + 1,
          JSON.stringify(overflow)
        );
        check(`E${width}`, `${width}px has zero JS errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
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
