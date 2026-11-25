/* Offline licensing contract — isolated suite.
 *
 * Runs only on the throwaway server/database supplied by scripts/run-tests.js.
 * The private key is read by the ADMIN keygen tool only; this suite uses it to
 * mint deterministic test keys, then proves the client accepts nothing that is
 * not signed for the exact machine ID reported by /api/license/status.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const {
  api,
  closeBrowser,
  launchBrowser,
  requireTestEnv,
  resolveTestBase,
  trackErrors,
  waitToast,
} = require("./test-support");

requireTestEnv();

const ROOT = path.resolve(__dirname, "..");
const BASE = resolveTestBase();
const PRIVATE_KEY_FILE = path.join(ROOT, "tools", "keygen-crm", "keys", "private.pem");
const PRIVATE_PEM = fs.readFileSync(PRIVATE_KEY_FILE, "utf8");
const CLOCK_MESSAGE =
  "কম্পিউটারের তারিখ ও সময় পরিবর্তন শনাক্ত হয়েছে। অনুগ্রহ করে সঠিক সময় ঠিক করুন।";
const SUPPORT_BAR = "লাইসেন্স পেতে যোগাযোগ করুন: 01533315357 (WhatsApp)";
const DAY_MS = 24 * 60 * 60 * 1000;
const TIER_DAYS = { "1_YEAR": 365, "2_YEARS": 730, "3_YEARS": 1095 };
const TIER_LABELS = {
  "1_YEAR": "১ বছর মেয়াদী",
  "2_YEARS": "২ বছর মেয়াদী",
  "3_YEARS": "৩ বছর মেয়াদী",
  LIFETIME: "লাইফটাইম আনলিমিটেড",
};
// Action-hub copy is a UI contract: the CTA must follow the tier, not merely
// the active/paid verdict. Keep these strings in sync with LicenseCard.tsx.
const CTA = {
  trial: "🚀 ফুল ভার্সনে আপগ্রেড করুন / লাইসেন্স কি দিন",
  trialSupport: "💬 WhatsApp-এ কি সংগ্রহ করুন: 01533315357",
  multiYear: "🔄 মেয়াদের সময় বাড়ান / এক্সটেন্ড করুন",
  extendHint:
    "নতুন কি যোগ করলে আপনার বর্তমান মেয়াদের শেষে অতিরিক্ত মেয়াদ স্বয়ংক্রিয়ভাবে যোগ হবে।",
  lifetimePill: "💎 লাইসেন্স সক্রিয় — আজীবন ব্যবহারের নিশ্চয়তা",
  lifetimeNote:
    "আপনার সফটওয়ারটি স্থায়ীভাবে সক্রিয় আছে। কোনো বাৎসরিক ফি বা অতিরিক্ত রিনিউয়াল কি প্রয়োজন নেই।",
  lifetimeChange: "⚙️ লাইসেন্স কি পরিবর্তন / আপডেট করুন",
  vendorHref: "https://wa.me/8801533315357",
  vendorNumber: "01533315357",
  locked: "🚨 সফটওয়ার আনলক করতে লাইসেন্স কি দিন",
};

const results = [];
let failed = false;
const check = (id, name, ok, extra = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failed = true;
};

async function send(page, method, url, body) {
  return api(page, url.startsWith("http") ? url : `${BASE}${url}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

function signLicense(payload) {
  const privateKey = fs.readFileSync(PRIVATE_KEY_FILE, "utf8");
  const part = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .sign(null, Buffer.from(part, "utf8"), privateKey)
    .toString("base64url");
  return `MHR-KEY-${part}.${signature}`;
}

function basePayload(machineId, type, expiresAt) {
  return {
    machineId,
    shopName: "MAHER MOBILE CARE",
    type,
    issuedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt,
  };
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

/** React-aware input fill: the native setter makes onChange fire in Puppeteer. */
function toBn(value) {
  return String(value).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
}

