"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Next 14's standalone tracer follows the CommonJS side of a package's
 * `exports` map. Several dependencies also expose `.mjs`/`.mts`/`.cjs` entry
 * points that the tracer never copies — for example generator-function's
 * `require.mjs`. On the developer machine Node silently resolves the missing
 * file from the repository's own node_modules; in the shipped package it is
 * gone and GET /api/backup dies with MODULE_NOT_FOUND.
 *
 * Restore only those missing entry files from the repository node_modules,
 * never overwriting what the tracer did include.
 */
function collectRefs(value, out) {
  if (typeof value === "string" && value.startsWith(".")) {
    out.add(value.replace(/^\.\//, ""));
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectRefs(item, out);
  }
}

function packageNames(modulesDir) {
  const names = [];
  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(modulesDir, entry.name);
      for (const scoped of fs.readdirSync(scopeDir, { withFileTypes: true })) {
        if (scoped.isDirectory()) names.push(path.join(entry.name, scoped.name));
      }
    } else {
      names.push(entry.name);
    }
  }
  return names;
}

function restoreMissingEntryPoints({ sourceModules, targetModules }) {
  const restored = [];
  if (!fs.existsSync(sourceModules) || !fs.existsSync(targetModules)) return restored;

  for (const name of packageNames(sourceModules)) {
    const sourcePkg = path.join(sourceModules, name);
    const targetPkg = path.join(targetModules, name);
    if (!fs.existsSync(path.join(targetPkg, "package.json"))) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(sourcePkg, "package.json"), "utf8"));
    } catch {
      continue;
    }

    const refs = new Set();
    if (manifest.exports) collectRefs(manifest.exports, refs);
    if (manifest.module) collectRefs(manifest.module, refs);

    for (const ref of refs) {
      // Only known entry extensions, and never a path that escapes the package.
      if (!/\.(mjs|mts|cjs)$/.test(ref) || ref.includes("..")) continue;
      const sourceFile = path.join(sourcePkg, ref);
      const targetFile = path.join(targetPkg, ref);
      if (!fs.existsSync(sourceFile) || fs.existsSync(targetFile)) continue;
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.copyFileSync(sourceFile, targetFile);
      restored.push(path.join(name, ref).split(path.sep).join("/"));
    }
  }
  return restored;
}

module.exports = { restoreMissingEntryPoints };
