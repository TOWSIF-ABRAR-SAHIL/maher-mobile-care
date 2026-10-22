/* Money/ledger integrity audit for the local MAHER database.
 *
 * SAFE BY DEFAULT: reads every row and prints problems without writing.
 * Pass --confirm to apply only the conservative repairs listed below.
 *
 *   npx tsx scripts/audit-money.ts
 *   npx tsx scripts/audit-money.ts --confirm
 *
 * Conservative repairs (with --confirm):
 *   - numeric/legacy shopExpense → canonical code + correct expenseAmount
 *   - empty shopExpense + non-zero expenseAmount → rebuilt canonical code
 *   - non-returned due ≠ bill − advance → recompute due
 *   - Returned due ≠ 0 → 0; refundAmount ≠ advance → advance
 *
 * Reported but never auto-changed:
 *   - invalid expense codes, unknown statuses, negative values
 *   - advance > bill (overpay), returnedAt timestamp inconsistencies
 *   - refundAmount on a non-returned row
 *
 * Archived rows are included in the scan: reports exclude them, but a restored
 * row must still be internally consistent.
 */
import { prisma } from "../lib/prisma";
import { resolveDatabaseFile } from "../lib/db-path";
import {
  encodeShopExpenseAmount,
  normalizeShopExpense,
} from "../lib/expense-code";
import {
  RETURNED_STATUS,
  STATUSES,
  computeDue,
} from "../lib/utils";

const CONFIRM = process.argv.includes("--confirm");

type FixData = {
  shopExpense?: string | null;
  expenseAmount?: number;
  due?: number;
  refundAmount?: number;
};

type FixRow = {
  id: number;
  problems: string[];
  data: FixData;
};

type Unfixable = {
  id: number;
  problem: string;
};

