/**
 * One-time cleanup: remove the test artifacts that the E2E scripts
 * (scripts/e2e-*.js, lane*.js) archived into the live database.
 *
 *   npm run cleanup:test-data             → dry run (lists rows, deletes nothing)
 *   npm run cleanup:test-data -- --confirm → safety snapshot, then deletes
 *
 * Only rows whose customerName matches the known test patterns are touched;
 * real shop records never match them.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolveBackupDir } from "../lib/db-path";
import { prisma } from "../lib/prisma";

const confirm = process.argv.includes("--confirm");

/** Prefixes/exact names used by the E2E scripts. */
const TEST_WHERE = {
  OR: [
    { customerName: { startsWith: "E2E Test " } },
    { customerName: { startsWith: "TestKarim" } },
    { customerName: { startsWith: "P0 UI Row" } },
    { customerName: { startsWith: "DbgRow" } },
    { customerName: "FixedName" },
    { customerName: "ApiMark" },
  ],
};

const pad = (n: number) => String(n).padStart(2, "0");

async function main() {
  const rows = await prisma.service.findMany({
    where: TEST_WHERE,
    orderBy: { id: "asc" },
  });

  if (rows.length === 0) {
    console.log("কোনো টেস্ট-ডেটা পাওয়া যায়নি — পরিষ্কার করার কিছু নেই।");
    return;
  }

  console.log(`Found ${rows.length} test row(s):`);
  for (const r of rows) {
    console.log(
      `  #${r.id} | ${r.customerName} | ${r.technician} | ${
        r.archived ? "archived" : "LIVE"
      } | ${new Date(r.serviceDate).toISOString().slice(0, 10)}`
    );
  }

  if (!confirm) {
    console.log(
      "\nDry run — nothing deleted. Re-run with --confirm to delete these rows."
    );
    return;
  }

  // Safety snapshot first, using the same naming the backup list recognises.
  const dir = resolveBackupDir();
  mkdirSync(dir, { recursive: true });
  const d = new Date();
  const safety = `safety-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
    d.getDate()
  )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${String(
    d.getMilliseconds()
  ).padStart(3, "0")}.db`;
  await prisma.$executeRawUnsafe(
    `VACUUM INTO '${join(dir, safety).replace(/'/g, "''")}'`
  );
  console.log(`\nSafety snapshot: backups/${safety}`);

  const { count } = await prisma.service.deleteMany({
    where: { id: { in: rows.map((r) => r.id) } },
  });
  console.log(`Deleted ${count} test row(s). Real records were kept.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
