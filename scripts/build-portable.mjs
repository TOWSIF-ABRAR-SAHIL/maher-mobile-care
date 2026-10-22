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

import { execFileSync, spawn } from "node:child_process";
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

/**
 * Boots the packaged server and fails the build unless the shop's data APIs
 * actually answer.
 *
 * This exists because a static file check was not enough. The first package was
 * missing the Prisma Client and the driver adapter, so the page rendered while
 * every /api call failed — and on the developer's own machine that same folder
 * ran fine, because Node resolved those modules by walking *up* into the
 * repository's node_modules. The client would have received a half-working app
 * that looked fine on the build machine.
 *
 * So the package is copied outside the repository before being started. Simply
 * setting NODE_PATH="" is not enough: Node still walks parent directories looking
 * for node_modules, and out/MAHER lives inside the repo. Isolation has to be
 * physical, not just an environment variable.
 */
async function verifyPackageRuns(sandbox) {
    const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maher-probe-"));
    const probeDb = path.join(probeRoot, "verify.db");
    const probePort = 3055;

  // On Windows the package must be verified with its own bundled Node 22, not
  // whatever Node happens to be on the build machine. The shipped native
  // better-sqlite3 binary is ABI 127 (Node 22), so using Node 24 here would
  // falsely fail the build on a perfectly valid package.
  const runtimeNode = path.join(sandbox, "runtime", "node.exe");
  const canUseBundledRuntime =
    process.platform === "win32" && fs.existsSync(runtimeNode);
  const verifyNode = canUseBundledRuntime ? runtimeNode : process.execPath;

  log(`verifying the package actually runs, outside the repository ...`);

  const server = spawn(verifyNode, [path.join(sandbox, "app", "server.js")], {
    cwd: path.join(sandbox, "app"),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      MAHER_DB_PATH: probeDb,
      MAHER_BACKUP_DIR: path.join(probeRoot, "backups"),
      DATABASE_URL: `file:${probeDb}`,
      NODE_ENV: "production",
      PORT: String(probePort),
      HOSTNAME: "127.0.0.1",
      NODE_PATH: "",
    },
  });

  let output = "";
  server.stdout?.on("data", (d) => (output += d));
  server.stderr?.on("data", (d) => (output += d));

  try {
    // Cross-building on Linux cannot execute Windows node.exe. In that one case
    // swap in the local native module for the duration of the probe. On Windows
    // the real bundled runtime plus the shipped ABI 127 binary are tested, so
    // nothing is swapped and the package is verified exactly as delivered.
    if (!canUseBundledRuntime) {
      const binary = path.join(sandbox, "app", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
      const localBinary = path.join(repoRoot, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
      if (fs.existsSync(binary) && fs.existsSync(localBinary)) fs.copyFileSync(localBinary, binary);
    }

    execFileSync(verifyNode, [path.join(sandbox, "app", "scripts", "first-run.mjs")], {
      cwd: path.join(sandbox, "app"),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        MAHER_DB_PATH: probeDb,
        MAHER_BACKUP_DIR: path.join(probeRoot, "backups"),
        NODE_PATH: "",
      },
    });

    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const health = await fetch(`http://127.0.0.1:${probePort}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (!health.ok) continue;

        // /api/health never touches the database, so it cannot prove the data
        // layer is present. These two can only succeed with a working Prisma
        // Client, the driver adapter and the SQLite engine.
        const technicians = await fetch(`http://127.0.0.1:${probePort}/api/technicians`, { signal: AbortSignal.timeout(5000) });
        if (!technicians.ok) throw new Error(`GET /api/technicians returned HTTP ${technicians.status}`);
        const roster = await technicians.json();
        if (!Array.isArray(roster?.technicians) || roster.technicians.length === 0) {
          throw new Error("GET /api/technicians returned an empty roster");
        }

        const stats = await fetch(`http://127.0.0.1:${probePort}/api/stats`, { signal: AbortSignal.timeout(5000) });
        if (!stats.ok) throw new Error(`GET /api/stats returned HTTP ${stats.status}`);
        const statBody = await stats.json();
        if (!Array.isArray(statBody?.techStats)) {
          throw new Error("GET /api/stats did not return technician stats, so the database is not really being read");
        }

        log(`package verified outside the repo: health OK, roster OK (${roster.technicians.length}), stats OK (${statBody.techStats.length})`);
        return;
      } catch (error) {
        const message = error?.message ?? String(error);
        // These are real failures, not "not ready yet".
        if (/returned HTTP|empty roster|did not return technician/.test(message)) throw new Error(message);
      }
    }
    throw new Error(`the server never became ready.\n${output.slice(-1500)}`);
  } catch (error) {
    fail(
      `the packaged app does not work outside the repository:\n${error?.message ?? error}\n\n` +
        `This usually means a runtime dependency is missing from the package.`
    );
  } finally {
    server.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 300));
    if (!server.killed) server.kill("SIGKILL");
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
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
    // Windows cannot spawn a .cmd directly (EINVAL) — run it through the shell.
    ...(process.platform === "win32" ? { shell: true } : {}),
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
/**
 * Rewrites the build machine's absolute paths out of the server bundle.
 *
 * Next bakes `import.meta.url` into the emitted JavaScript instead of leaving it
 * to run, so the generated Prisma Client ends up executing this on a client PC:
 *
 *     globalThis.__dirname = path.dirname(fileURLToPath("file:///home/me/app/..."))
 *
 * On the build machine that string is a real location, so nothing looks wrong.
 * Copied to Windows it points at a Linux folder that does not exist, and Node
 * throws "File URL path must be absolute" the moment the module is imported.
 * Since every API route imports the Prisma Client, the page rendered while
 * every single API call failed, which is exactly what was seen on the shop PC.
 *
 * The build-machine prefix is swapped for a small runtime expression that reads
 * __MAHER_APP__, which server.js sets to this copy's own location. The remainder
 * of the path is left untouched, so the Prisma Client still resolves to the
 * generated client inside app\lib\generated\prisma exactly as it does in the
 * source tree.
 *
 * Only this repository's own paths are rewritten. Bundled dependencies contain
 * file:/// URLs in documentation and test fixtures ("file:///c:/tmp/test.txt"),
 * and rewriting those would corrupt them for no benefit. Paths inside .next/static
 * are already relative and browser code is left untouched.
 */
