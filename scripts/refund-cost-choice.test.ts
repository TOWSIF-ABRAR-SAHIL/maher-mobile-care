/* Return-decision rule — runs with `npx tsx --test`.
 * A job needs the writeoff/keep choice when ANY repair cost exists:
 * the decoded lump OR itemized parts (parts-only jobs have expenseAmount 0).
 */
import assert from "node:assert/strict";
import test from "node:test";

async function helper() {
  const mod = await import("../lib/refund-cost-choice").catch(() => null);
  assert.ok(mod, "lib/refund-cost-choice with hasRepairCost should exist");
  return mod as { hasRepairCost: (row: {
    expenseAmount: number;
    partsCost?: number | null;
  }) => boolean };
}

test("parts-only repair cost needs the return decision", async () => {
  const { hasRepairCost } = await helper();
  assert.equal(hasRepairCost({ expenseAmount: 0, partsCost: 1900 }), true);
});

test("lump-only repair cost still needs the return decision", async () => {
  const { hasRepairCost } = await helper();
  assert.equal(hasRepairCost({ expenseAmount: 1500, partsCost: null }), true);
});

test("a job with no repair cost needs no return decision", async () => {
  const { hasRepairCost } = await helper();
  assert.equal(hasRepairCost({ expenseAmount: 0, partsCost: null }), false);
  assert.equal(hasRepairCost({ expenseAmount: 0, partsCost: 0 }), false);
});