async function setInput(page, testid, value) {
  await page.$eval(
    `[data-testid="${testid}"]`,
    (el, next) => {
      el.focus();
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set.call(el, next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

async function waitChip(page, state) {
  return page
    .waitForSelector(`[data-testid="license-key-preview"][data-preview-state="${state}"]`, {
      timeout: 10000,
    })
    .then((el) => el.evaluate((node) => node.textContent))
    .catch(() => "");
}

async function stubClipboard(page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__licenseCopied = text;
        },
      },
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForUrl(url, child, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child && child.exitCode !== null) throw new Error("keygen GUI exited early");
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`keygen GUI did not become ready: ${url}`);
}

let browser = null;

(async () => {
  browser = await launchBrowser();
  const page = await browser.newPage();
  const errors = trackErrors(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="license-status-badge"]')?.textContent ||
        "").includes("ফ্রি ট্রায়াল"),
    { polling: 200, timeout: 15000 }
  );
  await stubClipboard(page);

  // ---------- A. Machine fingerprint + trial bootstrap ----------
  const first = await send(page, "GET", "/api/license/status");
  const status = first.body || {};
  const machineId = status.machineId || "";
  check(
    "A1",
    "GET /api/license/status returns a stable MHR hardware ID",
    first.ok && /^MHR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(machineId),
    JSON.stringify(status)
  );
  const second = await send(page, "GET", "/api/license/status");
  check(
    "A2",
    "machine ID is identical across repeated reads",
    second.ok && second.body?.machineId === machineId
  );
  check(
    "A2b",
    "hardware fingerprint uses the deterministic MHR-XXXX-XXXX-XXXX-XXXX format",
    /^MHR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(machineId),
    machineId
  );

  // ---------- A-HW. Root-level shop/hardware decoupling ----------
  const hardwarePaths = [
    path.join(ROOT, "lib", "licensing", "hardware.ts"),
    path.join(ROOT, "lib", "licensing", "machine-id.ts"),
  ];
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const hardwareSources = hardwarePaths.map((file) =>
    fs.existsSync(file) ? stripComments(fs.readFileSync(file, "utf8")) : ""
  );
  const forbiddenFingerprintRefs = [
    "shopName", "ShopProfile", "ShopSettings", "localStorage",
    "sessionStorage", "prisma", "database",
  ];
  check(
    "A-HW1",
    "fingerprint modules read only hardware: no shop, browser storage or DB references",
    hardwareSources.every((src) => src.length > 0) &&
      hardwareSources.every(
        (src) => !forbiddenFingerprintRefs.some((token) => src.includes(token))
      ),
    JSON.stringify({
      files: hardwarePaths.map((file) => path.relative(ROOT, file)),
      sizes: hardwareSources.map((src) => src.length),
    })
  );
  const directFingerprint = () => {
    try {
      return execFileSync(
        process.execPath,
        [
          path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
          "-e",
          `import("${pathToFileURL(hardwarePaths[0]).href}").then((m) => process.stdout.write(m.getMachineFingerprint()))`,
        ],
        { cwd: ROOT, encoding: "utf8", timeout: 20000 }
      ).trim();
    } catch (error) {
      return `ERROR: ${error?.message ?? error}`;
    }
  };
  const coldFingerprint = directFingerprint();
  check(
    "A-HW2",
    "cold install: getMachineFingerprint() returns an MHR ID with no shop data present",
    /^MHR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(coldFingerprint) &&
      coldFingerprint === machineId,
    coldFingerprint
  );
  check(
    "A-HW3",
    "getMachineFingerprint() is deterministic across independent processes",
    /^MHR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(coldFingerprint) &&
      directFingerprint() === coldFingerprint,
    coldFingerprint
  );

  // Physical hardware lock: one batched PowerShell process, four real CIM
  // classes, marker parsing, and the "|" seed separator.
  const fingerprintSource = hardwareSources[1];
  const cimClasses = [
    "Win32_ComputerSystemProduct",
    "Win32_BaseBoard",
    "Win32_Processor",
    "Win32_BIOS",
  ];
  check(
    "A-HW5",
    "fingerprint reads all four hardware classes in one batched CIM script",
    cimClasses.every((name) => fingerprintSource.includes(name)) &&
      fingerprintSource.includes("$(try") &&
      fingerprintSource.includes("__MAHER_CIM__") &&
      (fingerprintSource.match(/powershell\.exe/g) || []).length === 1 &&
      fingerprintSource.includes('.join("|")'),
    JSON.stringify({
      classes: cimClasses.filter((name) => fingerprintSource.includes(name)),
      spawnSites: (fingerprintSource.match(/powershell\.exe/g) || []).length,
    })
  );
  if (process.platform === "win32") {
    const expressions = [
      "(Get-CimInstance Win32_ComputerSystemProduct -Property UUID).UUID",
      "(Get-CimInstance Win32_BaseBoard -Property SerialNumber).SerialNumber",
      "(Get-CimInstance Win32_Processor -Property ProcessorId | Select-Object -First 1).ProcessorId",
      "(Get-CimInstance Win32_BIOS -Property SerialNumber).SerialNumber",
    ];
    const script = expressions
      .map(
        (expression, index) =>
          `Write-Output ('__MAHER_CIM__${index}=' + $(try { ${expression} } catch { '' }))`
      )
      .join("; ");
    let rawHardware = "";
    try {
      rawHardware = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
      );
    } catch {
      rawHardware = "";
    }
    const hardwareParts = expressions.map((_, index) => {
      const match = new RegExp(`__MAHER_CIM__${index}=(.*)`, "m").exec(rawHardware);
      return String(match?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
    });
    const placeholder = /^(NONE|N\/A|NA|NULL|UNKNOWN|DEFAULT|TO BE FILLED BY O\.E\.M\.|0{4,})$/i;
    const derivedDigest = crypto
      .createHash("sha256")
      .update(hardwareParts.join("|"), "utf8")
      .digest("hex")
      .slice(0, 16)
      .toUpperCase();
    const derivedId = `MHR-${derivedDigest.slice(0, 4)}-${derivedDigest.slice(4, 8)}-${derivedDigest.slice(8, 12)}-${derivedDigest.slice(12, 16)}`;
    check(
      "A-HW6",
      "all four genuine CIM hardware values are present and hash to the reported machine ID",
      hardwareParts.every((part) => part.length > 0 && !placeholder.test(part)) &&
        derivedId === machineId,
      JSON.stringify({ hardwareParts, derivedId, machineId })
    );
  } else {
    check("A-HW6", "CIM hardware lock is Windows-only (skipped on this platform)", true);
  }
  // An empty name is the uninitialised cold-install case (no successful save).
  const shopNameProbes = ["", "MAHER MOBILE CARE", "মায়ের দোয়া টেলিকম", "🌿 Élan & Co. — 简单"];
  const shopProbeIds = [];
  for (const name of shopNameProbes) {
    if (name) {
      const saved = await send(page, "PUT", "/api/shop-settings", {
        shopName: name,
        phone: "01799999999",
        address: "Nabinagar, Ashulia",
      });
      if (!saved.ok) shopProbeIds.push(`SAVE_ERROR:${saved.status}`);
    }
    const probe = await send(page, "GET", "/api/license/status");
    shopProbeIds.push(probe.body?.machineId ?? "MISSING");
  }
  check(
    "A-HW4",
    "changing, clearing and special-character shop names never alter the machine ID",
    shopProbeIds.length === shopNameProbes.length &&
      shopProbeIds.every((id) => id === machineId),
    JSON.stringify({ names: shopNameProbes, ids: shopProbeIds })
  );
  const trialPurchase = await page.evaluate(() => {
    const link = document.querySelector('[data-testid="license-trial-purchase-link"]');
    return { href: link?.getAttribute("href") ?? "", text: link?.textContent ?? "" };
  });
  check(
    "A-VENDOR",
    "trial purchase CTA uses the permanent vendor hotline, never the shop placeholder",
    trialPurchase.href.startsWith(CTA.vendorHref) &&
      trialPurchase.text.includes(CTA.vendorNumber) &&
      !trialPurchase.text.includes("01717777755"),
    JSON.stringify(trialPurchase)
  );
  check(
    "A3",
    "fresh install starts inside the 30-day free trial and is unlocked",
    status.status === "TRIAL" &&
      status.active === true &&
      Number(status.trialDaysRemaining) >= 29 &&
      Number(status.trialDaysRemaining) <= 30,
    JSON.stringify({ status: status.status, days: status.trialDaysRemaining })
  );
  const trialBadge = await page
    .$eval('[data-testid="license-status-badge"]', (el) => el.textContent)
    .catch(() => "");
  check(
    "A4",
    "single header badge carries the 30-day countdown; no duplicate inner strip",
    (trialBadge || "").includes(`● ফ্রি ট্রায়াল: ${toBn(status.trialDaysRemaining)} দিন বাকি`) &&
      !(await page.$('[data-testid="license-trial-banner"]')),
    trialBadge
  );
  check(
    "A5",
    "dashboard subscription card is present with badge and renewal button",
    !!(await page.$('[data-testid="license-status-badge"]')) &&
      !!(await page.$('[data-testid="btn-open-license-modal"]')) &&
      !!(await page.$('[data-testid="license-renew-btn"]')) &&
      !!(await page.$('[data-testid="license-copy-machine-id"]'))
  );
  const trialActionsText = await page
    .$eval('[data-testid="license-card"]', (el) => el.innerText)
    .catch(() => "");
  check(
    "A5a",
    "TRIAL action hub offers the upgrade CTA and a dedicated purchase link",
    trialActionsText.includes(CTA.trial) &&
      trialActionsText.includes(CTA.trialSupport) &&
      !!(await page.$('[data-testid="license-renew-btn"]')) &&
      !!(await page.$('[data-testid="btn-open-license-modal"]')) &&
      !(await page.$('[data-testid="license-lifetime-pill"]')),
    trialActionsText.slice(-320)
  );
  const trialProgress = await page
    .$eval('[data-testid="license-progress-bar"]', (el) => ({
      now: Number(el.getAttribute("aria-valuenow")),
      width: el.querySelector('[data-testid="license-progress-fill"]')?.style.width || "",
    }))
    .catch(() => null);
  check(
    "A6",
    "trial progress bar renders a nearly-full remaining-time fill",
    !!trialProgress &&
      Number.isFinite(trialProgress.now) &&
      trialProgress.now >= 95 &&
      /^\d+(\.\d+)?%$/.test(trialProgress.width),
    JSON.stringify(trialProgress)
  );
  await page.click('[data-testid="btn-copy-license-machine-id"]');
  const copyFeedback = await page
    .waitForSelector('[data-testid="license-copy-feedback"]', { timeout: 4000 })
    .then((el) => el.evaluate((node) => node.textContent))
    .catch(() => "");
  check(
    "A7",
    "machine ID copy shows the ✓ কপি হয়েছে! tooltip",
    (copyFeedback || "").includes("✓ কপি হয়েছে!"),
    copyFeedback
  );
  check(
    "A8",
    "trial state exposes explicit isExpired/unlimited flags and a 30-day term",
    status.isExpired === false &&
      status.unlimited === false &&
      Number(status.totalDays) === 30,
    JSON.stringify({
      isExpired: status.isExpired,
      unlimited: status.unlimited,
      totalDays: status.totalDays,
    })
  );
  const hub = await page
    .$eval('[data-testid="license-card"]', (el) => ({
      className: el.className,
      text: el.innerText,
    }))
    .catch(() => ({ className: "", text: "" }));
  check(
    "A9",
    "hub uses the dashboard white/light card surface",
    ["bg-white", "border-slate-200/80", "text-slate-800", "rounded-2xl", "shadow-sm"].every(
      (name) => hub.className.includes(name)
    ),
    hub.className
  );
  check(
    "A10",
    "hub shows the offline subtitle and the exact 3-step workflow",
    hub.text.includes("অফলাইন সিকিউরড অ্যাক্টিভেশন সিস্টেম") &&
      [
        "১. মেশিন আইডি কপি করুন",
        "২. হোয়াটসঅ্যাপে কি সংগ্রহ করুন",
        "৩. সফটওয়ার সক্রিয় করুন",
      ].every((step) => hub.text.includes(step)),
    hub.text.slice(0, 260)
  );
  check(
    "A11",
    "information grid uses the requested Bengali field labels",
    ["নিবন্ধিত প্রতিষ্ঠান", "লাইসেন্স টাইপ", "মেয়াদ উত্তীর্ণের তারিখ", "অবশিষ্ট সময়"].every(
      (label) => hub.text.includes(label)
    ),
    hub.text.slice(0, 260)
  );
  const supportHref = await page
    .$eval('[data-testid="license-support-link"]', (el) => el.getAttribute("href"))
    .catch(() => "");
  check(
    "A12",
    "WhatsApp support link prefills the current machine ID",
    (supportHref || "").startsWith("https://wa.me/8801533315357") &&
      decodeURIComponent(supportHref || "").includes(machineId),
    supportHref
  );
  await new Promise((resolve) => setTimeout(resolve, 2700));
  check(
    "A13",
    "copy tooltip clears after the 2.5-second feedback window",
    !(await page.$('[data-testid="license-copy-feedback"]'))
  );
  const expiryText = await page
    .$eval('[data-testid="license-expiry-date"]', (el) => el.textContent)
    .catch(() => "");
  const expectedExpiry = new Intl.DateTimeFormat("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(status.expiresAt));
  const expirySpan = Date.parse(status.expiresAt) - Date.now();
  check(
    "A14",
    "expiry renders the authoritative Asia/Dhaka date in Bengali, ~30 days out",
    (expiryText || "").trim() === expectedExpiry &&
      expirySpan > 25 * DAY_MS &&
      expirySpan < 31 * DAY_MS,
    JSON.stringify({ expiryText, expectedExpiry, days: expirySpan / DAY_MS })
  );

  // A legacy install created before the 30-day default shipped carries a
  // 15-day trialEndsAt. It must be upgraded once on read so the card and the
  // Bengali expiry agree with the configured term — no hand-edited state file.
  const legacyPatch = await send(page, "POST", "/api/license/test", {
    reset: true,
    trialEndsAt: new Date(Date.now() + 15 * DAY_MS).toISOString(),
  });
  const legacyStatus = (await send(page, "GET", "/api/license/status")).body || {};
  const legacyTerm =
    Date.parse(legacyStatus.expiresAt) - Date.parse(legacyStatus.issuedAt);
  check(
    "A15",
    "legacy 15-day active trial is migrated once to the configured 30-day term",
    legacyPatch.ok &&
      legacyStatus.status === "TRIAL" &&
      Number(legacyStatus.trialDaysRemaining) >= 29 &&
      Number(legacyStatus.trialDaysRemaining) <= 30 &&
      Math.abs(legacyTerm - 30 * DAY_MS) < 60_000,
    JSON.stringify({
      status: legacyStatus.status,
      days: legacyStatus.trialDaysRemaining,
      termDays: legacyTerm / DAY_MS,
    })
  );
  const expiredPatch = await send(page, "POST", "/api/license/test", {
    reset: true,
    trialEndsAt: new Date(Date.now() - 60_000).toISOString(),
  });
  const expiredStatus = (await send(page, "GET", "/api/license/status")).body || {};
  check(
    "A16",
    "an already-expired short trial is never revived by the migration",
    expiredPatch.ok &&
      expiredStatus.status === "EXPIRED" &&
      expiredStatus.active === false &&
      expiredStatus.trialDaysRemaining === 0,
    JSON.stringify({ status: expiredStatus.status, active: expiredStatus.active })
  );
  const overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), "maher-trial-override-"));
  const overrideFile = path.join(overrideDir, "maher-license-state.json");
  const overrideScript = [
    `import { getLicenseState, saveLicenseState } from ${JSON.stringify(
      pathToFileURL(path.join(ROOT, "lib", "licensing", "license-store.ts")).href
    )};`,
    "const now = Date.now();",
    `saveLicenseState({ version: 1, installedAt: new Date(now).toISOString(), trialEndsAt: new Date(now + 15 * ${DAY_MS}).toISOString(), trialClaimed: false, lastSeenTimestamp: now, license: null });`,
    "const s = getLicenseState(now);",
    `console.log(JSON.stringify({ days: (Date.parse(s.trialEndsAt) - Date.parse(s.installedAt)) / ${DAY_MS} }));`,
  ].join("\n");
  const overrideOut = execFileSync(process.execPath, ["--import", "tsx", "-e", overrideScript], {
    cwd: ROOT,
    env: { ...process.env, MAHER_LICENSE_FILE: overrideFile, MAHER_TRIAL_DAYS: "15" },
    encoding: "utf8",
  });
  const overrideState = JSON.parse(overrideOut.trim().split("\n").pop());
  fs.rmSync(overrideDir, { recursive: true, force: true });
  check(
    "A17",
    "explicit MAHER_TRIAL_DAYS override is preserved instead of being migrated",
    overrideState.days === 15,
    JSON.stringify(overrideState)
  );
  await send(page, "POST", "/api/license/test", { reset: true });

  // ---------- B. Reject forged, bound-to-other-PC and expired keys ----------
  const invalid = await send(page, "POST", "/api/license/activate", {
    key: "MHR-KEY-bm90LWEta2V5.bm90LXNpZw",
  });
  check(
    "B1",
    "malformed key is rejected with 400",
    !invalid.ok && invalid.status === 400 && !!invalid.body?.error,
    JSON.stringify(invalid.body)
  );

  const annualExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const wrongMachine = await send(page, "POST", "/api/license/activate", {
    key: signLicense(
      basePayload("MHR-0000-0000-0000-0000", "1_YEAR", annualExpiry)
    ),
  });
  check(
    "B2",
    "valid signature for another machine is rejected",
    !wrongMachine.ok &&
      wrongMachine.status === 400 &&
      /মেশিন|machine/i.test(wrongMachine.body?.error || ""),
    JSON.stringify(wrongMachine.body)
  );

  const forged = signLicense(basePayload(machineId, "1_YEAR", annualExpiry));
  const tamperedParts = forged.split(".");
  const flipped = tamperedParts[1][0] === "A" ? "B" : "A";
  tamperedParts[1] = flipped + tamperedParts[1].slice(1);
  const badSignature = await send(page, "POST", "/api/license/activate", {
    key: tamperedParts.join("."),
  });
  check(
    "B3",
    "tampered Ed25519 signature is rejected",
    !badSignature.ok && badSignature.status === 400,
    JSON.stringify(badSignature.body)
  );
  // Root-level byte proof: the admin private half derives exactly the public
  // key embedded in the client, native crypto.verify accepts an untouched
  // payload, and flipping one character inside that payload breaks it.
  const derivedPublic = crypto
    .createPublicKey(PRIVATE_PEM)
    .export({ type: "spki", format: "pem" })
    .toString()
    .trim();
  const embeddedPublic = fs
    .readFileSync(path.join(ROOT, "lib", "licensing", "public-key.ts"), "utf8")
    .match(/-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----/)?.[0]
    ?.trim();
  const probe = JSON.parse(Buffer.from(forged.split(".")[0].slice("MHR-KEY-".length), "base64url").toString("utf8"));
  probe.shopName = `TAMPERED ${probe.shopName}`;
  const mutatedPart = Buffer.from(JSON.stringify(probe), "utf8").toString("base64url");
  const payloadTamper = await send(page, "POST", "/api/license/activate", {
    key: `MHR-KEY-${mutatedPart}.${forged.split(".")[1]}`,
  });
  check(
    "B0",
    "Ed25519 keypair matches the client key and a one-character payload edit is rejected",
    derivedPublic === embeddedPublic &&
      crypto.verify(
        null,
        Buffer.from(forged.split(".")[0].slice("MHR-KEY-".length), "utf8"),
        derivedPublic,
        Buffer.from(forged.split(".")[1], "base64url")
      ) &&
      !payloadTamper.ok,
    JSON.stringify({ keysMatch: derivedPublic === embeddedPublic, status: payloadTamper.status })
  );

  const expiredKey = await send(page, "POST", "/api/license/activate", {
    key: signLicense(
      basePayload(
        machineId,
        "1_YEAR",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      )
    ),
  });
  check(
    "B4",
    "expired signed key is rejected",
    !expiredKey.ok &&
      expiredKey.status === 400 &&
      /মেয়াদ|expired/i.test(expiredKey.body?.error || ""),
    JSON.stringify(expiredKey.body)
  );
  const afterRejections = await send(page, "GET", "/api/license/status");
  check(
    "B5",
    "rejected keys leave the existing license state untouched",
    afterRejections.ok && afterRejections.body?.status === "TRIAL"
  );
  const unknownTier = await send(page, "POST", "/api/license/activate", {
    key: signLicense(basePayload(machineId, "5_YEARS", annualExpiry)),
  });
  check(
    "B6",
    "an unknown tier in a signed payload is rejected",
    !unknownTier.ok && unknownTier.status === 400,
    JSON.stringify(unknownTier.body)
  );
  const badLifetime = await send(page, "POST", "/api/license/activate", {
    key: signLicense(basePayload(machineId, "LIFETIME", annualExpiry)),
  });
  check(
    "B7",
    "LIFETIME with a non-null expiry is rejected",
    !badLifetime.ok && badLifetime.status === 400,
    JSON.stringify(badLifetime.body)
  );

  // ---------- C. Clock rollback detection + full-screen gate ----------
  const hook = await send(page, "POST", "/api/license/test", {
    lastSeenTimestamp: Date.now() + 2 * 60 * 60 * 1000,
  });
  check("C0", "test-mode clock hook is reachable", hook.ok, JSON.stringify(hook.body));
  const tamperedStatus = await send(page, "GET", "/api/license/status");
  check(
    "C1",
    "two-hour clock rollback is flagged as CLOCK_TAMPERED",
    tamperedStatus.ok &&
      tamperedStatus.body?.status === "CLOCK_TAMPERED" &&
      tamperedStatus.body?.active === false,
    JSON.stringify(tamperedStatus.body)
  );
  check(
    "C2",
    "clock warning uses the exact Bengali support message",
    tamperedStatus.body?.message === CLOCK_MESSAGE,
    JSON.stringify(tamperedStatus.body?.message)
  );

  for (const route of ["/dashboard", "/service", "/products", "/parts"]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    const blocked = await page
      .waitForSelector('[data-testid="license-gate"]', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check(`C2-${route}`, `${route} is 100% blocked by the activation gate`, blocked);
  }

  await page.goto(`${BASE}/service`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="btn-activate-license"]', {
    timeout: 15000,
  });
  const gateText = await page
    .$eval('[data-testid="license-gate"]', (el) => el.innerText)
    .catch(() => "");
  check(
    "C3",
    "locked app shows the full-screen activation gate and support bar",
    gateText.includes(CLOCK_MESSAGE) &&
      gateText.includes(SUPPORT_BAR) &&
      gateText.includes("সফটওয়ার সক্রিয় করুন"),
    JSON.stringify({ found: gateText.includes(SUPPORT_BAR), body: gateText.slice(0, 320) })
  );
  check(
    "C4",
    "gate exposes machine ID, copy button and clean key input",
    !!(await page.$('[data-testid="btn-copy-machine-id"]')) &&
      (await page.$eval('[data-testid="license-key-input"]', (el) =>
        el.getAttribute("placeholder")
      )) === "MHR-KEY-XXXXX..."
  );
  await stubClipboard(page);
  await page.click('[data-testid="btn-copy-machine-id"]');
  await page.waitForFunction(() => !!window.__licenseCopied, {
    polling: 100,
    timeout: 5000,
  });
  const copied = await page.evaluate(() => window.__licenseCopied);
  check("C5", "copy button copies the current machine ID", copied === machineId);

  await send(page, "POST", "/api/license/test", {
    lastSeenTimestamp: Date.now(),
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="btn-activate-license"]'),
    { polling: 200, timeout: 15000 }
  );
  const recovered = await send(page, "GET", "/api/license/status");
  check(
    "C6",
    "correcting the clock clears the tamper lock",
    recovered.ok && recovered.body?.active === true
  );

  // ---------- D. Expired trial → activation → persistence ----------
  await send(page, "POST", "/api/license/test", {
    reset: true,
    trialEndsAt: new Date(Date.now() - 60_000).toISOString(),
  });
  await page.goto(`${BASE}/service`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="btn-activate-license"]', {
    timeout: 15000,
  });
  const oneYearKey = signLicense(basePayload(machineId, "1_YEAR", annualExpiry));
  await setInput(page, "license-key-input", oneYearKey);
  await page.click('[data-testid="btn-activate-license"]');
  await waitToast(page, "লাইসেন্স সক্রিয় হয়েছে");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="btn-activate-license"]'),
    { polling: 200, timeout: 15000 }
  );
  const activated = await send(page, "GET", "/api/license/status");
  check(
    "D1",
    "valid machine-bound 1_YEAR key activates and unlocks the app",
    activated.ok &&
      activated.body?.status === "ACTIVE" &&
      activated.body?.type === "1_YEAR" &&
      Number(activated.body?.daysRemaining) >= 364,
    JSON.stringify(activated.body)
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !!document.querySelector('[data-testid="daily-services"]'),
    { polling: 200, timeout: 15000 }
  );
  check(
    "D2",
    "activated license survives a reload (persistent store)",
    !(await page.$('[data-testid="btn-activate-license"]'))
  );

  // ---------- E. Dashboard renewal without downtime ----------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="license-status-badge"]')?.textContent ||
        "").includes("সক্রিয়"),
    { polling: 200, timeout: 15000 }
  );
  const yearBadge = await page.$eval(
    '[data-testid="license-status-badge"]',
    (el) => el.textContent
  );
  check(
    "E1",
    "1_YEAR badge reads সক্রিয় (১ বছর মেয়াদী)",
    (yearBadge || "").includes("● সক্রিয় (১ বছর মেয়াদী)"),
    yearBadge
  );
  const yearActionsText = await page
    .$eval('[data-testid="license-card"]', (el) => el.innerText)
    .catch(() => "");
  const yearRenewCta = await page
    .$eval('[data-testid="license-renew-btn"]', (el) => el.textContent)
    .catch(() => "");
  check(
    "E1a",
    "1_YEAR action hub swaps upgrade copy for an extend CTA with helper text",
    (yearRenewCta || "").includes(CTA.multiYear) &&
      yearActionsText.includes(CTA.extendHint) &&
      !(await page.$('[data-testid="license-lifetime-pill"]')),
    JSON.stringify({ yearRenewCta, tail: yearActionsText.slice(-260) })
  );
  await page.click('[data-testid="btn-open-license-modal"]');
  await page.waitForFunction(
    () =>
      !!document.querySelector('[data-testid="license-key-input"]') ||
      !!document.querySelector('[data-testid="renewal-license-key"]'),
    { polling: 150, timeout: 10000 }
  );
  const modalText = await page.$eval('[role="dialog"]', (el) => el.textContent);
  check(
    "E2",
    "renewal dialog header and action labels match the premium contract",
    (modalText || "").includes("সফটওয়ার লাইসেন্স সক্রিয় / রিনিউ করুন") &&
      (modalText || "").includes("🚀 সক্রিয় করুন") &&
      (modalText || "").includes("বাতিল"),
    (modalText || "").slice(0, 240)
  );
  check(
    "E2b",
    "modal uses the redesign title, notice and submit testid",
    (modalText || "").includes("সফটওয়ার লাইসেন্স সক্রিয় / রিনিউ করুন") &&
      (modalText || "").includes(
        "বর্তমান মেয়াদের সাথে নতুন মেয়াদ যুক্ত হবে। কোনো ডেটা মুছে যাবে না।"
      ) &&
      !!(await page.$('[data-testid="license-activate-submit"]')),
    (modalText || "").slice(0, 200)
  );
  const lifetimeKey = signLicense(basePayload(machineId, "LIFETIME", null));
  const renewalInput = (await page.$('[data-testid="license-key-input"]'))
    ? "license-key-input"
    : "renewal-license-key";
  await setInput(page, renewalInput, lifetimeKey);
  const preview = await page
    .waitForSelector('[data-testid="license-key-preview"]', { timeout: 10000 })
    .then((el) => el.evaluate((node) => node.textContent))
    .catch(() => "");
  check(
    "E3",
    "valid key shows ✓ সঠিক কি preview with shop name and tier label",
    (preview || "").includes("✓ সঠিক কি:") &&
      (preview || "").includes("MAHER MOBILE CARE") &&
      (preview || "").includes(TIER_LABELS.LIFETIME),
    preview
  );
  const wrongMachineKey = signLicense(
    basePayload("MHR-0000-0000-0000-0000", "1_YEAR", annualExpiry)
  );
  await setInput(page, renewalInput, wrongMachineKey);
  const mismatchChip = await waitChip(page, "mismatch");
  check(
    "E3-mismatch",
    "wrong-machine key shows the amber mismatch chip",
    (mismatchChip || "").includes("⚠️ এই কি-টি অন্য পিসির জন্য তৈরি করা হয়েছে"),
    mismatchChip
  );
  await setInput(page, renewalInput, "MHR-KEY-bm90LWEta2V5.bm90LXNpZw");
  const invalidChip = await waitChip(page, "invalid");
  check(
    "E3-invalid",
    "corrupted key shows the red invalid chip",
    (invalidChip || "").includes("✕ অকার্যকর বা ভুল লাইসেন্স কি"),
    invalidChip
  );
  await setInput(page, renewalInput, lifetimeKey);
  await waitChip(page, "valid");
  const renewalButton = (await page.$('[data-testid="btn-activate-license"]'))
    ? "btn-activate-license"
    : "btn-apply-renewal";
  await page.click(`[data-testid="${renewalButton}"]`);
  await waitToast(page, "লাইসেন্স রিনিউ হয়েছে");
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-testid="license-status-badge"]')?.textContent ||
        "").includes("লাইফটাইম আনলিমিটেড"),
    { polling: 200, timeout: 15000 }
  );
  const lifetime = await send(page, "GET", "/api/license/status");
  check(
    "E4",
    "renewal modal applies a lifetime key without locking the app",
    lifetime.ok &&
      lifetime.body?.status === "ACTIVE" &&
      lifetime.body?.type === "LIFETIME" &&
      lifetime.body?.expiresAt === null &&
      lifetime.body?.progressPercent === null &&
      lifetime.body?.isExpired === false &&
      lifetime.body?.unlimited === true,
    JSON.stringify(lifetime.body)
  );
  check(
    "E5",
    "lifetime badge reads সক্রিয় (লাইফটাইম আনলিমিটেড)",
    (await page.$eval('[data-testid="license-status-badge"]', (el) => el.textContent) || "").includes(
      "● সক্রিয় (লাইফটাইম আনলিমিটেড)"
    )
  );
  check(
    "E6",
    "progress bar is hidden for a lifetime license",
    !(await page.$('[data-testid="license-progress-bar"]'))
  );
  const lifetimeCardText = await page
    .$eval('[data-testid="license-card"]', (el) => el.innerText)
    .catch(() => "");
  check(
    "E7",
    "lifetime card shows the infinity guarantee and lifetime field values",
    lifetimeCardText.includes("💎 আজীবন ব্যবহারের নিশ্চয়তা") &&
      lifetimeCardText.includes("আজীবন মেয়াদী") &&
      lifetimeCardText.includes("আনলিমিটেড"),
    lifetimeCardText.slice(0, 300)
  );
  const lifetimeActions = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="license-card"]');
    const pill = document.querySelector('[data-testid="license-lifetime-pill"]');
    const trigger = document.querySelector('[data-testid="btn-open-license-modal"]');
    return {
      text: card?.innerText ?? "",
      pillText: pill?.textContent ?? "",
      pillClass: pill?.className ?? "",
      pillTag: pill?.tagName ?? "",
      renewButton: !!document.querySelector('[data-testid="license-renew-btn"]'),
      trigger: !!trigger,
      triggerText: trigger?.textContent ?? "",
      triggerTag: trigger?.parentElement?.tagName ?? "",
    };
  });
  check(
    "E8",
    "LIFETIME action hub drops the renewal CTA for a non-clickable emerald pill",
    lifetimeActions.pillText.includes(CTA.lifetimePill) &&
      [
        "bg-emerald-50", "border", "border-emerald-200", "text-emerald-800",
        "font-bold", "px-6", "py-2.5", "rounded-xl", "shadow-sm", "text-sm",
        "flex", "items-center", "gap-2",
      ].every((name) => lifetimeActions.pillClass.includes(name)) &&
      lifetimeActions.pillTag !== "BUTTON" &&
      !lifetimeActions.renewButton &&
      lifetimeActions.text.includes(CTA.lifetimeNote),
    JSON.stringify(lifetimeActions)
  );
  const changeButtonStyle = () =>
    page.evaluate(() => {
      const button = document.querySelector('[data-testid="license-change-key-btn"]');
      if (!button) return null;
      const style = getComputedStyle(button);
      return {
        tag: button.tagName,
        text: button.textContent ?? "",
        className: button.className,
        bg: style.backgroundColor,
        color: style.color,
        borderWidth: style.borderTopWidth,
        borderColor: style.borderTopColor,
        cursor: style.cursor,
        decoration: style.textDecorationLine,
        legacyHook: !!button.querySelector('[data-testid="btn-open-license-modal"]'),
      };
    });
  // The previous modal action leaves the pointer over this button. Move away
  // and let the 150ms hover transition settle before reading the resting style.
  await page.mouse.move(0, 0);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const changeRest = await changeButtonStyle();
  const changeClasses = [
    "inline-flex", "items-center", "gap-1.5", "px-3.5", "py-2", "rounded-xl",
    "text-xs", "font-semibold", "text-slate-700", "bg-slate-100",
    "hover:bg-slate-200", "border", "border-slate-300", "shadow-sm",
    "transition", "active:scale-95", "cursor-pointer",
  ];
  check(
    "E9",
    "LIFETIME exposes a high-affordance change-key button that keeps the legacy hook",
    !!changeRest &&
      changeRest.tag === "BUTTON" &&
      changeRest.text.includes(CTA.lifetimeChange) &&
      changeRest.legacyHook &&
      !!(await page.$('[data-testid="license-support-link"]')),
    JSON.stringify({ changeRest, expected: CTA.lifetimeChange })
  );
  check(
    "E10",
    "change-key button carries the executive secondary button styling",
    !!changeRest &&
      changeClasses.every((name) => changeRest.className.includes(name)) &&
      !changeRest.className.includes("gloss-primary") &&
      changeRest.bg === "rgb(241, 245, 249)" &&
      changeRest.color === "rgb(51, 65, 85)" &&
      changeRest.cursor === "pointer" &&
      changeRest.decoration === "none",
    JSON.stringify(changeRest)
  );
  await page.hover('[data-testid="license-change-key-btn"]');
  // Transitions run for 150ms; read after they settle, not mid-flight.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const changeHover = await changeButtonStyle();
  check(
    "E11",
    "change-key button has a tactile, readable hover state with a visible border",
    !!changeHover &&
      changeHover.bg === "rgb(226, 232, 240)" &&
      changeHover.color === "rgb(51, 65, 85)" &&
      parseFloat(changeHover.borderWidth) >= 1 &&
      changeHover.decoration === "none",
    JSON.stringify(changeHover)
  );
  await page.click('[data-testid="license-change-key-btn"]');
  const changeDialogOpened = await page
    .waitForSelector('[data-testid="license-dialog"]', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  const changeDialogMachineId = await page
    .$eval('[data-testid="license-dialog"]', (el) => el.textContent ?? "")
    .catch(() => "");
  check(
    "E12",
    "change-key button opens the light activation modal without resetting the machine ID",
    changeDialogOpened && changeDialogMachineId.includes(machineId) &&
      !!(await page.$('[data-testid="license-activate-submit"]')),
    JSON.stringify({ changeDialogOpened, hasId: changeDialogMachineId.includes(machineId) })
  );
  await page.evaluate(() => {
    document.querySelector('[aria-label="বন্ধ করুন"]')?.click();
  });
  const dialogClosed = await page
    .waitForFunction(() => !document.querySelector('[data-testid="license-dialog"]'), {
      polling: 100, timeout: 5000,
    })
    .then(() => true)
    .catch(() => false);
  check("E12b", "activation modal closes cleanly before the copy check", dialogClosed);
  const supportLink = await page.evaluate(() => {
    const link = document.querySelector('[data-testid="license-support-link"]');
    return { href: link?.getAttribute("href") ?? "", text: link?.textContent ?? "" };
  });
  check(
    "E-VENDOR",
    "lifetime support link stays on the vendor hotline after shop profile edits",
    supportLink.href.startsWith(CTA.vendorHref) &&
      supportLink.text.includes(CTA.vendorNumber) &&
      !supportLink.text.includes("01717777755"),
    JSON.stringify(supportLink)
  );
  // Sonner toasts from the activation flow sit above the card; wait for them
  // to leave so the click reaches the button instead of the toast viewport.
  await page
    .waitForFunction(() => document.querySelectorAll("[data-sonner-toast]").length === 0, {
      polling: 100,
      timeout: 10000,
    })
    .catch(() => {});
  await stubClipboard(page);
  await page.click('[data-testid="license-copy-machine-id"]');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const changeCopyFeedback = await page.evaluate(() => {
    const button = document.querySelector('[data-testid="license-copy-machine-id"]');
    const feedback = document.querySelector('[data-testid="license-copy-feedback"]');
    return {
      text: feedback?.textContent ?? "",
      role: feedback?.getAttribute("role") ?? "",
      className: button?.className ?? "",
      copied: window.__licenseCopied ?? "",
    };
  });
  check(
    "E13",
    "copy button switches to ✓ কপি হয়েছে! with emerald feedback for 2.5s",
    changeCopyFeedback.text.includes("✓ কপি হয়েছে!") &&
      changeCopyFeedback.role === "status" &&
      ["bg-emerald-100", "border-emerald-300", "text-emerald-700"].every(
        (name) => changeCopyFeedback.className.includes(name)
      ) &&
      changeCopyFeedback.copied === machineId,
    JSON.stringify(changeCopyFeedback)
  );

  // ---------- F. Multi-year tiers through the real activation path ----------
  for (const [tier, days] of Object.entries(TIER_DAYS)) {
    const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
    const applied = await send(page, "POST", "/api/license/activate", {
      key: signLicense(basePayload(machineId, tier, expiresAt)),
    });
    const result = await send(page, "GET", "/api/license/status");
    check(
      `F-${tier}`,
      `${tier} key activates with the exact ${days}-day expiry`,
      applied.ok &&
        result.body?.type === tier &&
        Number(result.body?.daysRemaining) >= days - 1 &&
        Number(result.body?.daysRemaining) <= days &&
        Number(result.body?.progressPercent) > 90,
      JSON.stringify(result.body)
    );
  }

  // ---------- G. Standalone admin keygen + SQLite CRM ----------
  const keygenDir = fs.mkdtempSync(path.join(os.tmpdir(), "maher-keygen-"));
  const keygenDb = path.join(keygenDir, "customers.db");
  process.env.MAHER_KEYGEN_DB_FILE = keygenDb;
  const keygen = await import(
    pathToFileURL(path.join(ROOT, "tools", "keygen-crm", "lib.mjs")).href
  );
  check(
    "G0",
    "keygen CRM honours MAHER_KEYGEN_DB_FILE so tests never touch admin data",
    keygen.DB_FILE === keygenDb,
    keygen.DB_FILE
  );
  for (const [tier, days] of [["TRIAL", 30], ...Object.entries(TIER_DAYS)]) {
    let timing = null;
    let span = NaN;
    try {
      timing = keygen.normalizeIssue(tier);
      span = Date.parse(timing.expiresAt) - Date.parse(timing.issuedAt);
    } catch (error) {
      span = error.message;
    }
    check(
      `G-${tier}-duration`,
      `keygen ${tier} encodes exactly ${days} days`,
      timing?.type === tier && Math.abs(span - days * DAY_MS) < 5000,
      JSON.stringify({ timing, span })
    );
  }
  let lifeTiming = null;
  try {
    lifeTiming = keygen.normalizeIssue("LIFETIME");
  } catch {
    /* reported by the check below */
  }
  check(
    "G-LIFETIME-duration",
    "keygen LIFETIME encodes a null expiry",
    lifeTiming?.type === "LIFETIME" && lifeTiming?.expiresAt === null
  );
  let extension = null;
  let extensionSpan = NaN;
  try {
    extension = keygen.normalizeIssue("30_DAYS");
    extensionSpan = Date.parse(extension.expiresAt) - Date.parse(extension.issuedAt);
  } catch {
    /* reported below */
  }
  check(
    "G-30_DAYS-duration",
    "keygen accepts the 30_DAYS trial-extension tier",
    extension?.type === "TRIAL" && Math.abs(extensionSpan - 30 * DAY_MS) < 5000,
    JSON.stringify({ extension, extensionSpan })
  );
  const cliOut = execFileSync(
    process.execPath,
    [
      path.join(ROOT, "tools", "keygen-crm", "keygen.mjs"),
      "issue",
      "--name", "CLI Test Customer",
      "--shop", "CLI Test Shop",
      "--phone", "01733333333",
      "--machine", machineId,
      "--tier", "1_YEAR",
      "--json",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, MAHER_KEYGEN_DB_FILE: keygenDb },
      encoding: "utf8",
    }
  );
  let cli = null;
  try {
    cli = JSON.parse(cliOut);
  } catch {
    /* reported by the check below */
  }
  check(
    "G-cli",
    "CLI --tier issues a signed 1_YEAR key into the throwaway CRM ledger",
    cli?.license_key?.startsWith("MHR-KEY-") &&
      cli?.license_type === "1_YEAR" &&
      cli?.machine_id === machineId &&
      Math.abs(Date.parse(cli?.expires_at) - Date.parse(cli?.issued_at) - 365 * DAY_MS) < 5000,
    JSON.stringify({ id: cli?.id, type: cli?.license_type })
  );

  if (keygen.DB_FILE === keygenDb) {
    const record = keygen.issueLicense({
      name: "CRM Test Customer",
      shop: "CRM Test Shop",
      phone: "01711111111",
      machineId,
      type: "2_YEARS",
    });
    check(
      "G-issue",
      "issued key is signed, tiered and stored with customer data",
      record.license_key.startsWith("MHR-KEY-") &&
        record.license_type === "2_YEARS" &&
        record.whatsapp_text.includes(TIER_LABELS["2_YEARS"]) &&
        record.whatsapp_text.includes(`দোকান: CRM Test Shop`) &&
        record.whatsapp_text.includes(`মেশিন আইডি: ${machineId}`) &&
        record.status === "ACTIVE",
      JSON.stringify({ id: record.id, type: record.license_type, status: record.status })
    );
    const found = keygen.listLicenses(25, "CRM Test Shop");
    check(
      "G-search",
      "customer search finds the saved ledger row",
      found.length === 1 && found[0].id === record.id,
      JSON.stringify(found)
    );
    const soon = keygen.issueLicense({
      name: "Renewal Alert Customer",
      shop: "Renewal Alert Shop",
      phone: "01722222222",
      machineId,
      type: "TRIAL",
    });
    const alerts = keygen.listRenewalAlerts(90);
    check(
      "G-alert",
      "renewal alerts list includes the expiring trial",
      alerts.some((row) => row.id === soon.id),
      JSON.stringify(alerts.map((row) => row.id))
    );

    const guiPort = await freePort();
    const guiUrl = `http://127.0.0.1:${guiPort}`;
    const gui = spawn(
      process.execPath,
      [path.join(ROOT, "tools", "keygen-crm", "server.mjs")],
      {
        cwd: ROOT,
        env: { ...process.env, KEYGEN_PORT: String(guiPort) },
        stdio: "ignore",
      }
    );
    try {
      await waitForUrl(guiUrl, gui);
      const html = await (await fetch(guiUrl)).text();
      check(
        "G-gui",
        "admin GUI exposes all five tiers, dark mode and WhatsApp copy",
        ["ট্রায়াল (৩০ দিন)", "১ বছর", "২ বছর", "৩ বছর", "লাইফটাইম"].every((s) =>
          html.includes(s)
        ) &&
          html.includes("data-theme") &&
          html.includes("📋 Copy WhatsApp Message") &&
          html.includes("🔑 Generate Key"),
        html.slice(0, 200)
      );
      const guiRows = await (
        await fetch(`${guiUrl}/api/list?search=CRM%20Test%20Shop`)
      ).json();
      check(
        "G-gui-search",
        "admin GUI search endpoint filters the CRM ledger",
        Array.isArray(guiRows) && guiRows.length === 1 && guiRows[0].id === record.id,
        JSON.stringify(guiRows)
      );
      const apiIssue = await (
        await fetch(`${guiUrl}/api/issue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "GUI API Customer",
            shop: "GUI API Shop",
            phone: "01811111111",
            machineId,
            type: "3_YEARS",
          }),
        })
      ).json();
      const issuedPart = String(apiIssue.license_key || "").slice("MHR-KEY-".length);
      const issuedPayload = JSON.parse(
        Buffer.from(issuedPart.split(".")[0] || "", "base64url").toString("utf8") || "{}"
      );
      const issuedSignatureOk = crypto.verify(
        null,
        Buffer.from(issuedPart.split(".")[0] || "", "utf8"),
        crypto.createPublicKey(PRIVATE_PEM),
        Buffer.from(issuedPart.split(".")[1] || "", "base64url")
      );
      const apiRows = keygen.listLicenses(50, "GUI API Shop");
      const apiRow = apiRows[0];
      check(
        "G-issue-api",
        "POST /api/issue signs the key and persists tier, machine and timestamp in customers.db",
        issuedSignatureOk &&
          issuedPayload.machineId === machineId &&
          issuedPayload.type === "3_YEARS" &&
          String(apiIssue.whatsapp_text).includes(String(apiIssue.license_key)) &&
          String(apiIssue.whatsapp_text).includes(TIER_LABELS["3_YEARS"]) &&
          apiRows.length === 1 &&
          apiRow?.license_type === "3_YEARS" &&
          apiRow?.machine_id === machineId &&
          Number.isFinite(Date.parse(apiRow?.issued_at)) &&
          Math.abs(Date.parse(apiRow?.expires_at) - Date.parse(apiRow?.issued_at) - 1095 * DAY_MS) < 5000,
        JSON.stringify({ id: apiIssue.id, row: apiRow })
      );
    } finally {
      gui.kill("SIGKILL");
    }
  }

  fs.rmSync(keygenDir, { recursive: true, force: true });
  delete process.env.MAHER_KEYGEN_DB_FILE;

  // ---------- H. Release boundary: admin secrets never ship ----------
  const clientFiles = fs.readdirSync(path.join(ROOT, "lib", "licensing"));
  const outRoot = path.join(ROOT, "out");
  const leaked = [];
  if (fs.existsSync(outRoot)) {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/private\.pem|keygen-crm/i.test(full)) leaked.push(full);
      }
    };
    walk(outRoot);
  }
  const keygenReadme = fs.readFileSync(
    path.join(ROOT, "tools", "keygen-crm", "README.md"),
    "utf8"
  );
  check(
    "H1",
    "private key stays in the admin tool; client code and release bundles carry only the public key",
    fs.existsSync(PRIVATE_KEY_FILE) &&
      clientFiles.includes("public-key.ts") &&
      !clientFiles.some((file) => /private|keygen/i.test(file)) &&
      leaked.length === 0,
    JSON.stringify({ clientFiles, leaked: leaked.slice(0, 5) })
  );
  check(
    "H2",
    "admin README documents the standalone keygen GUI command",
    keygenReadme.includes("npm run keygen:gui"),
    "tools/keygen-crm/README.md"
  );

  const realErrors = errors.filter(
    (e) => !/status of 400|Failed to load resource/.test(e)
  );
  check("Z", "zero unexpected JS errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

  console.log(results.join("\n"));
  await closeBrowser(browser);
})()
  .then(() => process.exit(failed ? 1 : 0))
  .catch(async (e) => {
    console.error("OFFLINE-LICENSING SUITE CRASH:", e.stack || e.message);
    console.log(results.join("\n"));
    await closeBrowser(browser);
    process.exit(1);
  });
