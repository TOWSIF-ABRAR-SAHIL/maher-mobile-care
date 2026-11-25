"use strict";

const path = require("node:path");

/**
 * Build the environment for the bundled Node child that serves the Next
 * standalone app. Keeping this pure lets the loopback/AppData contract be
 * tested without the electron package installed.
 */
function buildChildEnv({ userRoot, appDir, port, baseEnv = process.env }) {
  if (!userRoot) throw new Error("userRoot is required");
  if (!appDir) throw new Error("appDir is required");
  if (!port) throw new Error("port is required");

  const root = path.resolve(userRoot);
  const appRoot = path.resolve(appDir);
  const dbPath = path.join(root, "data", "shop.db");
  const fileUrl = dbPath.replace(/\\/g, "/").replace(/ /g, "%20");

  return {
    ...baseEnv,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1", // the API has no auth — never 0.0.0.0
    PORT: String(port),
    MAHER_USER_DATA_DIR: root,
    MAHER_DB_PATH: dbPath,
    MAHER_BACKUP_DIR: path.join(root, "data", "backups"),
    MAHER_MIGRATIONS_DIR: path.join(appRoot, "prisma", "migrations"),
    DATABASE_URL: `file:///${fileUrl}`,
    __MAHER_APP__: appRoot,
    NODE_PATH: "",
  };
}

/** Only user-initiated chat/call/mail intents may leave the desktop app. */
function isAllowedExternalUrl(url) {
  if (typeof url !== "string") return false;
  return /^(https?:\/\/(wa\.me|web\.whatsapp\.com)(?:\/|\?)|tel:|mailto:)/i.test(url);
}

module.exports = { buildChildEnv, isAllowedExternalUrl };
