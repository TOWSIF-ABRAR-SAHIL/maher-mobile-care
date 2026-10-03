/**
 * Builds the portable Windows package for MAHER MOBILE CARE.
 *
 * Run:  npm run build:portable
 *
 * What it produces (default out/MAHER/):
 *
 *   MAHER MOBILE CARE.bat   double-click launcher
 *   runtime/                node.exe + Node's own DLLs (no install needed)
 *   app/                    .next/standalone server + static assets + prisma/migrations
 *   data/                   created on first run, holds the database + backups
 *
 * Design notes that matter:
 *
 * - The package is built on Linux but runs on Windows, so the two native
 *   binaries must be swapped for Windows builds. better-sqlite3 is the only
 *   runtime native module; @next/swc and @unrs/resolver are build/dev-only and
 *   are not present in the standalone output.
 * - Node is bundled rather than installed. That is why the pinned runtime is
 *   Node 22: the bundled better-sqlite3 prebuild is built for the Node 22 ABI
 *   (v127). A different Node major will refuse to load it.
 * - The standalone trace copies ./backups and .env because Next 14 has no
 *   outputFileTracingExcludes. Those are removed here. Shipping them would give
 *   the client access to the developer's shop data, so this must stay.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

// Node major must match the better-sqlite3 prebuild ABI.
const NODE_VERSION = "22.14.0";
const NODE_ABI = "127"; // Node 22 => modules version 127
const BETTER_SQLITE3_VERSION = "12.11.1";

const NODE_ZIP_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`;
const BETTER_SQLITE3_URL =
  `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}` +
  `/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${NODE_ABI}-win32-x64.tar.gz`;

const outDir = path.resolve(repoRoot, process.argv[2] ?? path.join(repoRoot, "out", "MAHER"));
const cacheDir = path.join(os.tmpdir(), "maher-portable-cache");

const log = (m) => console.log(`[portable] ${m}`);

function fail(message) {
  console.error(`\n[portable] BUILD FAILED: ${message}\n`);
  process.exit(1);
}

/** Downloads once into cache, then reuses. */
function cachedDownload(url, fileName) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = path.join(cacheDir, fileName);

  if (fs.existsSync(target) && fs.statSync(target).size > 0) {
    log(`using cached ${fileName}`);
    return target;
  }

  log(`downloading ${fileName} ...`);
  try {
    execFileSync("curl", ["-sSL", "--fail", "--max-time", "600", "-o", target, url], {
      stdio: ["ignore", "inherit", "inherit"],
    });
  } catch {
    fail(`could not download ${fileName} from ${url}`);
  }
  return target;
}

/**
 * Guards the package against shipping developer data.
 * Any hit is a build failure, not a warning.
 */
function assertNoShopData(dir) {
  const offenders = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const base = entry.name.toLowerCase();
      if (base.endsWith(".db") || base.startsWith(".env")) {
        offenders.push(rel);
      }
    }
  };
  walk(dir);
  if (offenders.length > 0) {
    fail(
      `refusing to ship shop data. Found ${offenders.length} file(s) in the package:\n  ` +
        offenders.slice(0, 10).join("\n  ") +
        `\nThis means a developer database or .env leaked into the build.`
    );
  }
  log("leak check passed: no .db or .env files in the package");
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: false });
}

function dirSizeMb(dir) {
  let total = 0;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  };
  walk(dir);
  return (total / 1024 / 1024).toFixed(1);
}

// ---------------------------------------------------------------- build steps

// Build here rather than relying on the caller, so MAHER_STANDALONE is always
// set correctly and the standalone output can never be silently missing.
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
log("building the standalone server (this takes a minute) ...");
try {
  execFileSync(npmCmd, ["run", "build"], {
    cwd: repoRoot,
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, MAHER_STANDALONE: "1" },
  });
} catch {
  fail("`npm run build` failed");
}

const standalone = path.join(repoRoot, ".next", "standalone");
if (!fs.existsSync(standalone)) {
  fail(".next/standalone is missing after the build");
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
log(`package directory: ${outDir}`);

// 1. The app server.
const appDir = path.join(outDir, "app");
copyDir(standalone, appDir);

// Next emits static assets as siblings of standalone; without these the page
// loads but every stylesheet and script 404s.
const staticSrc = path.join(repoRoot, ".next", "static");
if (fs.existsSync(staticSrc)) {
  copyDir(staticSrc, path.join(appDir, ".next", "static"));
  log("copied .next/static");
}
const publicSrc = path.join(repoRoot, "public");
if (fs.existsSync(publicSrc)) {
  copyDir(publicSrc, path.join(appDir, "public"));
  log("copied public/");
}

// 2. Migrations + first-run script, so a brand new PC can create its database.
const migrationsSrc = path.join(repoRoot, "prisma", "migrations");
if (!fs.existsSync(migrationsSrc)) {
  fail("prisma/migrations is missing; cannot create a new shop database");
}
copyDir(migrationsSrc, path.join(appDir, "prisma", "migrations"));
log("copied prisma/migrations");

fs.mkdirSync(path.join(appDir, "scripts"), { recursive: true });
for (const helper of ["first-run.mjs", "launch.mjs"]) {
  fs.copyFileSync(path.join(scriptDir, helper), path.join(appDir, "scripts", helper));
  log(`copied scripts/${helper}`);
}

// 3. Strip developer data that the Next 14 trace pulled in.
for (const leak of ["backups", ".env", "prisma/dev.db", "prisma/dev.db-journal"]) {
  const full = path.join(appDir, leak);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    log(`removed developer-only path from package: ${leak}`);
  }
}

