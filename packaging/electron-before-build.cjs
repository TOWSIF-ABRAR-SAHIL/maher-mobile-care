"use strict";

/**
 * electron-builder's automatic dependency walker finds the repository's
 * node_modules two levels above the Electron shell and copies all production
 * packages into app.asar (~200 MB). The Electron entry files only require
 * `electron` and Node built-ins; the Next server and its native modules are
 * copied separately into resources/app by extraResources.
 *
 * Returning false tells electron-builder that node_modules are handled
 * externally, so ASAR stays a few kilobytes.
 */
module.exports.beforeBuild = async function beforeBuild() {
  return false;
};
