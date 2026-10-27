/**
 * Keeps the shop's data alive across a package rebuild.
 *
 * `npm run build:portable` starts by deleting the whole out/MAHER folder, and
 * out/MAHER/data is where the client's shop.db and backups live — the rebuild
 * after the service-list redesign deleted a real database that way. The build
 * now copies data/ and logs/ out to a hold folder before the delete and copies
 * them back afterwards.
 *
 * Two rules this exists to enforce:
 *
 * 1. The hold must live *outside* the package, or the delete takes it too.
 * 2. The data must go back *after* assertNoShopData() has run — restoring
 *    earlier would hand the leak check a database and fail the build for
 *    shipping shop data, which is exactly the check that must keep working.
 *
 * No side effects at import time: the build calls these explicitly, and the
 * tests drive them against throwaway folders.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The package folders that belong to the shop, never to the build. */
export const KEEP_DIRS = ["data", "logs"];

/**
 * Copies the keep folders to a hold outside the package.
 *
 * Returns null when there is nothing to keep (a first build). Returns
 * `{ dir, dirs }` otherwise. A copy failure throws *before* anything is
 * deleted — the build must never reach the delete step with no backup.
 */
export function preservePackageData(outDir, holdParent = os.tmpdir()) {
  const dirs = KEEP_DIRS.filter((name) => fs.existsSync(path.join(outDir, name))).sort();
  if (dirs.length === 0) return null;

  const dir = fs.mkdtempSync(path.join(holdParent, "maher-keep-"));
  try {
    for (const name of dirs) {
      fs.cpSync(path.join(outDir, name), path.join(dir, name), { recursive: true });
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, dirs };
}

/**
 * Copies the kept folders back into a freshly built package, merging into
 * whatever the build created there: the shop's own files are authoritative,
 * and files the build wrote alongside them are left alone. A folder that is
 * missing from the hold is reported in `skipped` rather than throwing; a copy
 * that fails throws and leaves the hold in place, so the data is never one
 * error away from being lost.
 */
export function restorePackageData(outDir, hold) {
  if (!hold) return { restored: [], skipped: [] };

  const restored = [];
  const skipped = [];
  for (const name of [...hold.dirs].sort()) {
    const from = path.join(hold.dir, name);
    if (!fs.existsSync(from)) {
      skipped.push(name);
      continue;
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(from, path.join(outDir, name), { recursive: true });
    restored.push(name);
  }
  return { restored, skipped };
}

/** Drops the hold once the data is safely back in the package. */
export function releaseHold(hold) {
  if (!hold) return;
  fs.rmSync(hold.dir, { recursive: true, force: true });
}