function makeServerPathsPortable(dir) {
  let rewrittenFiles = 0;

  // Next URL-encodes the baked path, so spaces appear as %20. Both forms are
  // handled so the rewrite does not depend on which one webpack emitted.
  // The whole quoted literal is matched, not just its prefix, so the remainder
  // of the path can be re-emitted inside quotes: leaving it bare would leave
  // "/lib/..." dangling after the concatenation.
  // Windows adds one more variant: the baked URL is file:///D:/... (three
  // slashes, drive letter), while repoRoot itself has no leading slash, so the
  // plain prefix would only match file://D:/... A leading-slash variant covers it.
  const repoForward = repoRoot.replace(/\\/g, "/");
  const repoPrefixes = [
    repoForward,
    repoForward.replace(/ /g, "%20"),
    `/${repoForward}`,
    `/${repoForward}`.replace(/ /g, "%20"),
  ].map((value) => new RegExp(`"file://${escapeRegExp(value)}([^"]*)"`, "g"));

  // $1 is the part of the path after the repository root, which still holds the
  // real in-package location (lib/generated/prisma/client.ts). The leading
  // slashes are stripped so Windows gets file:///C:/... rather than four slashes.
  const runtimePrefix =
    '("file:///"+(process.env.__MAHER_APP__||"").replace(/\\\\/g,"/").replace(/^\\/+/,"")+"$1")';

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(?:js|mjs|cjs)$/i.test(entry.name)) continue;

      const buffer = fs.readFileSync(full);
      // A stray NUL means this is not the text bundle we are looking for.
      if (buffer.includes(0)) continue;

      let text = buffer.toString("utf8");
      const before = text;
      for (const pattern of repoPrefixes) {
        text = text.replace(pattern, runtimePrefix);
      }
      if (text === before) continue;

      // Parse the result before saving it. This rewrite edits already-minified
      // code, so a mistake produces a file that still looks plausible and only
      // fails at runtime on a client PC. Checking here turns that into a failed
      // build.
      try {
        new Function(text);
      } catch (error) {
        fail(
          `rewriting baked paths produced invalid JavaScript in ` +
            `${path.relative(outDir, full)}:\n  ${error?.message ?? error}`
        );
      }

      fs.writeFileSync(full, text);
      rewrittenFiles += 1;
    }
  };

  walk(dir);

  if (rewrittenFiles === 0) {
    fail(
      "no baked build-machine path was found in the server bundle. Next may " +
        "have stopped inlining import.meta.url, which would be fine, but this " +
        "check must be updated deliberately rather than silently passing."
    );
  }

  // The rewrite only helps if nothing real is left behind, so assert that rather
  // than trusting it.
  const leftover = findBakedPaths(dir);
  if (leftover.length > 0) {
    fail(`build-machine paths are still baked into the package:\n  ${leftover.join("\n  ")}`);
  }

  log(`rewrote baked build-machine paths in ${rewrittenFiles} file(s)`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns human-readable hits for any build-machine path left in the bundle.
 *
 * Scoped to this repository's own paths. Next also writes URL-encoded build
 * paths into source-map and dev-overlay metadata (an ?filePath= query on the
 * icon route), but those are never resolved with fileURLToPath and cannot throw,
 * so flagging them would only teach this check to be ignored.
 */
function findBakedPaths(dir) {
  const hits = [];
  const repoForward = repoRoot.replace(/\\/g, "/");
  const markers = [
    repoForward,
    repoForward.replace(/ /g, "%20"),
    `/${repoForward}`,
    `/${repoForward}`.replace(/ /g, "%20"),
  ];

  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(?:js|mjs|cjs)$/i.test(entry.name)) continue;
      const buffer = fs.readFileSync(full);
      if (buffer.includes(0)) continue;

      const text = buffer.toString("utf8");
      for (const marker of markers) {
        // Only a file: URL matters; the same string in a comment is harmless.
        const found = text.match(new RegExp(`file:\\/\\/[^\\s"'\`]*${escapeRegExp(marker)}`));
        if (found) {
          hits.push(`${path.relative(outDir, full)} → ${found[0].slice(0, 90)}`);
          break;
        }
      }
    }
  };

  walk(dir);
  return hits;
}

