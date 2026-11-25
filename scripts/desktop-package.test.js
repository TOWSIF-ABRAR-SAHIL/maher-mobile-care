/* Desktop packaging contract.
 *
 * Pure source/config checks only: no server, no database, no Electron launch.
 * These pin the invariants that must survive a rebuild of the installer:
 * the standalone server and the Node 22 runtime stay in resources/, the app
 * database is locked to AppData, and a local package can never carry an old
 * shop.db into a desktop install.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

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

check("DP-01", "package.json exposes desktop dev, build and dist scripts", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const name of ["electron:dev", "build:desktop", "dist"]) {
    assert.ok(pkg.scripts[name], `missing script ${name}`);
  }
  assert.ok(pkg.scripts["build:portable"], "the portable build must stay available");
});

check("DP-02", "Electron tooling lives in devDependencies", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.devDependencies.electron || "", /^\^?\d/, "electron is not declared");
  assert.match(pkg.devDependencies["electron-builder"] || "", /^\^?\d/, "electron-builder is not declared");
});

check("DP-03", "builder config ships app/runtime as resources, outside ASAR", () => {
  assert.ok(exists("packaging/electron-builder.json"), "missing builder config");
  const cfg = JSON.parse(read("packaging/electron-builder.json"));
  // Private update identity must stay stable; a changed appId hides the
  // Update / Cancel prompt from an already-installed shop PC.
  assert.strictEqual(cfg.appId, "com.maher.mobilecare.desktop");
  assert.strictEqual(cfg.productName, "MSS");
  assert.strictEqual(cfg.artifactName, "MSS-Setup-${version}.${ext}");
  assert.strictEqual(cfg.asar, true);
  assert.strictEqual(cfg.nodeGypRebuild, false, "native modules are prebuilt for Windows ABI 127");
  for (const file of ["package.json", "main.cjs", "preload.cjs", "env.cjs"]) {
    assert.ok(cfg.files.includes(file), `files is missing ${file}`);
  }
  assert.deepStrictEqual(cfg.extraResources.map((entry) => entry.from), ["app", "runtime"]);
  assert.deepStrictEqual(cfg.extraResources.map((entry) => entry.to), ["app", "runtime"]);
  assert.strictEqual(cfg.win.target[0].target, "nsis");
  assert.deepStrictEqual(cfg.win.target[0].arch, ["x64"]);
  assert.strictEqual(cfg.nsis.oneClick, false, "assisted wizard must expose install paths");
  assert.strictEqual(cfg.nsis.perMachine, false, "per-user install needs no elevation");
  assert.strictEqual(cfg.nsis.allowToChangeInstallationDirectory, true, "install path must be selectable");
  assert.strictEqual(cfg.nsis.include, "packaging/mss-installer.nsh", "custom NSIS hooks are required");
  // Shortcuts are generated against the installed EXE path, so they always
  // follow the per-user install directory.
  assert.strictEqual(cfg.nsis.createDesktopShortcut, "always");
  assert.strictEqual(cfg.nsis.createStartMenuShortcut, true);
  assert.strictEqual(cfg.nsis.shortcutName, "MSS");
  assert.strictEqual(cfg.nsis.runAfterFinish, true, "the finish page may launch the app");
});

check("DP-04", "build-desktop stages the portable output, then packages it", () => {
  assert.ok(exists("scripts/build-desktop.mjs"), "missing build-desktop.mjs");
  const src = read("scripts/build-desktop.mjs");
  for (const needle of [
    "MAHER_DESKTOP",
    "build-portable.mjs",
    "electron-builder",
    "main.cjs",
    "preload.cjs",
    "env.cjs",
    "electron-builder.json",
    "win-unpacked",
  ]) {
    assert.ok(src.includes(needle), `build-desktop.mjs must contain ${needle}`);
  }
});

check("DP-05", "desktop staging never creates a local data/ shop folder", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes("MAHER_DESKTOP"), "build-portable.mjs must read the desktop mode");
  assert.ok(
    /if\s*\(!desktop\)[\s\S]{0,400}dataDir/.test(src),
    "the data/ placeholder must be gated behind non-desktop builds"
  );
  assert.ok(
    src.includes("preservePackageData(outDir, os.tmpdir(), keepOptions)"),
    "preserve must receive the desktop-aware options"
  );
  assert.ok(
    src.includes("restorePackageData(outDir, keptPackageData, keepOptions)"),
    "restore must receive the desktop-aware options"
  );
});

check("DP-06", "AppData path wins even if a stale MAHER_DB_PATH is inherited", () => {
  const { buildChildEnv } = require("../electron/env.cjs");
  const userRoot = path.join(path.parse(process.cwd()).root, "Users", "Shop", "AppData", "Roaming", "MSS");
  const stale = path.join(path.parse(process.cwd()).root, "stale", "shop.db");
  const env = buildChildEnv({
    userRoot,
    appDir: path.join(path.parse(process.cwd()).root, "MAHER", "resources", "app"),
    port: 43210,
    baseEnv: {
      MAHER_DB_PATH: stale,
      MAHER_USER_DATA_DIR: path.join(path.parse(process.cwd()).root, "stale"),
      MAHER_BACKUP_DIR: path.join(path.parse(process.cwd()).root, "stale", "backups"),
    },
  });
  assert.strictEqual(env.MAHER_DB_PATH, path.join(userRoot, "data", "shop.db"));
  assert.strictEqual(env.MAHER_BACKUP_DIR, path.join(userRoot, "data", "backups"));
  assert.strictEqual(env.MAHER_USER_DATA_DIR, userRoot);
  assert.strictEqual(env.HOSTNAME, "127.0.0.1");
});

check("DP-07", "electron:dev uses an isolated user-data root on loopback", () => {
  assert.ok(exists("scripts/electron-dev.mjs"), "missing electron-dev.mjs");
  const src = read("scripts/electron-dev.mjs");
  for (const needle of ["127.0.0.1", "MAHER_DESKTOP_DEV_URL", "MAHER_USER_DATA_DIR", "MAHER-Electron", "dev-user-data"]) {
    assert.ok(src.includes(needle), `electron-dev.mjs must contain ${needle}`);
  }
  assert.ok(!src.includes("prisma/dev.db"), "dev mode must not point at the local dev database");
});

check("DP-08", "main records a launch state file and isolates the dev lock", () => {
  const src = read("electron/main.cjs");
  for (const needle of ["desktop-state.json", "MAHER_DESKTOP_DEV_URL", "setPath", "userData", "dbPath", "port"]) {
    assert.ok(src.includes(needle), `main.cjs must contain ${needle}`);
  }
});

check("DP-09", "end-user and Windows prep docs mention the EXE and the chosen data root", () => {
  const readme = read("packaging/README.txt");
  assert.ok(/MSS\.exe|MSS-Setup-.*\.exe/i.test(readme), "readme must name the MSS EXE");
  assert.ok(readme.includes("D:\\MSS-Data"), "readme must name the installer data root");
  const prep = read("PREPARE-WINDOWS.md");
  assert.ok(prep.includes("build:desktop"), "PREPARE-WINDOWS.md must document build:desktop");
});

check("DP-10", "Windows extracts the Node zip with built-in tar (no unzip dependency)", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes('"-xf", nodeZip, "-C", cacheDir'), "Windows must use tar -xf for the .zip");
  assert.ok(src.includes('execFileSync(isWindows ? "tar" : "unzip"'), "extractor must be selected by platform");
});

check("DP-11", "cached runtime archives are validated before reuse", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes("function validateArchive"), "a cache validator is required");
  assert.ok(src.includes('"-tf"'), "Windows must test zip entries with tar -tf");
  assert.ok(src.includes('"-tzf"'), "tar.gz archives must be tested too");
  assert.ok(src.includes("is invalid — re-downloading"), "an invalid cache must be replaced, not reused");
});

check("DP-12", "a re-downloaded archive invalidates its extracted runtime, and node.exe is preflighted before packaging", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes("redownloaded.has"), "a fresh archive must force re-extraction of stale derived files");
  assert.ok(src.includes("runtimePreflight("), "the build must execute the bundled runtime before copying it");

  // A real execution test: the host node.exe must pass, a missing one must not.
  const { runtimePreflight } = require("../scripts/portable-runtime.cjs");
  const good = runtimePreflight(process.execPath, process.versions.node, process.versions.modules);
  assert.strictEqual(good.ok, true, `host runtime failed preflight: ${good.reason}`);
  const missing = runtimePreflight(path.join(ROOT, "__no_such_node_runtime__.exe"), "22.14.0", "127");
  assert.strictEqual(missing.ok, false, "a broken runtime path must fail the preflight");
});

check("DP-13", "the Electron shell lives outside the staged server so node_modules is not filtered out", () => {
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes("config.directories = {"), "builder directories must be set explicitly");
  assert.ok(src.includes("app: electronApp"), "directories.app must point at the small Electron shell folder");
  assert.ok(!src.includes("app: staging"), "the shell must not be the parent of the staged server");
  assert.ok(!/\bdir:\s*staging\b/.test(src), "the builder 'dir' flag means unpacked-only, not an app directory");
});

check("DP-14", "the finished package is checked for native modules outside ASAR", () => {
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes("better_sqlite3.node"), "the build must verify the Windows native module is present");
  assert.ok(src.includes('"runtime", "node.exe"'), "the build must verify the bundled runtime is present");
});

check("DP-15", "the Electron shell folder is created before its entry files are copied", () => {
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes("fs.mkdirSync(electronApp"), "the shell folder must exist before copyFileSync");
});

check("DP-16", "extraResources keeps node_modules by nesting the app path below `from`", () => {
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes('filter: ["app/**/*"]'), "the staged server must be copied through an app/ prefix");
  assert.ok(src.includes('to: "."'), "the app prefix must land at resources/app");
});

