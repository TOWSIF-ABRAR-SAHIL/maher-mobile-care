/* Full regression with one fresh throwaway database (and backup folder) per
 * suite, so a crashed or interrupted suite can never leak rows or snapshots
 * into the next one. npm test intentionally never starts the app against
 * prisma/dev.db.
 */
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const IS_WINDOWS = process.platform === "win32";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
const NPX = IS_WINDOWS ? "npx.cmd" : "npx";
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const DEFAULT_SUITES = [
  "scripts/launcher-decide.test.js",
  "scripts/expense-upgrade.test.js",
  "scripts/e2e-maher.js",
  "scripts/e2e-p0.js",
  "scripts/laneA.js",
  "scripts/laneBC.js",
  "scripts/laneD.js",
  "scripts/laneE.js",
  "scripts/api-check.js",
  "scripts/technician-mgmt.js",
  "scripts/responsive-check.js",
];

function resolveLiveDatabaseFile() {
  const configured = (process.env.DATABASE_URL || "file:./prisma/dev.db").trim();
  const file = configured.replace(/^file:/i, "").trim();
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function hashFile(abs) {
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function run(command, args, env, label) {
  return new Promise((resolve, reject) => {
    // .cmd/.bat shims (npm.cmd, npx.cmd) cannot be spawned directly on Windows
    // with Node 20+ — Spawn EINVAL. Go through the shell for them only; node.exe
    // and other real executables stay direct so argument quoting is untouched.
    const viaShell = IS_WINDOWS && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: "inherit",
      windowsHide: true,
      shell: viaShell,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHealth(url, expectedDbFile, timeoutMs = 120000) {
  const start = Date.now();
  let lastError = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.ok && body.dbFile === expectedDbFile) return;
      lastError = `unexpected health response: ${JSON.stringify(body)}`;
    } catch (e) {
      lastError = e.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`test server did not become ready: ${lastError}`);
}

/** Stop the test server: SIGTERM, then SIGKILL after 5s. Never waits forever. */
async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  let capTimer;
  const capped = new Promise((resolve) => {
    capTimer = setTimeout(resolve, 10000);
  });
  const hardKill = setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }, 5000);
  try {
    child.kill();
  } catch {
    /* already gone */
  }
  await Promise.race([exited, capped]);
  clearTimeout(hardKill);
  clearTimeout(capTimer);
}

/**
 * Run one suite against its own fresh database, backup folder and server.
 * The database basename is unique per suite, and /api/health reports it, so
 * waitForHealth proves this server is on this suite's database — never live
 * shop data and never another suite's leftovers.
 */
async function runSuite(suite, index, tempRoot, baseEnv) {
  const slug = path.basename(suite, ".js").replace(/[^a-zA-Z0-9_-]/g, "-");
  const suiteDir = path.join(tempRoot, `${index}-${slug}`);
  const dbFile = path.join(suiteDir, `${slug}.db`);
  const backupDir = path.join(suiteDir, "backups");
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });

  const env = {
    ...baseEnv,
    MAHER_DB_PATH: dbFile,
    DATABASE_URL: `file:${dbFile}`,
    MAHER_BACKUP_DIR: backupDir,
  };
  await run(
    NPX,
    ["prisma", "migrate", "deploy"],
    env,
    `prisma migrate deploy (${suite})`
  );
  // lib/generated/prisma is gitignored, so after any schema change the client
  // on disk can predate the model the app now imports (e.g. Technician).
  // Regenerating per suite keeps the build honest instead of relying on the
  // one-off postinstall hook.
  await run(
    NPX,
    ["prisma", "generate"],
    env,
    `prisma generate (${suite})`
  );

  console.log(`\n===== ${suite} =====`);
  console.log(`Throwaway database: ${dbFile}`);

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  // Spawn Next directly (not through npx) so stopServer kills the real
  // server process instead of an npx wrapper that leaves it orphaned.
  const server = spawn(
    process.execPath,
    [NEXT_BIN, "start", "-H", "127.0.0.1", "-p", String(port)],
    { cwd: ROOT, env: { ...env, PORT: String(port) }, stdio: "inherit", windowsHide: true }
  );
  try {
    await new Promise((resolve, reject) => {
      server.on("error", reject);
      server.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          reject(new Error(`${suite}: test server exited early with code ${code}`));
        }
      });
      waitForHealth(`${base}/api/health`, path.basename(dbFile)).then(resolve, reject);
    });
    await run(
      process.execPath,
      [path.join(ROOT, suite)],
      {
        ...env,
        MAHER_TEST_URL: base,
        MAHER_TEST_DB_FILE: path.basename(dbFile),
      },
      suite
    );
  } finally {
    await stopServer(server);
  }
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maher-test-"));

  const liveDb = resolveLiveDatabaseFile();
  const liveBefore = hashFile(liveDb);
  console.log(`Live database guard: ${liveDb} (${liveBefore ?? "missing"})`);

  const baseEnv = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
  };

  const requested = (process.env.MAHER_TEST_SUITES || "").trim();
  const suites = requested
    ? requested.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SUITES;
  if (suites.length === 0) throw new Error("MAHER_TEST_SUITES listed no suites");
  console.log(`Suites: ${suites.join(", ")}`);

  const problems = [];
  let liveChangedBy = null;
  try {
    // One production build for all suites; it only needs *a* migrated DB.
    const buildDir = path.join(tempRoot, "build");
    const buildDb = path.join(buildDir, "build.db");
    const buildEnv = {
      ...baseEnv,
      MAHER_DB_PATH: buildDb,
      DATABASE_URL: `file:${buildDb}`,
      MAHER_BACKUP_DIR: path.join(buildDir, "backups"),
    };
    fs.mkdirSync(buildEnv.MAHER_BACKUP_DIR, { recursive: true });
    await run(NPX, ["prisma", "migrate", "deploy"], buildEnv, "prisma migrate deploy");
    await run(NPX, ["prisma", "generate"], buildEnv, "prisma generate");
    await run(NPM, ["run", "build"], buildEnv, "next build");

    for (let i = 0; i < suites.length; i++) {
      const suite = suites[i];
      try {
        await runSuite(suite, i, tempRoot, baseEnv);
      } finally {
        // Identify the exact suite if a bug ever writes to the live shop DB.
        if (hashFile(liveDb) !== liveBefore) liveChangedBy = suite;
      }
      if (liveChangedBy) break;
    }
  } catch (e) {
    problems.push(e.message);
  } finally {
    if (!liveChangedBy && hashFile(liveDb) !== liveBefore) {
      liveChangedBy = "an unknown step";
    }
    if (liveChangedBy) {
      problems.push(`live database changed during ${liveChangedBy}`);
      console.error(`LIVE DATABASE CHANGED: ${liveDb}`);
    } else {
      console.log(`Live database untouched: ${liveDb}`);
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch (e) {
      console.error(`temp cleanup failed (ignored): ${e.message}`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`NPM TEST FAILED: ${problem}`);
    }
    process.exit(1);
  }
  console.log(
    `\n${requested ? "ALL SELECTED SUITES" : "ALL SUITES"} PASSED — live database untouched.`
  );
}

main().catch((e) => {
  console.error(`NPM TEST FAILED: ${e.message}`);
  process.exit(1);
});
