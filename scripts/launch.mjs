/**
 * Portable launcher: starts the app, waits until it is genuinely ready, then
 * opens it in a Chrome-style app window.
 *
 * This runs on the client PC with the bundled Node, so it must not depend on
 * anything that is not already inside the package.
 *
 * Why this is Node and not batch:
 *
 * - Polling from batch needs `Test-NetConnection`, which takes seconds per
 *   call. That made a normal start feel like a multi-minute hang.
 * - Checking "is the port open" is not enough. If another program already
 *   uses the port, batch would happily open that program in the app window.
 *   This script confirms the response really is MAHER before opening anything,
 *   and refuses clearly if something else owns the port.
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { decideAction } from "./launch-decide.mjs";

// This file lives at <app>/scripts/launch.mjs, so the package root (the folder
// holding runtime\, data\ and app\) is two levels up.
const appHome = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const nodeExe = process.execPath;
const serverJs = path.join(appHome, "app", "server.js");
const logFile = path.join(appHome, "logs", "maher.log");
const shopDb = path.join(appHome, "data", "shop.db");

const port = process.env.PORT || "3000";
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const healthUrl = `${baseUrl}/api/health`;

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 250;

const log = (m) => console.log(`  ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns the health payload, or null if nothing answers yet. */
async function readHealth(timeoutMs = 1500) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Confirms the server can actually read the shop tables.
 *
 * /api/health deliberately does not fail when the database is unhappy, so a
 * plain health response is not enough on its own: a server can answer happily
 * with an empty database. The technician list does read a table, so a success
 * here proves the shop is genuinely usable rather than merely listening.
 */
async function tablesWork(timeoutMs = 5000) {
  try {
    const response = await fetch(`${baseUrl}/api/technicians`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body?.technicians) && body.technicians.length > 0;
  } catch {
    return false;
  }
}

/** True once nothing is listening on the port any more. */
async function portIsFree(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const free = await new Promise((resolve) => {
      const socket = net.connect({ host, port: Number(port) });
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(true));
      socket.setTimeout(1000, () => {
        socket.destroy();
        resolve(true);
      });
    });
    if (free) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Finds whatever is listening on the port and stops it.
 *
 * These servers are started with `detached: true`, so they outlive the launcher
 * and the black window. Without this a single crashed run keeps a server alive
 * that points at an old or deleted database folder, and every later start
 * silently reuses it. That is the failure this whole function exists for.
 *
 * Only reached for a process that already answered as MAHER, so an unrelated
 * program is never killed; that case is refused before we get here.
 */
function stopServerOnPort() {
  if (process.platform !== "win32") {
    log("note: automatic cleanup of an old server is only implemented for Windows.");
    return false;
  }

  let pids = new Set();
  try {
    const output = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" });
    for (const line of output.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5) continue;
      const local = columns[1] || "";
      if (!local.endsWith(`:${port}`)) continue;
      const pid = Number(columns[columns.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
  } catch (err) {
    console.error(`  Could not look up the old server: ${err?.message ?? err}`);
    return false;
  }

  for (const pid of pids) {
    try {
      execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], { stdio: "ignore" });
      log(`stopped an old server that was still running (pid ${pid})`);
    } catch {
      /* already gone */
    }
  }
  return pids.size > 0;
}

function logTail(lines = 15) {
  try {
    const text = fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean);
    return text.slice(-lines).join("\n");
  } catch {
    return "(no log file yet)";
  }
}

/**
 * Opens the shop in a browser window without an address bar.
 * Chrome and Edge both accept --app; the default browser is the fallback.
 *
 * `spawn` reports failure through an async 'error' event, so a try/catch around
 * it does nothing. Every attempt therefore gets its own 'error' handler, and the
 * function never rejects. Opening a window must not be able to end the launcher
 * with a stack trace in front of a shopkeeper.
 */
