/**
 * A Returned job must say what happened to its repair cost when any exists.
 * Parts-only jobs store the money in `partsCost` and keep `expenseAmount === 0`,
 * so checking the lump code alone silently skips the writeoff/keep decision.
 */
export function hasRepairCost(row: {
  expenseAmount: number;
  partsCost?: number | null;
}): boolean {
  return (
    Math.max(0, Number(row.expenseAmount) || 0) > 0 ||
    Math.max(0, Number(row.partsCost) || 0) > 0
  );
}
