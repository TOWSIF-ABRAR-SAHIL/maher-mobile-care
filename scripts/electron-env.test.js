/* Electron wrapper contract that can be checked without the electron package.
 *
 * Runtime Electron cannot be exercised here (no new packages are installed),
 * but the env handed to the bundled Node child and the external-link allowlist
 * are pure logic. Those are the invariants that keep the unauthenticated API on
 * loopback and keep AppData as the only writable shop-data root.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

require("tsx/cjs");

const dbPath = require("../lib/db-path.ts");

const results = [];
const check = (id, name, fn) => {
  try {
    fn();
    results.push(`PASS [${id}] ${name}`);
  } catch (error) {
    results.push(`FAIL [${id}] ${name} — ${error?.message ?? error}`);
    process.exitCode = 1;
  }
};

function load(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    return { __loadError: error };
  }
}

const electronEnv = load("../electron/env.cjs");
const ENV_KEYS = [
  "MAHER_DB_PATH",
  "DATABASE_URL",
  "MAHER_BACKUP_DIR",
  "MAHER_USER_DATA_DIR",
  "MAHER_MIGRATIONS_DIR",
  "HOSTNAME",
  "PORT",
  "NODE_ENV",
  "__MAHER_APP__",
  "NODE_PATH",
];

function withEnv(env, fn) {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  try {
    for (const [key, value] of Object.entries(env)) process.env[key] = value;
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = saved.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ROOT = path.join(path.parse(process.cwd()).root, "Maher AppData");
const APP_DIR = path.join(ROOT, "resources", "app");

function build() {
  assert.ok(!electronEnv.__loadError, electronEnv.__loadError?.message);
  return electronEnv.buildChildEnv({ userRoot: ROOT, appDir: APP_DIR, port: 43210 });
}

check("EC-01", "child server is forced to loopback in production", () => {
  const env = build();
  assert.strictEqual(env.HOSTNAME, "127.0.0.1");
  assert.strictEqual(env.NODE_ENV, "production");
  assert.strictEqual(env.PORT, "43210");
});

check("EC-02", "the app resolver sees the same AppData database as Electron", () => {
  const env = build();
  withEnv(env, () => {
    assert.strictEqual(dbPath.resolveDatabaseFile(), path.join(ROOT, "data", "shop.db"));
    assert.strictEqual(dbPath.resolveBackupDir(), path.join(ROOT, "data", "backups"));
  });
});

check("EC-03", "Prisma file URL survives spaces in the Windows user root", () => {
  const env = build();
  assert.ok(env.DATABASE_URL.startsWith("file:///"));
  assert.ok(env.DATABASE_URL.includes("Maher%20AppData"));
  assert.ok(!env.DATABASE_URL.includes("\\"));
});

check("EC-04", "migrations and app root are explicit, never cwd-derived", () => {
  const env = build();
  assert.strictEqual(env.MAHER_MIGRATIONS_DIR, path.join(APP_DIR, "prisma", "migrations"));
  assert.strictEqual(env.__MAHER_APP__, APP_DIR);
  assert.strictEqual(env.NODE_PATH, "");
});

check("EC-05", "only wa.me, WhatsApp, tel and mailto leave Electron externally", () => {
  assert.ok(!electronEnv.__loadError, electronEnv.__loadError?.message);
  const allowed = electronEnv.isAllowedExternalUrl;
  assert.strictEqual(allowed("https://wa.me/8801712345678?text=hi"), true);
  assert.strictEqual(allowed("tel:+8801712345678"), true);
  assert.strictEqual(allowed("mailto:shop@example.com"), true);
  assert.strictEqual(allowed("https://example.com"), false);
  assert.strictEqual(allowed("file:///C:/Windows/system32"), false);
  assert.strictEqual(allowed(undefined), false);
});

const ELECTRON_DIR = path.join(__dirname, "..", "electron");
const readSource = (file) => {
  const full = path.join(ELECTRON_DIR, file);
  assert.ok(fs.existsSync(full), `missing ${file}`);
  return fs.readFileSync(full, "utf8");
};

check("EC-10", "main owns the server lifecycle and explicit loopback spawn", () => {
  const src = readSource("main.cjs");
  for (const needle of [
    "requestSingleInstanceLock",
    "buildChildEnv",
    "first-run.mjs",
    "127.0.0.1",
    "setWindowOpenHandler",
    "isAllowedExternalUrl",
    "print:receipt",
    "printing:list",
    "getPrintersAsync",
    "silent: true",
    "before-quit",
    "dialog:select-directory",
    "openDirectory",
    "createDirectory",
  ]) {
    assert.ok(src.includes(needle), `main.cjs must contain ${needle}`);
  }
});

check("EC-11", "preload exposes only the small desktop bridge", () => {
  const src = readSource("preload.cjs");
  for (const needle of ["contextBridge", "isElectron: true", "printReceipt", "getPrinters", "ipcRenderer.invoke", "selectDirectory", "dialog:select-directory"]) {
    assert.ok(src.includes(needle), `preload.cjs must contain ${needle}`);
  }
  assert.ok(!src.includes("require('electron').remote"), "remote must never be exposed");
});

check("EC-12", "renderer type definition matches the preload bridge", () => {
  const src = readSource("electron.d.ts");
  for (const needle of ["maherDesktop", "isElectron", "printReceipt", "getPrinters", "selectDirectory", "electronAPI"]) {
    assert.ok(src.includes(needle), `electron.d.ts must contain ${needle}`);
  }
});

check("EC-13", "receipt print uses the desktop bridge but keeps browser fallback", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "app", "service", "ServiceWorkspace.tsx"),
    "utf8"
  );
  for (const needle of ["window.maherDesktop?.isElectron", "await window.maherDesktop.printReceipt()", "window.print()"]) {
    assert.ok(src.includes(needle), `ServiceWorkspace.tsx must contain ${needle}`);
  }
});

for (const line of results) console.log(line);
console.log(`Electron contract: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