function openWindow() {
  const candidates = [
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(process.env["ProgramFiles"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter((p) => p && fs.existsSync(p));

  const fireAndForget = (command, args) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {
        /* no browser could be opened; the address is shown on screen */
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  };

  for (const browser of candidates) {
    if (fireAndForget(browser, [`--app=${baseUrl}`, "--window-size=1440,900"])) return;
  }

  // No Chrome or Edge: hand the address to whatever opens links on this PC.
  fireAndForget("rundll32", ["url.dll,FileProtocolHandler", baseUrl]);
}

/** Stops whatever this launcher owns on the port, for MAHER STOP.bat. */
async function stopOnly() {
  if (await portIsFree(2000)) {
    log("MAHER is not running.");
    return 0;
  }
  stopServerOnPort();
  const freed = await portIsFree(8000);
  log(freed ? "MAHER has been stopped." : "Could not stop MAHER. Close it from Task Manager.");
  return freed ? 0 : 1;
}

async function main() {
  if (process.argv.includes("--stop")) {
    process.exit(await stopOnly());
  }

  if (!fs.existsSync(serverJs)) {
    console.error(`\nERROR: app\\server.js was not found in:\n  ${appHome}\n`);
    console.error("Please copy the whole MAHER folder, not single files.\n");
    process.exit(1);
  }

  const health = await readHealth();
  // Something else answering on this port must not be mistaken for the shop.
  const stranger = health
    ? health.service !== "maher-mobile-care"
    : await fetch(baseUrl, { signal: AbortSignal.timeout(1500) })
        .then(() => true)
        .catch(() => false);

  const action = decideAction({
    health,
    stranger,
    expectedDbPath: shopDb,
    tablesOk: await tablesWork(),
  });

  if (action === "refuse") {
    console.error(`\nERROR: Another program is already using port ${port}.`);
    console.error("MAHER cannot start until that program is closed.\n");
    console.error("Please close the other program and double-click MAHER again.\n");
    process.exit(1);
  }

  if (action === "reuse") {
    log("MAHER is already running from this folder. Opening it ...");
    openWindow();
    return;
  }

  if (action === "takeover") {
    console.log("  An older copy of MAHER is still running ...");
    if (health?.dbPath) {
      console.log(`  It is using this database:\n    ${health.dbPath}\n`);
      console.log(`  This copy uses:\n    ${shopDb}\n`);
    }
    log("closing it so this copy can open the right shop ...");
    stopServerOnPort();
    if (!(await portIsFree(10_000))) {
      console.error("\nERROR: An old MAHER server is still using this port.\n");
      console.error("Please run MAHER STOP.bat, or end node.exe in Task Manager, and try again.\n");
      process.exit(1);
    }
  }

  console.log("  Starting MAHER MOBILE CARE ...");

  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const logHandle = fs.openSync(logFile, "a");

  const server = spawn(nodeExe, [serverJs], {
    cwd: path.join(appHome, "app"),
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
    env: process.env,
  });
  server.unref();

  // A crash during startup should report itself, not wait out the timeout.
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\nERROR: The app stopped unexpectedly (code ${code}).\n`);
      console.error("--- last lines of the log ---\n");
      console.error(logTail());
      console.error("");
      process.exit(1);
    }
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let serverResponded = false;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const started = await readHealth();
    if (started?.service === "maher-mobile-care") {
      serverResponded = true;
      // Listening is not enough; the shop tables must be readable too.
      if (await tablesWork()) {
        log("ready. Opening the shop ...");
        openWindow();
        // Give the window a moment before this launcher closes.
        await sleep(600);
        return;
      }
    }
  }

  console.error(
    serverResponded
      ? "\nERROR: The app started but the shop database could not be read.\n"
      : `\nERROR: The app did not start within ${READY_TIMEOUT_MS / 1000} seconds.\n`
  );
  console.error("--- last lines of the log ---\n");
  console.error(logTail());
  console.error("");
  process.exit(1);
}

main().catch((error) => {
  console.error(`\nERROR: ${error?.message ?? error}\n`);
  process.exit(1);
});