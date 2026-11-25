"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { buildChildEnv, isAllowedExternalUrl } = require("./env.cjs");
const { resolveDataRoot } = require("./data-root.cjs");
const { migrateLegacyData } = require("./data-migrate.cjs");

// npm run electron:dev passes a loopback URL from an already-running Next dev
// server. Production (the packaged EXE) never sets this and always owns the
// server process. A dev instance also gets its own single-instance lock so it
// cannot collide with an installed desktop app.
const DEV_URL = process.env.MAHER_DESKTOP_DEV_URL?.trim();

// appData is %AppData% on Windows. Naming before getPath keeps the folder
// exactly %AppData%\MSS — the platform brand, never a tenant shop name.
// The health `service` string below stays "maher-mobile-care" as a private
// wire identifier so existing launchers/tests keep recognising this server.
app.setName("MSS");
if (DEV_URL && process.env.MAHER_USER_DATA_DIR?.trim()) {
  app.setPath(
    "userData",
    path.join(path.resolve(process.env.MAHER_USER_DATA_DIR.trim()), "electron-dev-lock")
  );
}

const RESOURCES = process.resourcesPath || path.resolve(__dirname, "..");
const APP_DIR = path.join(RESOURCES, "app");
const NODE_EXE = path.join(RESOURCES, "runtime", "node.exe");
const SERVER_JS = path.join(APP_DIR, "server.js");
const FIRST_RUN_JS = path.join(APP_DIR, "scripts", "first-run.mjs");

let mainWindow = null;
let serverChild = null;
let logFd = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox("MSS", String(error?.message || error));
    app.quit();
  });
}

/**
 * Production reads the folder chosen in MSS-Setup (default D:\MSS-Data, drive C
 * rejected); dev mode uses the isolated MAHER_USER_DATA_DIR or AppData fallback.
 */
function userRootForApp() {
  return resolveDataRoot({
    env: process.env,
    exeDir: path.dirname(process.execPath),
    appData: app.getPath("appData"),
    isPackaged: app.isPackaged,
  }).root;
}

/** Small support/smoke-test breadcrumb — paths and port only, never shop rows. */
function writeState(payload) {
  const logDir = path.join(userRootForApp(), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(
    path.join(logDir, "desktop-state.json"),
    `${JSON.stringify(
      { ...payload, pid: process.pid, startedAt: new Date().toISOString() },
      null,
      2
    )}\n`
  );
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

function samePath(a, b) {
  if (!a || !b) return false;
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function waitForHealth(port, expectedDbPath, child) {
  const deadline = Date.now() + 60_000;
  const url = `http://127.0.0.1:${port}/api/health`;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`MSS server exited early (code ${child.exitCode})`));
        return;
      }
      try {
        const response = await fetch(url);
        const body = await response.json().catch(() => ({}));
        if (
          response.ok &&
          body.ok &&
          body.service === "maher-mobile-care" &&
          samePath(body.dbPath, expectedDbPath)
        ) {
          resolve();
          return;
        }
      } catch {
        // Not listening yet — poll again.
      }
      if (Date.now() > deadline) {
        reject(new Error(`MSS server did not become ready at ${url}`));
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });
}

async function start() {
  const userRoot = userRootForApp();
  if (DEV_URL) {
    writeState({
      mode: "dev",
      url: DEV_URL,
      dbPath: process.env.MAHER_DB_PATH || path.join(userRoot, "data", "shop.db"),
    });
    await createWindow(DEV_URL);
    return;
  }

  // An update from the old AppData installer carries its shop.db into the new
  // non-C folder. Explicit test roots and dev launches never touch AppData.
  if (!DEV_URL && !process.env.MAHER_USER_DATA_DIR?.trim()) {
    const legacy = migrateLegacyData({
      root: userRoot,
      appData: app.getPath("appData"),
    });
    if (legacy.migrated) {
      console.log(`[mss] carried existing shop data from ${legacy.from} to ${legacy.to}`);
    }
  }

  const dataDir = path.join(userRoot, "data");
  const backupDir = path.join(dataDir, "backups");
  const logDir = path.join(userRoot, "logs");

  for (const dir of [dataDir, backupDir, logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const [label, file] of [
    ["bundled Node runtime", NODE_EXE],
    ["standalone Next server", SERVER_JS],
    ["first-run migration helper", FIRST_RUN_JS],
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(`Missing ${label}: ${file}`);
    }
  }

  const port = await freePort();
  const childEnv = buildChildEnv({ userRoot, appDir: APP_DIR, port });

  // Auto-migration runs before the server can answer a single request.
  execFileSync(NODE_EXE, [FIRST_RUN_JS], {
    cwd: APP_DIR,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

  logFd = fs.openSync(path.join(logDir, "maher.log"), "a");
  serverChild = spawn(NODE_EXE, [SERVER_JS], {
    cwd: APP_DIR,
    env: childEnv,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  serverChild.once("error", (error) => {
    dialog.showErrorBox("MSS", `Server failed to start: ${error.message}`);
    app.quit();
  });

  await waitForHealth(port, childEnv.MAHER_DB_PATH, serverChild);
  writeState({
    mode: "production",
    port,
    url: `http://127.0.0.1:${port}`,
    dbPath: childEnv.MAHER_DB_PATH,
    node: NODE_EXE,
  });
  await createWindow(`http://127.0.0.1:${port}`);
}

async function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    backgroundColor: "#F3F5F7",
    title: "MSS (Mobile Service System)",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // WhatsApp/tel links are user intents; everything else stays inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(baseUrl) || isAllowedExternalUrl(url)) return;
    event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(baseUrl);
}

/** Native title/taskbar text: tenant shop name first, platform brand always. */
ipcMain.handle("window:set-title", async (_event, rawShopName) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const tenant = String(rawShopName ?? "").trim();
  const title = `${tenant ? `${tenant} — ` : ""}MSS (Mobile Service System)`;
  if (mainWindow.getTitle() !== title) mainWindow.setTitle(title);
});

ipcMain.handle("printing:list", async (event) => {
  return event.sender.getPrintersAsync();
});

ipcMain.handle("print:receipt", async (event, options = {}) => {
  return event.sender.print({
    silent: true,
    printBackground: true,
    deviceName: options.deviceName || undefined,
  });
});

// Native folder picker for the dashboard's database-location dialog. The
// renderer never sees an arbitrary filesystem API — just the chosen path.
ipcMain.handle("dialog:select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "ডাটাবেজ ফোল্ডার নির্বাচন করুন",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, path: null };
  }
  return { canceled: false, path: result.filePaths[0] };
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (serverChild && serverChild.exitCode === null) {
    serverChild.kill();
  }
  if (logFd !== null) {
    fs.closeSync(logFd);
    logFd = null;
  }
});
