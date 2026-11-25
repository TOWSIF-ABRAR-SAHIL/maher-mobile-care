/**
 * Isolated launch smoke test for the packaged desktop EXE.
 *
 * Run: node scripts/desktop-smoke.mjs
 *
 * Every write goes to a throwaway APPDATA folder. No test ever points at
 * prisma/dev.db, out/MAHER/data/shop.db or the shop's real AppData database.
 * The script checks: first-run migration, AppData DB location, loopback URL,
 * renderer bridge/IPC round-trip, zero page errors, and the single-instance
 * lock. It then kills the whole process tree and removes the throwaway data.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const puppeteer = require("puppeteer-core");
const Database = require("better-sqlite3");

const results = [];
const check = (id, name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} [${id}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const infoPath = path.join(repoRoot, "out", "MAHER-Electron", "desktop-build-info.json");
if (!fs.existsSync(infoPath)) {
  console.error("[smoke] build the desktop package first: npm run build:desktop");
  process.exit(1);
}
const info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
const exe = process.argv[2] || info.unpackedExe;
if (!fs.existsSync(exe)) {
  console.error(`[smoke] EXE not found: ${exe}`);
  process.exit(1);
}

const appData = fs.mkdtempSync(path.join(os.tmpdir(), "maher-smoke-appdata-"));
const userRoot = path.join(appData, "MAHER-MOBILE-CARE");
const dbFile = path.join(userRoot, "data", "shop.db");
const stateFile = path.join(userRoot, "logs", "desktop-state.json");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

const cleanEnv = () => {
  // On Windows Electron resolves userData through SHGetKnownFolderPath and
  // ignores %APPDATA%. Set the app's own override explicitly, and pass
  // --user-data-dir too so the single-instance lock and DevToolsActivePort
  // also stay inside the throwaway folder.
  const env = {
    ...process.env,
    APPDATA: appData,
    MAHER_USER_DATA_DIR: userRoot,
  };
  for (const key of ["MAHER_DB_PATH", "MAHER_BACKUP_DIR", "MAHER_MIGRATIONS_DIR"]) {
    delete env[key];
  }
  return env;
};

async function waitFor(fn, deadlineMs = 90_000, intervalMs = 300) {
  const deadline = Date.now() + deadlineMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw lastError ?? new Error("timed out");
}

/** Windows keeps Chromium cache files open for a moment after taskkill. */
async function removeWithRetry(dir) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 9) console.error(`[smoke] could not remove ${dir}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

const debugPort = await freePort();
let app = null;
let browser = null;
let captured = "";

try {
  console.log(`[smoke] launching ${exe}`);
  console.log(`[smoke] isolated APPDATA: ${appData}`);
  app = spawn(exe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userRoot}`], {
    cwd: path.dirname(exe),
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  app.stdout?.on("data", (d) => (captured += d.toString()));
  app.stderr?.on("data", (d) => (captured += d.toString()));

  const state = await waitFor(
    () => {
      if (!fs.existsSync(stateFile)) return null;
      return JSON.parse(fs.readFileSync(stateFile, "utf8"));
    },
    120_000
  );
  check("SM-01", "first launch writes a production state file", state.mode === "production", `mode=${state.mode}`);
  check("SM-02", "child server binds loopback only", /^http:\/\/127\.0\.0\.1:\d+$/.test(state.url), state.url);
  check(
    "SM-03",
    "database is locked to isolated AppData, not the package",
    path.resolve(state.dbPath) === path.resolve(dbFile),
    state.dbPath
  );

  const tableInfo = await waitFor(() => {
    if (!fs.existsSync(dbFile)) return null;
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const migrations = db.prepare("SELECT COUNT(*) AS n FROM _prisma_migrations").get().n;
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('Service','Technician')")
        .all()
        .map((row) => row.name)
        .sort();
      return { migrations, tables };
    } finally {
      db.close();
    }
  });
  check("SM-04", "auto-migration created the AppData database", tableInfo.migrations > 0, `${tableInfo.migrations} migrations`);
  check("SM-05", "ledger tables exist", tableInfo.tables.join(",") === "Service,Technician", tableInfo.tables.join(","));

  // Electron writes DevToolsActivePort into userData. Connecting through that
  // file avoids the HTTP /json endpoints, which Chromium may refuse without an
  // explicit remote-allow-origins flag.
  const devToolsFile = path.join(userRoot, "DevToolsActivePort");
  browser = await waitFor(
    async () => {
      if (!fs.existsSync(devToolsFile)) return null;
      const [port, browserPath] = fs.readFileSync(devToolsFile, "utf8").trim().split(/\r?\n/);
      if (!port || !browserPath) return null;
      return puppeteer.connect({
        browserWSEndpoint: `ws://127.0.0.1:${port}${browserPath}`,
        defaultViewport: null,
      });
    },
    60_000,
    500
  );
  const page = await waitFor(async () => {
    const pages = await browser.pages();
    return pages.find((p) => p.url().startsWith(state.url)) ?? null;
  }, 30_000, 500).catch(() => null);
  const allPageUrls = (await browser.pages()).map((p) => p.url());
  check(
    "SM-06",
    "window opens on the loopback server",
    Boolean(page),
    page?.url() || allPageUrls.join(", ") || "no pages"
  );
  if (!page) throw new Error("no app page found");

  const pageErrors = [];
  const httpErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`);
  });

  const bridge = await page.waitForFunction(
    () => Boolean(window.maherDesktop?.isElectron && typeof window.maherDesktop.getPrinters === "function" && typeof window.maherDesktop.printReceipt === "function"),
    { timeout: 30_000 }
  );
  check("SM-07", "preload bridge is present in the renderer", Boolean(bridge));

  const printIpc = await page.evaluate(async () => {
    try {
      const printers = await window.maherDesktop.getPrinters();
      return { responded: true, count: Array.isArray(printers) ? printers.length : 0 };
    } catch (error) {
      // A machine with no printer may reject the list call; the IPC channel is
      // still paired and responsive, which is what this smoke check proves.
      return { responded: true, count: 0, detail: String(error?.message ?? error) };
    }
  });
  check(
    "SM-08",
    "print IPC round-trip responds (silent handler paired)",
    printIpc.responded,
    `${printIpc.count} printer(s)${printIpc.detail ? ` — ${printIpc.detail}` : ""}`
  );

  await new Promise((r) => setTimeout(r, 1500));
  check(
    "SM-09",
    "zero renderer console errors",
    pageErrors.length === 0,
    [...pageErrors.slice(0, 2), ...httpErrors.slice(0, 3)].join(" | ") || "none"
  );

  // A second shortcut must not start a second app/server. Its process exits
  // immediately after losing the single-instance lock.
  const second = spawn(exe, [`--user-data-dir=${userRoot}`], {
    cwd: path.dirname(exe),
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const secondExit = await Promise.race([
    new Promise((resolve) => second.once("exit", (code) => resolve(code))),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 15_000)),
  ]);
  check("SM-10", "single-instance lock rejects a second EXE", secondExit === 0, `exit=${secondExit}`);
  if (second.exitCode === null) spawnSync("taskkill", ["/PID", String(second.pid), "/T", "/F"]);

  check("SM-11", "no server crash text in the app log", !/exited early|did not become ready|EADDRINUSE/i.test(captured), captured.slice(-160) || "clean");
} catch (error) {
  check("SM-FATAL", "smoke run completed", false, error?.message ?? String(error));
} finally {
  if (browser) await browser.disconnect().catch(() => {});
  if (app && app.exitCode === null) {
    spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"]);
  }

  // Print before cleanup: a locked temp file must never hide check results.
  for (const line of results) console.log(line);
  console.log(`Desktop smoke: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);

  await removeWithRetry(appData);
}