check("DP-17", "the ASAR is not inflated by a duplicate copy of repository node_modules", () => {
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes("config.beforeBuild"), "the build must set the beforeBuild hook");
  assert.ok(exists("packaging/electron-before-build.cjs"), "the hook module must exist");
  const hook = read("packaging/electron-before-build.cjs");
  assert.ok(hook.includes("return false"), "the hook must declare node_modules handled externally");
});

check("DP-18", "the smoke test isolates Electron userData on Windows, not just the APPDATA env var", () => {
  const src = read("scripts/desktop-smoke.mjs");
  assert.ok(src.includes("MAHER_USER_DATA_DIR: userRoot"), "the child DB root must be passed explicitly");
  assert.ok(src.includes("--user-data-dir="), "Electron's own userData path must be redirected too");
  assert.ok(src.includes("APPDATA: appData"), "the shell env override stays as a defence-in-depth measure");
});

check("DP-19", "a locked temp file can never hide smoke-check results", () => {
  const src = read("scripts/desktop-smoke.mjs");
  assert.ok(src.includes("removeWithRetry("), "cleanup must retry files briefly held by Windows");
  assert.ok(src.includes("Print before cleanup"), "results must be printed before a cleanup that can fail");
});

check("DP-20", "the smoke test waits for the renderer URL instead of sampling it once", () => {
  const src = read("scripts/desktop-smoke.mjs");
  assert.ok(src.includes("const page = await waitFor("), "page discovery must be retried until loadURL finishes");
  assert.ok(src.includes("allPageUrls"), "a failed page match must report the URLs that were actually open");
});

