/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server in .next/standalone (28 MB instead of ~1 GB).
  //
  // Opt-in via MAHER_STANDALONE=1, which scripts/build-portable.mjs sets. Next
  // 14 warns that `next start` is not the supported entry point in this mode, so
  // the default build keeps working with `next start` for local development and
  // for scripts/run-tests.js. The Windows package launches server.js directly.
  ...(process.env.MAHER_STANDALONE === "1" ? { output: "standalone" } : {}),
  // NOTE: Next 14 has no outputFileTracingExcludes, so the standalone trace
  // still follows ./backups and copies .env into .next/standalone.
  // scripts/build-portable.mjs deletes those during packaging so no developer
  // shop data ever ships to a client. Do not relax that check.
  // better-sqlite3 is a native module — keep it out of the webpack bundle.
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};

export default nextConfig;
