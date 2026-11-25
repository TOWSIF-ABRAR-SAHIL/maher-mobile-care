"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Installed MSS never keeps shop data on C:. The assisted NSIS installer writes
 * the chosen folder into `mss-data-root.txt` beside MSS.exe (and into the
 * registry for the next update). This resolver is deliberately free of Electron
 * so the no-C contract can be tested without launching an app.
 */
const DEFAULT_DATA_ROOT = "D:\\MSS-Data";
const DATA_ROOT_FILENAME = "mss-data-root.txt";

function isOnDriveC(value) {
  if (typeof value !== "string") return false;
  return /^c:/i.test(value.trim().replace(/^["']+|["']+$/g, ""));
}

function resolveDataRoot({
  env = process.env,
  exeDir,
  appData,
  isPackaged = true,
  fsModule = fs,
  pathModule = path,
} = {}) {
  // Dev mode and throwaway test suites pass an explicit root. They are trusted
  // callers, not the installed shop app, so their temp path may be on C:.
  const fromEnv = env.MAHER_USER_DATA_DIR?.trim();
  if (fromEnv) {
    const root = pathModule.resolve(fromEnv);
    // Dev/test callers pass a throwaway root; the installed shop app must obey
    // the wizard's no-C rule even if someone launches it with an env override.
    if (isPackaged && isOnDriveC(root)) {
      throw new Error(
        `MSS data root cannot be on drive C: (${root}). Re-run MSS-Setup and choose a non-C drive.`
      );
    }
    return { root, source: "env" };
  }

  if (!exeDir) {
    throw new Error("MSS data root needs the installed executable directory");
  }
  const pointerFile = pathModule.join(exeDir, DATA_ROOT_FILENAME);
  if (fsModule.existsSync(pointerFile)) {
    const raw = fsModule.readFileSync(pointerFile, "utf8").trim();
    if (!raw) {
      throw new Error(
        `MSS data pointer ${pointerFile} is empty. Re-run MSS-Setup and choose a non-C drive.`
      );
    }
    if (isOnDriveC(raw)) {
      throw new Error(
        `MSS data root cannot be on drive C: (${raw}). Re-run MSS-Setup and choose a non-C drive.`
      );
    }
    return { root: pathModule.resolve(raw), source: "installer", pointerFile };
  }

  // Only an unpacked dev launch may fall back to AppData. A packaged app with
  // no pointer must fail loudly instead of silently writing shop data to C:.
  if (!isPackaged) {
    if (!appData) {
      throw new Error("MSS dev data root needs an appData directory");
    }
    return { root: pathModule.join(appData, "MSS"), source: "dev-fallback" };
  }

  throw new Error("MSS data folder is not configured. Re-run MSS-Setup and choose a non-C drive.");
}

module.exports = { DEFAULT_DATA_ROOT, DATA_ROOT_FILENAME, isOnDriveC, resolveDataRoot };