check("DP-21", "the smoke test records failing HTTP URLs, not just the generic 500 text", () => {
  const src = read("scripts/desktop-smoke.mjs");
  assert.ok(src.includes('page.on("response"'), "HTTP responses must be observed");
  assert.ok(src.includes("httpErrors"), "failing responses must be collected for diagnosis");
});

check("DP-22", "module entry points omitted by the Next standalone trace are restored", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes("restoreMissingEntryPoints("), "the build must restore missing entry files");
  const { restoreMissingEntryPoints } = require("../scripts/portable-module-entries.cjs");

  const base = fs.mkdtempSync(path.join(os.tmpdir(), "maher-entrypoints-"));
  try {
    const source = path.join(base, "source", "node_modules");
    const target = path.join(base, "target", "node_modules");
    const sourcePkg = path.join(source, "demo-pkg");
    const targetPkg = path.join(target, "demo-pkg");
    fs.mkdirSync(sourcePkg, { recursive: true });
    fs.mkdirSync(targetPkg, { recursive: true });

    fs.writeFileSync(path.join(sourcePkg, "package.json"), JSON.stringify({ exports: { ".": { import: "./run.mjs", require: "./run.js" } } }));
    fs.writeFileSync(path.join(sourcePkg, "run.mjs"), "export default 1;");
    fs.writeFileSync(path.join(sourcePkg, "run.js"), "module.exports = 1;");
    fs.writeFileSync(path.join(targetPkg, "package.json"), JSON.stringify({ name: "demo-pkg" }));
    fs.writeFileSync(path.join(targetPkg, "run.js"), "module.exports = 1;");

    const restored = restoreMissingEntryPoints({ sourceModules: source, targetModules: target });
    assert.ok(restored.includes("demo-pkg/run.mjs"), "the missing ESM entry must be reported");
    assert.ok(fs.existsSync(path.join(targetPkg, "run.mjs")), "the missing ESM entry must be copied");
    assert.strictEqual(fs.readFileSync(path.join(targetPkg, "run.js"), "utf8"), "module.exports = 1;", "existing files must not be overwritten");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

check("DP-23", "the isolated build probe exercises the backup export route", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(src.includes("/api/backup"), "health/roster/stats alone cannot catch a missing ESM entry file");
});

