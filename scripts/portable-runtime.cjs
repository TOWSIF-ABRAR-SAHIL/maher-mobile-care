"use strict";

const { execFileSync } = require("node:child_process");

/**
 * Actually executes a candidate node.exe before it is allowed into a package.
 *
 * A cached ZIP can pass an entry-listing check yet still leave behind a broken
 * extraction from an earlier, truncated download: the file exists with the
 * right size, but exits with 0xC0000005 before printing even its version. A
 * stale binary like that used to be copied into runtime/ and the build failed
 * much later, inside the isolated first-run check with an opaque exit code.
 *
 * Runs the real binary rather than trusting file size or a PE header. Nothing
 * is written: this only spawns node.exe with read-only flags.
 */
function runtimePreflight(nodeExe, expectedVersion, expectedAbi) {
  const options = {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  };
  try {
    const version = execFileSync(nodeExe, ["-v"], options).trim();
    if (version !== `v${expectedVersion}`) {
      return { ok: false, reason: `expected v${expectedVersion} but got ${version || "no output"}` };
    }
    const abi = execFileSync(nodeExe, ["-p", "process.versions.modules"], options).trim();
    if (expectedAbi && abi !== String(expectedAbi)) {
      return { ok: false, reason: `expected ABI ${expectedAbi} but got ${abi || "no output"}` };
    }
    return { ok: true, reason: `${version} / ABI ${abi}` };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
}

module.exports = { runtimePreflight };
