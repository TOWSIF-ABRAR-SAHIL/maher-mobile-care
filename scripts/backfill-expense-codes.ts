/* Repair shop-expense values from older versions.
 *
 * v1.0.3 stored a raw code (e.g. "*M#") but always stored expenseAmount = 0.
 * v1.1.2 stored a plain number ("1500") as typed. v1.1.3 makes the keypad code
 * canonical: numbers are converted on save, codes stay codes, and expenseAmount
 * is decoded for both.
 *
 * This script:
 *   - converts plain-number rows to canonical codes (e.g. 1500 -> *J#)
 *   - repairs expenseAmount for codes/numbers
 *   - rebuilds a code for an empty shopExpense + positive expenseAmount
 *   - leaves invalid/negative/oversized values untouched and lists them
 *
 * SAFE BY DEFAULT: prints what would change and exits. Pass --confirm to
 * actually update the database selected by the normal app resolver.
 *
 *   npx tsx scripts/backfill-expense-codes.ts
 *   npx tsx scripts/backfill-expense-codes.ts --confirm
 */
import { prisma } from "../lib/prisma";
import { resolveDatabaseFile } from "../lib/db-path";
import {
  encodeShopExpenseAmount,
  normalizeShopExpense,
} from "../lib/expense-code";

const CONFIRM = process.argv.includes("--confirm");

type Change = {
  id: number;
  beforeCode: string | null;
  afterCode: string | null;
  beforeAmount: number;
  afterAmount: number;
  kind: "number" | "code" | "empty";
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
  let alreadyCorrect = 0;

  for (const row of rows) {
    const beforeCode = row.shopExpense ?? null;
    const normalized = normalizeShopExpense(beforeCode);
    if (normalized.kind === "invalid") {
      invalid.push({ id: row.id, raw: String(beforeCode ?? "") });
      continue;
    }
    let afterCode = normalized.stored;
    let afterAmount = normalized.amount ?? 0;
    let kind: Change["kind"] =
      normalized.kind === "number"
        ? "number"
        : normalized.kind === "empty"
          ? "empty"
          : "code";
    // Empty raw value + a non-zero ledger amount: keep the money by rebuilding
    // its code instead of clearing the expense. A negative amount is invalid
    // data for the audit, never something to zero out silently.
    if (normalized.kind === "empty" && row.expenseAmount < 0) {
      invalid.push({
        id: row.id,
        raw: `empty code + negative expenseAmount ${row.expenseAmount}`,
      });
      continue;
    }
    if (
      normalized.kind === "empty" &&
      Number.isSafeInteger(row.expenseAmount) &&
      row.expenseAmount > 0
    ) {
      try {
        afterCode = encodeShopExpenseAmount(row.expenseAmount);
        afterAmount = row.expenseAmount;
        kind = "number";
      } catch {
        invalid.push({
          id: row.id,
          raw: `empty code + expenseAmount ${row.expenseAmount}`,
        });
        continue;
      }
    }
    if (afterCode === beforeCode && afterAmount === row.expenseAmount) {
      alreadyCorrect += 1;
      continue;
    }
    changes.push({
      id: row.id,
      beforeCode,
      afterCode,
      beforeAmount: row.expenseAmount,
      afterAmount,
      kind,
    });
  }

  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`Needs change: ${changes.length}`);
  if (invalid.length > 0) {
    console.log(`Invalid legacy values (left untouched): ${invalid.length}`);
  }

  for (const row of changes.slice(0, 100)) {
    const code =
      row.beforeCode === row.afterCode
        ? JSON.stringify(row.afterCode)
        : `${JSON.stringify(row.beforeCode)} -> ${JSON.stringify(row.afterCode)}`;
    console.log(
      `  #${row.id}  ${code}  amount ${row.beforeAmount} -> ${row.afterAmount} (${row.kind})`
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
      console.log("\nDry run only. Re-run with --confirm to apply these changes.");
    }
    return;
  }

  if (changes.length === 0) {
    console.log("Nothing to change.");
    return;
  }

  const updated = await prisma.$transaction(
    changes.map((row) =>
      prisma.service.update({
        where: { id: row.id },
        data: {
          shopExpense: row.afterCode,
          expenseAmount: row.afterAmount,
        },
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
