"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");
const DB_LOCATION_FILENAME = "maher-db-location.json";
// Legacy desktop builds used the platform brand, then the old product name.
const LEGACY_APP_DIRS = ["MSS", "MAHER-MOBILE-CARE"];

function hasSqliteHeader(file, fsModule) {
  try {
    const fd = fsModule.openSync(file, "r");
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    try {
      fsModule.readSync(fd, header, 0, header.length, 0);
    } finally {
      fsModule.closeSync(fd);
    }
    return header.equals(SQLITE_MAGIC);
  } catch {
    return false;
  }
}

function legacyDatabaseFor(legacyData, fsModule, pathModule) {
  const candidates = [pathModule.join(legacyData, "shop.db")];

  // An older install may have used the dashboard's custom DB location. Read the
  // pointer to find the real ledger, but never carry the pointer itself into
  // the new root — that could send the app back to a forbidden C: path.
  try {
    const pointerFile = pathModule.join(legacyData, DB_LOCATION_FILENAME);
    const parsed = JSON.parse(fsModule.readFileSync(pointerFile, "utf8"));
    const raw = typeof parsed?.customDbPath === "string" ? parsed.customDbPath.trim() : "";
    if (raw) {
      let value = raw.replace(/^["']+|["']+$/g, "");
      if (/^file:/i.test(value)) value = value.slice(5);
      candidates.unshift(
        pathModule.isAbsolute(value) ? pathModule.normalize(value) : pathModule.resolve(legacyData, value)
      );
    }
  } catch {
    // No pointer, or an unreadable pointer — fall back to the default DB.
  }

  return candidates.find((candidate) => hasSqliteHeader(candidate, fsModule)) || null;
}

/**
 * A pre-assisted installer kept shop.db under %AppData%\MSS (or the earlier
 * %AppData%\MAHER-MOBILE-CARE). An update to the assisted installer moves only
 * that database and its backups into the newly chosen non-C folder. The old
 * files are left untouched as a safety copy; an existing current DB is never
 * overwritten, so a later run is a no-op.
 */
function migrateLegacyData({ root, appData, fsModule = fs, pathModule = path } = {}) {
  if (!root) throw new Error("migration needs the current data root");
  if (!appData) throw new Error("migration needs the legacy AppData directory");

  const currentData = pathModule.join(root, "data");
  const currentDb = pathModule.join(currentData, "shop.db");
  if (fsModule.existsSync(currentDb)) {
    return { migrated: false, reason: "current database exists" };
  }

  for (const appDir of LEGACY_APP_DIRS) {
    const legacyRoot = pathModule.join(appData, appDir);
    const legacyData = pathModule.join(legacyRoot, "data");
    const sourceDb = legacyDatabaseFor(legacyData, fsModule, pathModule);
    if (!sourceDb) continue;

    fsModule.mkdirSync(currentData, { recursive: true });
    const exclusive = fsModule.constants?.COPYFILE_EXCL ?? 1;
    fsModule.copyFileSync(sourceDb, currentDb, exclusive);

    const sourceBackups = pathModule.join(pathModule.dirname(sourceDb), "backups");
    if (fsModule.existsSync(sourceBackups)) {
      const targetBackups = pathModule.join(currentData, "backups");
      fsModule.mkdirSync(targetBackups, { recursive: true });
      for (const name of fsModule.readdirSync(sourceBackups)) {
        if (!/\.db$/i.test(name)) continue;
        const target = pathModule.join(targetBackups, name);
        if (!fsModule.existsSync(target)) {
          fsModule.copyFileSync(pathModule.join(sourceBackups, name), target, exclusive);
        }
      }
    }

    return { migrated: true, from: legacyRoot, to: root };
  }

  return { migrated: false, reason: "no legacy database" };
}

module.exports = { migrateLegacyData };
