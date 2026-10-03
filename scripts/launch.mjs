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

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// This file lives at <app>/scripts/launch.mjs, so the package root (the folder
// holding runtime\ and data\) is two levels up.
const appHome = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const nodeExe = process.execPath;
const serverJs = path.join(appHome, "app", "server.js");
const logFile = path.join(appHome, "logs", "maher.log");

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
 * /api/health deliberately does not touch the database, so it reports ready even
 * if the schema is missing. The technician list does read a table, so a success
 * here proves the app is genuinely usable rather than merely listening.
 */
async function tablesWork(timeoutMs = 3000) {
  try {
    const response = await fetch(`${baseUrl}/api/technicians`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return Array.isArray(body?.technicians) && body.technicians.length > 0;
  } catch {
    return false;
  }
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

async function main() {
  if (!fs.existsSync(serverJs)) {
    console.error(`\nERROR: app\\server.js was not found in:\n  ${appHome}\n`);
    console.error("Please copy the whole MAHER folder, not single files.\n");
    process.exit(1);
  }

  // Already running? Then just focus the window.
  const existing = await readHealth();
  if (existing?.service === "maher-mobile-care") {
    log("app is already running, opening it ...");
    openWindow();
    return;
  }

  // Something else answering on this port must not be mistaken for the shop.
  const stranger = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) }).catch(() => null);
  if (stranger) {
    console.error(`\nERROR: Another program is already using port ${port}.`);
    console.error("MAHER cannot start until that program is closed.\n");
    console.error("Please close the other program and double-click MAHER again.\n");
    process.exit(1);
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
    const health = await readHealth();
    if (health?.service === "maher-mobile-care") {
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