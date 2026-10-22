/* One-time repair for shop-expense values saved before v1.0.4.
 *
 * v1.0.3 stored the raw code (e.g. "*M#") but always stored
 * expenseAmount = 0 for it. v1.0.4 decodes on every new save; this script
 * repairs old rows without touching the raw code shown in the UI.
 *
 * SAFE BY DEFAULT: prints what would change and exits. Pass --confirm to
 * actually update the database selected by the normal app resolver.
 *
 *   npx tsx scripts/backfill-expense-codes.ts
 *   npx tsx scripts/backfill-expense-codes.ts --confirm
 */
import { prisma } from "../lib/prisma";
import { resolveDatabaseFile } from "../lib/db-path";
import { decodeShopExpense } from "../lib/expense-code";

const CONFIRM = process.argv.includes("--confirm");

type Change = {
  id: number;
  raw: string;
  before: number;
  after: number;
  kind: "number" | "code";
};

async function main() {
  const dbFile = resolveDatabaseFile();
  console.log(`Database: ${dbFile}`);
  console.log(
    CONFIRM
      ? "Mode: CONFIRM (changes will be written)"
      : "Mode: DRY RUN (no changes; pass --confirm to write)"
  );

  const rows = await prisma.service.findMany({
    select: { id: true, shopExpense: true, expenseAmount: true },
    orderBy: { id: "asc" },
  });

  const changes: Change[] = [];
  const invalid: { id: number; raw: string }[] = [];
  let empty = 0;
  let unchanged = 0;

  for (const row of rows) {
    const raw = String(row.shopExpense ?? "").trim();
    if (!raw) {
      empty += 1;
      continue;
    }
    const decoded = decodeShopExpense(raw);
    if (decoded.kind === "invalid") {
      invalid.push({ id: row.id, raw });
      continue;
    }
    if (decoded.amount === null || decoded.amount === row.expenseAmount) {
      unchanged += 1;
      continue;
    }
    changes.push({
      id: row.id,
      raw,
      before: row.expenseAmount,
      after: decoded.amount,
      kind: decoded.kind === "number" ? "number" : "code",
    });
  }

  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Empty expense: ${empty}`);
  console.log(`Already correct: ${unchanged}`);
  console.log(`Needs repair: ${changes.length}`);
  if (invalid.length > 0) {
    console.log(`Invalid legacy values (left untouched): ${invalid.length}`);
  }

  for (const row of changes.slice(0, 100)) {
    console.log(
      `  #${row.id}  ${JSON.stringify(row.raw)}  ${row.before} -> ${row.after} (${row.kind})`
    );
  }
  if (changes.length > 100) {
    console.log(`  ... and ${changes.length - 100} more`);
  }
  for (const row of invalid.slice(0, 20)) {
    console.log(`  #${row.id}  INVALID ${JSON.stringify(row.raw)}`);
  }
  if (invalid.length > 20) {
    console.log(`  ... and ${invalid.length - 20} more invalid rows`);
  }

  if (!CONFIRM) {
    if (changes.length > 0) {
      console.log("\nDry run only. Re-run with --confirm to apply these repairs.");
    }
    return;
  }

  if (changes.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  const updated = await prisma.$transaction(
    changes.map((row) =>
      prisma.service.update({
        where: { id: row.id },
        data: { expenseAmount: row.after },
      })
    )
  );
  console.log(`Updated ${updated.length} row(s).`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