const appDir = path.join(outDir, "app");
copyDir(standalone, appDir);
makeServerPathsPortable(appDir);

// Must run before anything else in the bundle: the Prisma Client resolves the
// rewritten path the first time it is imported, which happens while a route
// module loads, so this has to be set at the very top of the entry point.
const entryPoint = path.join(appDir, "server.js");
fs.writeFileSync(
  entryPoint,
  `// Added by scripts/build-portable.mjs.
 // Next bakes this build machine's absolute path into the server bundle, and the
 // generated Prisma Client resolves it with fileURLToPath() on first import, so
 // every API route failed on any other computer. Those paths now read this
 // variable instead; __dirname is where this copy of the app actually lives.
 process.env.__MAHER_APP__ = __dirname;
` + fs.readFileSync(entryPoint, "utf8")
);
log("server.js now resolves packaged paths at startup");

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
  // launch-decide.mjs is imported by launch.mjs, so it has to travel with it or
  // the launcher cannot start at all.
  for (const helper of ["first-run.mjs", "launch.mjs", "launch-decide.mjs"]) {
    fs.copyFileSync(path.join(scriptDir, helper), path.join(appDir, "scripts", helper));
    log(`copied scripts/${helper}`);
  }

// 3. Runtime dependencies the file tracer leaves out of .next/standalone.
    //
    // These are NOT required for the app to run — webpack already bundles the
    // generated Prisma Client and the driver adapter into the server chunks,
    // which the isolation check below proves. They are copied only so the
    // package matches the app it was built from and stays safe if the bundling
    // assumptions ever change. Both are small.
    //
    // devDependencies (@types/*, eslint, tailwindcss, typescript, tsx, prisma,
    // puppeteer-core, dotenv) are deliberately NOT copied: build- and test-only.
    const runtimeOnly = [
      { from: path.join(repoRoot, "lib", "generated", "prisma"), to: path.join(appDir, "lib", "generated", "prisma"), label: "lib/generated/prisma (Prisma Client)" },
      { from: path.join(repoRoot, "node_modules", "@prisma", "adapter-better-sqlite3"), to: path.join(appDir, "node_modules", "@prisma", "adapter-better-sqlite3"), label: "@prisma/adapter-better-sqlite3" },
    ];

    for (const { from, to, label } of runtimeOnly) {
      if (!fs.existsSync(from)) {
        fail(`${label} is missing from the source tree (${from}). Run "npm install" and "npx prisma generate" first.`);
      }
      fs.rmSync(to, { recursive: true, force: true });
      if (!process.env.MAHER_SKIP_RUNTIME_DEPS) copyDir(from, to);
      log(`copied ${label}`);
    }

    // 4. Strip developer data that the Next 14 trace pulled in.
