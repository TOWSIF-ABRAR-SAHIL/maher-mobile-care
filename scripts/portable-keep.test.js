/* What the package rebuild must never lose: the shop's data folder.
 *
 * Rebuilding with `npm run build:portable` starts by deleting the whole
 * out/MAHER folder — and out/MAHER/data is where the shop's database lives.
 * That deleted a real database once (the rebuild after the service-list
 * redesign), so the preservation is pinned down here rather than left to the
 * build's control flow.
 *
 * Pure filesystem logic: no server, no database engine, no network.
 */
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  KEEP_DIRS,
  preservePackageData,
  restorePackageData,
  releaseHold,
} = require("./portable-keep.mjs");

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

const DB_BYTES = Buffer.from("SQLite format 3\0fake shop records");

/** A package as it looks before a rebuild: app files plus a live data folder. */
function makePackage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pk-pkg-"));
  fs.mkdirSync(path.join(root, "data", "backups"), { recursive: true });
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "shop.db"), DB_BYTES);
  fs.writeFileSync(path.join(root, "data", "backups", "snapshot.db"), "backup");
  fs.writeFileSync(path.join(root, "data", "KEEP-THIS-FOLDER.txt"), "do not delete\n");
  fs.writeFileSync(path.join(root, "logs", "maher.log"), "started\n");
  fs.writeFileSync(path.join(root, "server.js"), "built artifact");
  return root;
}

const clean = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// --- what gets kept --------------------------------------------------------

check("PK-01", "a fresh package has nothing to keep", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pk-empty-"));
  try {
    assert.strictEqual(preservePackageData(root), null);
  } finally {
    clean(root);
  }
});

check("PK-02", "only the data and logs folders are ever copied", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    assert.ok(hold && hold.dir, "preservePackageData must return a hold");
    const kept = fs.readdirSync(hold.dir).sort();
    assert.deepStrictEqual(kept, [...KEEP_DIRS].sort());
    assert.ok(!kept.includes("server.js"), "built app files must not be kept");
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-03", "the copy is byte-identical and the original stays put", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    const original = fs.readFileSync(path.join(root, "data", "shop.db"));
    assert.ok(original.equals(DB_BYTES), "test fixture changed");
    assert.ok(
      fs.readFileSync(path.join(hold.dir, "data", "shop.db")).equals(DB_BYTES),
      "the kept copy must match the database byte for byte"
    );
    assert.ok(fs.existsSync(path.join(root, "data", "shop.db")), "preserve must not move the data away");
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-04", "the hold lives outside the package, so deleting it cannot take the data", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    assert.ok(
      !path.resolve(hold.dir).startsWith(path.resolve(root) + path.sep),
      "hold dir must be outside out/MAHER"
    );
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-05", "data comes back after the package folder is deleted", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    // Exactly what the build does next.
    fs.rmSync(root, { recursive: true, force: true });
    assert.ok(!fs.existsSync(path.join(root, "data")), "fixture: package should be gone");

    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "KEEP-THIS-FOLDER.txt"), "placeholder\n");
    const outcome = restorePackageData(root, hold);

    assert.deepStrictEqual(outcome.restored, [...KEEP_DIRS].sort());
    assert.ok(
      fs.readFileSync(path.join(root, "data", "shop.db")).equals(DB_BYTES),
      "the shop database must survive a rebuild"
    );
    assert.strictEqual(fs.readFileSync(path.join(root, "logs", "maher.log"), "utf8"), "started\n");
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-06", "restoring merges instead of replacing the folder the build created", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "KEEP-THIS-FOLDER.txt"), "placeholder\n");
    fs.writeFileSync(path.join(root, "data", "written-by-the-build.txt"), "fresh\n");

    restorePackageData(root, hold);

    // The shop's own files win, and anything the build wrote alongside them is
    // left alone: the whole folder is never swapped out wholesale.
    assert.strictEqual(
      fs.readFileSync(path.join(root, "data", "KEEP-THIS-FOLDER.txt"), "utf8"),
      "do not delete\n",
      "the kept copy is authoritative"
    );
    assert.strictEqual(fs.readFileSync(path.join(root, "data", "written-by-the-build.txt"), "utf8"), "fresh\n");
    assert.ok(fs.existsSync(path.join(root, "data", "shop.db")));
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-07", "a missing hold is a no-op, not a crash", () => {
  const root = makePackage();
  try {
    const outcome = restorePackageData(root, null);
    assert.deepStrictEqual(outcome, { restored: [], skipped: [] });
  } finally {
    clean(root);
  }
});

check("PK-08", "a folder missing from the hold is skipped and reported", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    // Simulate a hold that lost logs/ (partial copy, manual tampering).
    fs.rmSync(path.join(hold.dir, "logs"), { recursive: true, force: true });

    const outcome = restorePackageData(root, hold);
    assert.deepStrictEqual(outcome.restored, ["data"]);
    assert.deepStrictEqual(outcome.skipped, ["logs"]);
    assert.ok(fs.existsSync(path.join(root, "data", "shop.db")));
  } finally {
    if (hold) releaseHold(hold);
    clean(root);
  }
});

check("PK-09", "releaseHold removes only its own folder", () => {
  const root = makePackage();
  let hold = null;
  try {
    hold = preservePackageData(root);
    const holdDir = hold.dir;
    releaseHold(hold);
    assert.ok(!fs.existsSync(holdDir), "the hold must be cleaned up");
    assert.ok(fs.existsSync(path.join(root, "data", "shop.db")), "the package data is untouched");
    releaseHold(hold); // second release is harmless
  } finally {
    clean(root);
  }
});

// --- the build has to actually use it --------------------------------------

check("PK-10", "the build preserves before deleting and restores on the success path", () => {
  const source = fs.readFileSync(path.join(__dirname, "build-portable.mjs"), "utf8");
  const preserveAt = source.indexOf("preservePackageData(");
  const deleteAt = source.indexOf("fs.rmSync(outDir,");
  const leakCheckAt = source.indexOf("assertNoShopData(outDir)");
  const verifyAt = source.indexOf("verifying the package in isolation");
  const restoredAfterLeakCheck = source.slice(leakCheckAt).indexOf("restorePackageData(");

  assert.ok(preserveAt > 0, "build-portable.mjs must call preservePackageData");
  assert.ok(deleteAt > 0, "build-portable.mjs must still delete outDir before rebuilding");
  assert.ok(leakCheckAt > 0, "the no-shop-data assertion must stay");
  assert.ok(preserveAt < deleteAt, "data must be kept before out/MAHER is deleted");
  // Restoring earlier would make assertNoShopData see a database and fail the
  // build for shipping shop data — which is exactly what it must keep doing.
  assert.ok(leakCheckAt >= 0 && restoredAfterLeakCheck > 0, "restore must happen after the leak check");
  assert.ok(
    leakCheckAt + restoredAfterLeakCheck < verifyAt,
    "data must be back before the isolation verification"
  );
});

for (const line of results) console.log(line);