// 4. The Windows Node runtime, bundled so the client installs nothing.
const nodeZip = cachedDownload(NODE_ZIP_URL, `node-v${NODE_VERSION}-win-x64.zip`);
const nodeExtract = path.join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
if (!fs.existsSync(path.join(nodeExtract, "node.exe"))) {
  fs.rmSync(nodeExtract, { recursive: true, force: true });
  log("extracting node.exe ...");
  try {
    execFileSync("unzip", ["-q", "-o", nodeZip, "-d", cacheDir], { stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    fail("could not extract the Node zip (is unzip installed?)");
  }
}
const runtimeDir = path.join(outDir, "runtime");
copyDir(nodeExtract, runtimeDir);
const nodeExe = path.join(runtimeDir, "node.exe");
if (!fs.existsSync(nodeExe)) {
  fail("node.exe not found after extracting the runtime");
}
log(`bundled Node ${NODE_VERSION} (node.exe)`);

// 5. The Windows better-sqlite3 binary, replacing the Linux one.
const bs3Tar = cachedDownload(BETTER_SQLITE3_URL, `better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${NODE_ABI}-win32-x64.tar.gz`);
const bs3Extract = path.join(cacheDir, `bs3-${NODE_ABI}-win32-x64`);
const bs3BinaryRel = path.join("build", "Release", "better_sqlite3.node");
if (!fs.existsSync(path.join(bs3Extract, bs3BinaryRel))) {
  fs.rmSync(bs3Extract, { recursive: true, force: true });
  // Release archives may or may not wrap files in a top-level `package/`
  // directory, so extract and then look for the binary either way.
  const probe = path.join(cacheDir, `bs3-probe-${NODE_ABI}`);
  fs.rmSync(probe, { recursive: true, force: true });
  fs.mkdirSync(probe, { recursive: true });
  log("extracting Windows better-sqlite3 ...");
  try {
    execFileSync("tar", ["-xzf", bs3Tar, "-C", probe], { stdio: ["ignore", "inherit", "inherit"] });
  } catch {
    fail("could not extract the better-sqlite3 Windows prebuild");
  }
  const source = fs.existsSync(path.join(probe, bs3BinaryRel)) ? probe : path.join(probe, "package");
  if (!fs.existsSync(path.join(source, bs3BinaryRel))) {
    fail(`better_sqlite3.node not found in the extracted prebuild (${bs3Tar})`);
  }
  fs.mkdirSync(path.dirname(bs3Extract), { recursive: true });
  fs.renameSync(source, bs3Extract);
  fs.rmSync(probe, { recursive: true, force: true });
}

const bs3Node = path.join(bs3Extract, bs3BinaryRel);
if (!fs.existsSync(bs3Node)) {
  fail("better_sqlite3.node missing from the extracted Windows prebuild");
}
const bs3TargetDir = path.join(appDir, "node_modules", "better-sqlite3", "build", "Release");
fs.mkdirSync(bs3TargetDir, { recursive: true });
fs.copyFileSync(bs3Node, path.join(bs3TargetDir, "better_sqlite3.node"));
log(`installed Windows better-sqlite3 ${BETTER_SQLITE3_VERSION} (Node ${NODE_VERSION} ABI ${NODE_ABI})`);

// 6. Launchers.
fs.copyFileSync(path.join(repoRoot, "packaging", "MAHER MOBILE CARE.bat"), path.join(outDir, "MAHER MOBILE CARE.bat"));
fs.copyFileSync(path.join(repoRoot, "packaging", "start-maher.bat"), path.join(outDir, "start-maher.bat"));
log("copied launchers");

// 7. Data directory placeholder + manifest.
const dataDir = path.join(outDir, "data");
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(
  path.join(dataDir, "KEEP-THIS-FOLDER.txt"),
  [
    "MAHER MOBILE CARE stores the shop database and backups in this folder.",
    "",
    "Do not delete this folder. To move the shop to another computer, copy it.",
    "To upgrade the app, only replace the files OUTSIDE this folder.",
    "",
  ].join("\n")
);

const manifest = {
  app: "MAHER MOBILE CARE",
  version: JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version,
  builtAt: new Date().toISOString(),
  node: NODE_VERSION,
  betterSqlite3: BETTER_SQLITE3_VERSION,
  nodeAbi: NODE_ABI,
  buildHost: `${os.platform()}-${os.arch()}`,
  target: "windows-x64",
  sourceCommit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
};
fs.writeFileSync(path.join(outDir, "build-info.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// 8. Never ship shop data, and never ship the Linux native binary.
assertNoShopData(outDir);

const strayLinux = findStrayLinuxBinaries(appDir);
if (strayLinux.length > 0) {
  fail(`Linux native binary still present, package will crash on Windows:\n  ${strayLinux.join("\n  ")}`);
}
log("binary check passed: no Linux .node files remain");

console.log(
  [
    "",
    `[portable] package ready: ${outDir}`,
    `[portable] size: ${dirSizeMb(outDir)} MB`,
    `[portable] built for windows-x64 on ${manifest.buildHost}`,
    `[portable] node ${NODE_VERSION}, better-sqlite3 ${BETTER_SQLITE3_VERSION} (ABI ${NODE_ABI})`,
    "",
  ].join("\n")
);

/** Finds any remaining ELF .node file, which cannot load on Windows. */
function findStrayLinuxBinaries(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".node")) {
        const head = fs.readFileSync(full).subarray(0, 4);
        if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
          found.push(path.relative(dir, full));
        }
      }
    }
  };
  walk(dir);
  return found;
}