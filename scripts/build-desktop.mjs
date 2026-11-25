/**
 * Builds the standalone Windows desktop package for MSS.
 *
 * Run:  npm run build:desktop       (alias: npm run dist)
 * Out:  out/MAHER-Electron/
 *         staging/                  portable standalone build + Electron entry
 *         dist/                     MSS-Setup-<version>.exe
 *         dist/win-unpacked/        uncompressed EXE for smoke tests
 *         desktop-build-info.json  artifacts + hashes for the release notes
 *
 * The standalone server, migrations and the Node 22 runtime are produced by
 * build-portable.mjs (MAHER_DESKTOP=1), so the installer reuses the exact same
 * verified package that the portable build uses. Desktop mode deliberately
 * creates no local data/ folder: the EXE reads and writes only the
 * installer-chosen non-C data root (default D:\MSS-Data).
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const outRoot = path.resolve(repoRoot, process.argv[2] ?? path.join("out", "MAHER-Electron"));
const staging = path.join(outRoot, "staging");
const electronApp = path.join(outRoot, "electron-app");
const dist = path.join(outRoot, "dist");

const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const log = (m) => console.log(`[desktop] ${m}`);
const fail = (m) => {
  console.error(`\n[desktop] BUILD FAILED: ${m}\n`);
  process.exit(1);
};

for (const dir of [staging, electronApp, dist]) {
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.mkdirSync(outRoot, { recursive: true });
fs.mkdirSync(electronApp, { recursive: true });

// 1. Reuse the verified standalone build. MAHER_DESKTOP=1 tells build-portable
//    not to preserve/create a local data folder, so no shop.db is ever packaged.
log("building the standalone server and Node 22 runtime ...");
try {
  execFileSync(
    process.execPath,
    [path.join(scriptDir, "build-portable.mjs"), staging],
    {
      cwd: repoRoot,
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, MAHER_DESKTOP: "1" },
    }
  );
} catch {
  fail("scripts/build-portable.mjs failed in desktop mode");
}

// 2. The Electron shell is a tiny folder of its own, OUTSIDE staging/. If the
//    builder's app root were staging/, electron-builder would filter out the
//    staged app/node_modules tree while copying extraResources — the bundled
//    better-sqlite3 would vanish and first-run would silently fall back to the
//    developer's node_modules (wrong ABI). ASAR holds only these four files.
for (const file of ["main.cjs", "preload.cjs", "env.cjs"]) {
  const from = path.join(repoRoot, "electron", file);
  if (!fs.existsSync(from)) fail(`missing electron/${file}`);
  fs.copyFileSync(from, path.join(electronApp, file));
}
fs.writeFileSync(
  path.join(electronApp, "package.json"),
  `${JSON.stringify(
    {
      name: "mss-desktop",
      version: rootPkg.version,
      description: "MSS (Mobile Service System) — offline shop management",
      author: "MSS",
      license: "UNLICENSED",
      private: true,
      main: "main.cjs",
      devDependencies: { electron: rootPkg.devDependencies.electron },
    },
    null,
    2
  )}\n`
);
log("staged the Electron shell outside the server package and locked the installer-data-root manifest");

// 3. Builder config: app code inside ASAR, server + runtime as plain resources.
const config = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "packaging", "electron-builder.json"), "utf8")
);
// `directories.app` is the only reliable way to tell electron-builder which
// package.json to read. Passing the staging path as the builder's `dir` option
// does NOT do it — the builder then reads the repository root package.json
// (main: index.js) and packs a 200 MB asar with the wrong entry point. The
// builder's own `dir` option means "unpacked only", not "app root".
config.directories = { ...config.directories, app: electronApp, output: dist };
config.beforeBuild = path.join(repoRoot, "packaging", "electron-before-build.cjs");
config.extraResources = config.extraResources.map((entry) => {
  // electron-builder drops a root-level `node_modules` from every extraResources
  // matcher (app-builder-lib/out/util/filter.js). Copying from staging/app would
  // silently lose the bundled native module; copying from staging/ with an
  // app/ prefix makes the relative path `app/node_modules/...` instead.
  if (entry.to === "app") {
    return { from: staging, to: ".", filter: ["app/**/*"] };
  }
  return { ...entry, from: path.join(staging, entry.from) };
});