check("DP-24", "the beforeBuild hook is reachable and the ASAR cannot duplicate node_modules", () => {
  // electron-builder 26 returns early on `npmRebuild: false` BEFORE invoking
  // beforeBuild. That leaves areNodeModulesHandledExternally=false and copies
  // the repository's entire production dependency tree into app.asar.
  const config = JSON.parse(read("packaging/electron-builder.json"));
  assert.notStrictEqual(config.npmRebuild, false, "npmRebuild: false silences beforeBuild in electron-builder 26");
  assert.strictEqual(config.beforeBuild, undefined, "the hook is injected at build time, not stored in the canonical config");
  const src = read("scripts/build-desktop.mjs");
  assert.ok(src.includes("config.beforeBuild ="), "build must inject the external-node-modules hook");
  assert.ok(src.includes("listPackage"), "build must verify the finished ASAR contains no node_modules");
});

check("DP-25", "MSS owns the window/taskbar title and tenant name syncs into it", () => {
  const main = read("electron/main.cjs");
  assert.ok(main.includes('app.setName("MSS")'), "Electron app name must be MSS");
  assert.ok(main.includes("MSS (Mobile Service System)"), "native window title must carry MSS");
  assert.ok(main.includes('ipcMain.handle("window:set-title"'), "tenant title bridge must exist");
  const preload = read("electron/preload.cjs");
  assert.ok(preload.includes("setWindowTitle"), "preload must expose the title bridge");
  const types = read("electron/electron.d.ts");
  assert.ok(types.includes("setWindowTitle?(shopName: string)"), "the bridge must be typed");
});

check("DP-26", "packaged first run accepts the clean-slate empty technician roster", () => {
  const src = read("scripts/build-portable.mjs");
  assert.ok(
    src.includes("!Array.isArray(roster?.technicians)"),
    "verification must still prove the database returned a roster array"
  );
  assert.ok(
    !src.includes('throw new Error("GET /api/technicians returned an empty roster")'),
    "an empty roster is the expected clean-slate result, not a packaging failure"
  );
});

for (const line of results) console.log(line);
console.log(`Desktop package contract: ${results.filter((r) => r.startsWith("PASS")).length}/${results.length} PASS`);