async function main() {
  const dbFile = resolveDatabaseFile();
  console.log(`Database: ${dbFile}`);
  console.log(
    CONFIRM
      ? "Mode: CONFIRM (conservative repairs will be written)"
      : "Mode: DRY RUN (no changes; pass --confirm to write)"
  );

  const rows = await prisma.service.findMany({ orderBy: { id: "asc" } });
  const fixes: FixRow[] = [];
  const unfixable: Unfixable[] = [];
  let archivedReturnedWithMoney = 0;

  for (const row of rows) {
    const problems: string[] = [];
    const fix: FixData = {};
    const beforeCode = row.shopExpense ?? null;

    const normalized = normalizeShopExpense(beforeCode);
    if (normalized.kind === "invalid") {
      unfixable.push({
        id: row.id,
        problem: `invalid shopExpense ${JSON.stringify(beforeCode)}`,
      });
    } else if (normalized.kind === "empty" && row.expenseAmount < 0) {
      // Never silently turn a negative ledger value into 0; report it.
      unfixable.push({
        id: row.id,
        problem: `empty shopExpense with negative expenseAmount ${row.expenseAmount}`,
      });
    } else if (normalized.kind === "empty" && row.expenseAmount > 0) {
      // An amount-only row is still real spend. Rebuild a display code instead
      // of clearing it from the profit calculation. An oversized amount stays
      // manual, never zeroed.
      try {
        const code = encodeShopExpenseAmount(row.expenseAmount);
        fix.shopExpense = code;
        fix.expenseAmount = row.expenseAmount;
        problems.push(
          `expense ${JSON.stringify(beforeCode)}/${row.expenseAmount} → ${JSON.stringify(
            code
          )}/${row.expenseAmount}`
        );
      } catch {
        unfixable.push({
          id: row.id,
          problem: `empty shopExpense with unencodable amount ${row.expenseAmount}`,
        });
      }
    } else {
      const nextCode = normalized.stored;
      const nextAmount = normalized.amount ?? 0;
      if (nextCode !== beforeCode || nextAmount !== row.expenseAmount) {
        fix.shopExpense = nextCode;
        fix.expenseAmount = nextAmount;
        problems.push(
          `expense ${JSON.stringify(beforeCode)}/${row.expenseAmount} → ${JSON.stringify(
            nextCode
          )}/${nextAmount}`
        );
      }
    }

    if (!(STATUSES as readonly string[]).includes(row.status)) {
      unfixable.push({
        id: row.id,
        problem: `unknown status ${JSON.stringify(row.status)}`,
      });
    }

    for (const [field, value] of [
      ["totalBill", row.totalBill],
      ["advance", row.advance],
      ["due", row.due],
      ["expenseAmount", row.expenseAmount],
      ["damageLoss", row.damageLoss],
      ["refundAmount", row.refundAmount],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        unfixable.push({
          id: row.id,
          problem: `${field} is not a non-negative integer (${value})`,
        });
      }
    }

    const returned = row.status === RETURNED_STATUS;
    if (returned) {
      if (row.due !== 0) {
        fix.due = 0;
        problems.push(`returned due ${row.due} → 0`);
      }
      if (
        row.refundAmount !== row.advance &&
        Number.isInteger(row.advance) &&
        row.advance >= 0
      ) {
        fix.refundAmount = row.advance;
        problems.push(`returned refund ${row.refundAmount} → ${row.advance}`);
      }
      if (!row.returnedAt) {
        unfixable.push({ id: row.id, problem: "Returned row has no returnedAt" });
      }
      if (
        row.archived &&
        (row.refundAmount > 0 || row.expenseAmount > 0 || row.damageLoss > 0)
      ) {
        archivedReturnedWithMoney += 1;
      }
    } else {
      const expectedDue = computeDue(row.totalBill, row.advance);
      if (row.due !== expectedDue) {
        fix.due = expectedDue;
        problems.push(`due ${row.due} → ${expectedDue}`);
      }
      if (row.advance > row.totalBill) {
        unfixable.push({
          id: row.id,
          problem: `advance ${row.advance} > bill ${row.totalBill} (overpay)`,
        });
      }
      if (row.refundAmount !== 0) {
        unfixable.push({
          id: row.id,
          problem: `non-returned row has refundAmount ${row.refundAmount}`,
        });
      }
      if (row.returnedAt) {
        unfixable.push({
          id: row.id,
          problem: "non-returned row has returnedAt",
        });
      }
    }

    if (Object.keys(fix).length > 0) {
      fixes.push({ id: row.id, problems, data: fix });
    }
  }

  console.log(`Rows scanned: ${rows.length}`);
  console.log(`Rows with safe repairs: ${fixes.length}`);
  console.log(`Rows needing manual review: ${unfixable.length}`);
  if (archivedReturnedWithMoney > 0) {
    console.log(
      `Info: ${archivedReturnedWithMoney} archived Returned row(s) still carry expense/damage/refund — excluded from reports by design.`
    );
  }

  for (const row of fixes.slice(0, 100)) {
    console.log(`  #${row.id}  ${row.problems.join("; ")}`);
  }
  if (fixes.length > 100) {
    console.log(`  ... and ${fixes.length - 100} more safe repairs`);
  }

  for (const row of unfixable.slice(0, 100)) {
    console.log(`  #${row.id}  MANUAL: ${row.problem}`);
  }
  if (unfixable.length > 100) {
    console.log(`  ... and ${unfixable.length - 100} more manual issues`);
  }

  if (!CONFIRM) {
    if (fixes.length > 0) {
      console.log("\nDry run only. Re-run with --confirm to apply safe repairs.");
    }
    return;
  }

  if (fixes.length === 0) {
    console.log("Nothing to repair.");
    return;
  }

  const updated = await prisma.$transaction(
    fixes.map((row) =>
      prisma.service.update({
        where: { id: row.id },
        data: row.data,
      })
    )
  );
  console.log(`Updated ${updated.length} row(s).`);
  if (unfixable.length > 0) {
    console.log(
      `${unfixable.length} manual issue(s) remain; review them above.`
    );
  }
}

main()
  .catch((err) => {
    console.error("Money audit failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
