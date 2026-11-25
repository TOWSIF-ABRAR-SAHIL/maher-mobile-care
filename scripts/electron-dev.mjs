/**
 * Desktop development: a loopback-only Next dev server plus the Electron shell.
 *
 * Run: npm run electron:dev
 *
 * The dev database lives in out/MAHER-Electron/dev-user-data, never in the
 * repository's historical dev database or in the shop's real AppData folder.
 * The shell is told about
 * the running dev server through MAHER_DESKTOP_DEV_URL, so main.cjs does not
 * spawn its own standalone server in this mode.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const userRoot = path.join(repoRoot, "out", "MAHER-Electron", "dev-user-data");
const appDataRoot = path.join(userRoot, "electron-appdata");
const dbFile = path.join(userRoot, "data", "shop.db");
const url = "http://127.0.0.1:3000";
const IS_WINDOWS = process.platform === "win32";

for (const dir of [path.join(userRoot, "data", "backups"), path.join(userRoot, "logs"), appDataRoot]) {
  fs.mkdirSync(dir, { recursive: true });
}

const devEnv = {
  ...process.env,
  MAHER_USER_DATA_DIR: userRoot,
  MAHER_DB_PATH: dbFile,
  MAHER_BACKUP_DIR: path.join(userRoot, "data", "backups"),
  MAHER_MIGRATIONS_DIR: path.join(repoRoot, "prisma", "migrations"),
  HOSTNAME: "127.0.0.1",
  PORT: "3000",
  NODE_ENV: "development",
};
console.log(`[electron-dev] isolated data: ${dbFile}`);

// First run creates the isolated database and applies migrations before the
// dev server can answer a request.
execFileSync(process.execPath, [path.join(scriptDir, "first-run.mjs")], {
  cwd: repoRoot,
  env: devEnv,
  stdio: "inherit",
});

const devServer = spawn(IS_WINDOWS ? "npm.cmd" : "npm", ["run", "dev"], {
  cwd: repoRoot,
  env: devEnv,
  shell: IS_WINDOWS,
  stdio: "inherit",
  windowsHide: true,
});

let electronChild = null;
function stopAll() {
  if (electronChild && electronChild.exitCode === null) electronChild.kill();
  if (devServer.exitCode === null) devServer.kill();
}
process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});
process.on("exit", stopAll);

async function waitForHealth() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) {
      throw new Error(`Next dev server exited early (${devServer.exitCode})`);
    }
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(3000) });
      const body = await response.json().catch(() => ({}));
      if (
        response.ok &&
        body.ok &&
        body.service === "maher-mobile-care" &&
        path.resolve(body.dbPath || "") === path.resolve(dbFile)
      ) {
        return;
      }
    } catch {
      // Compiling on first request — poll again.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server did not become ready at ${url}`);
}

let electronExe;
try {
  const exported = require("electron");
  electronExe = typeof exported === "string" ? exported : path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe");
} catch (error) {
  console.error(`[electron-dev] electron is missing: ${error?.message ?? error}`);
  stopAll();
  process.exit(1);
}

try {
  await waitForHealth();
  console.log(`[electron-dev] health OK, opening the shell at ${url}`);
  electronChild = spawn(electronExe, [path.join(repoRoot, "electron", "main.cjs")], {
    cwd: repoRoot,
    env: {
      ...devEnv,
      APPDATA: appDataRoot,
      MAHER_DESKTOP_DEV_URL: url,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  electronChild.once("exit", (code) => {
    stopAll();
    process.exitCode = code ?? 0;
  });
} catch (error) {
  console.error(`[electron-dev] ${error?.message ?? error}`);
  stopAll();
  process.exitCode = 1;
}