log("packaging the Windows x64 installer (NSIS) ...");
let builder;
try {
  builder = require("electron-builder");
} catch {
  fail("electron-builder is not installed — run npm install first");
}
try {
  await builder.build({ config, win: ["nsis"], x64: true });
} catch (error) {
  fail(`electron-builder failed: ${error?.message ?? error}`);
}

// 4. Report exact artifacts so the release step never has to guess paths.
const artifacts = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.toLowerCase().endsWith(".exe")) artifacts.push(full);
  }
};
if (!fs.existsSync(dist) || !fs.existsSync(path.join(dist, "win-unpacked"))) {
  fail("electron-builder did not produce dist/win-unpacked");
}
walk(dist);
if (!artifacts.some((file) => /setup.*\.exe$/i.test(path.basename(file)))) {
  fail("the NSIS installer (.exe) is missing from dist/");
}
const unpackedExe = artifacts.find((file) =>
  file.toLowerCase().includes(path.join("win-unpacked", "mss.exe").toLowerCase())
);
if (!unpackedExe) fail("dist/win-unpacked/MSS.exe is missing");

// Native modules cannot be loaded from ASAR. These must be plain files in
// resources/, or first-run will fall back to a developer node_modules tree and
// die with an ABI error on the shopkeeper's machine.
const resourcesDir = path.join(path.dirname(unpackedExe), "resources");
for (const file of [
  path.join(resourcesDir, "runtime", "node.exe"),
  path.join(resourcesDir, "app", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
  path.join(resourcesDir, "app", "server.js"),
]) {
  if (!fs.existsSync(file)) fail(`packaged resource is missing: ${file}`);
}
log("verified plain resources: node.exe, better_sqlite3.node, server.js");

// The ASAR must hold only the four Electron shell files. electron-builder 26
// returns early on `npmRebuild: false` before calling beforeBuild, which leaves
// external-node-module handling disabled and silently copies the repository's
// whole production tree into app.asar (~200 MB duplicate). Fail the build if
// that ever regresses instead of shipping a bloated, confusing installer.
const asarPath = path.join(resourcesDir, "app.asar");
if (!fs.existsSync(asarPath)) fail("app.asar is missing");
const { listPackage } = require("@electron/asar");
const asarFiles = listPackage(asarPath);
const moduleEntries = asarFiles.filter((file) => /(^|[\\/])node_modules([\\/]|$)/.test(file));
if (moduleEntries.length) {
  fail(`app.asar contains ${moduleEntries.length} node_modules entries — the beforeBuild hook was not applied`);
}
const asarBytes = fs.statSync(asarPath).size;
if (asarBytes > 2_000_000) {
  fail(`app.asar is ${(asarBytes / 1_000_000).toFixed(1)} MB — expected a few KB of Electron shell files`);
}
log(`verified ASAR is shell-only: ${asarFiles.length} entries, ${(asarBytes / 1024).toFixed(1)} KB`);

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const info = {
  app: rootPkg.name,
  version: rootPkg.version,
  builtAt: new Date().toISOString(),
  dataRoot: "D:\\MSS-Data\\data\\shop.db (default; installer-chosen non-C root)",
  staging,
  dist,
  unpackedExe,
  installers: artifacts
    .filter((file) => /setup.*\.exe$/i.test(path.basename(file)))
    .map((file) => ({ file, sha256: sha256(file) })),
};
fs.writeFileSync(
  path.join(outRoot, "desktop-build-info.json"),
  `${JSON.stringify(info, null, 2)}\n`
);

console.log(
  [
    "",
    `[desktop] package ready: ${outRoot}`,
    `[desktop] EXE: ${unpackedExe}`,
    ...info.installers.map((a) => `[desktop] installer: ${a.file} (sha256 ${a.sha256.slice(0, 16)}…)`),
    "[desktop] shop data: installer-chosen non-C root (default D:\\MSS-Data\\data\\shop.db)",
    "",
  ].join("\n")
);