for (const leak of ["backups", ".env", "prisma/dev.db", "prisma/dev.db-journal"]) {
  const full = path.join(appDir, leak);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    log(`removed developer-only path from package: ${leak}`);
  }
}

// 5. The Windows Node runtime, bundled so the client installs nothing.
const nodeZip = cachedDownload(NODE_ZIP_URL, `node-v${NODE_VERSION}-win-x64.zip`);
const nodeExtract = path.join(cacheDir, `node-v${NODE_VERSION}-win-x64`);
if (!fs.existsSync(path.join(nodeExtract, "node.exe"))) {
  fs.rmSync(nodeExtract, { recursive: true, force: true });
  log("extracting node.exe ...");
  try {
    // Same Windows reason as the npm call above: a .cmd shim (stock Windows
    // has no unzip, so PATH may provide one) cannot be spawned directly.
    execFileSync("unzip", ["-q", "-o", nodeZip, "-d", cacheDir], {
      stdio: ["ignore", "inherit", "inherit"],
      ...(process.platform === "win32" ? { shell: true } : {}),
    });
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

// 6. The Windows better-sqlite3 binary, replacing the Linux one.
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

// 7. Launchers + the client readme the shopkeeper actually reads.
fs.copyFileSync(path.join(repoRoot, "packaging", "MAHER MOBILE CARE.bat"), path.join(outDir, "MAHER MOBILE CARE.bat"));
fs.copyFileSync(path.join(repoRoot, "packaging", "MAHER STOP.bat"), path.join(outDir, "MAHER STOP.bat"));
fs.copyFileSync(path.join(repoRoot, "packaging", "start-maher.bat"), path.join(outDir, "start-maher.bat"));
fs.copyFileSync(path.join(repoRoot, "packaging", "README.txt"), path.join(outDir, "README.txt"));
log("copied launchers");

// 8. Data directory placeholder + manifest.
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

// 9. Never ship shop data, and never ship the Linux native binary.
assertNoShopData(outDir);

const strayLinux = findStrayLinuxBinaries(appDir);
if (strayLinux.length > 0) {
  fail(`Linux native binary still present, package will crash on Windows:\n  ${strayLinux.join("\n  ")}`);
}
log("binary check passed: no Linux .node files remain");

// 10. Prove the package actually serves the shop data before shipping it.
//
// The package is copied to a temp folder first. out/MAHER lives inside the
// repository, so starting it in place would let Node resolve any missing
// dependency by walking up into the repo's node_modules — which is exactly how
// the first broken package passed every local check.
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maher-package-"));
const sandbox = path.join(sandboxRoot, "MAHER");
log(`verifying the package in isolation (${sandboxRoot}) ...`);
fs.cpSync(outDir, sandbox, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(outDir, src);
    return !rel.startsWith("data") && !rel.startsWith("logs");
  },
});

try {
  await verifyPackageRuns(sandbox);
} finally {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
}

// Restore the Windows binary in the real package (verification may have swapped
// in the local one) and re-assert it is a Windows binary.
fs.copyFileSync(bs3Node, path.join(appDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"));
if (findStrayLinuxBinaries(appDir).length > 0) {
  fail("verification replaced the Windows binary and it was not restored correctly");
}
log("final package re-verified: Windows binary in place, no shop data");

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