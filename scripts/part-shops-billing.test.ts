import assert from "node:assert/strict";
import test from "node:test";
import * as partShops from "../lib/part-shops";

type Row = { supplier: string | null; lineCost: number };

const impl = (partShops as Record<string, unknown>).summarizePartShopBills as
  | ((stored: readonly string[], rows: readonly Row[]) => {
      shops: Array<{ name: string; amount: number; stored: boolean }>;
      total: number;
    })
  | undefined;

/** Keeps every RED failure explicit and identical while the helper is missing. */
function summarize(stored: readonly string[], rows: readonly Row[]) {
  assert.equal(
    typeof impl,
    "function",
    "summarizePartShopBills is not implemented yet"
  );
  return impl!(stored, rows);
}

test("a manually added shop appears with a zero bill before any part rows exist", () => {
  const result = summarize(["City Mobile"], []);
  assert.deepEqual(result, {
    shops: [{ name: "City Mobile", amount: 0, stored: true }],
    total: 0,
  });
});

test("part-row costs roll up per shop, case-insensitively, under the saved display name", () => {
  const result = summarize(
    ["City Mobile"],
    [
      { supplier: "city mobile", lineCost: 1200 },
      { supplier: "CITY MOBILE  ", lineCost: 350 },
      { supplier: "Silver Electronics", lineCost: 1750 },
    ]
  );
  assert.deepEqual(result.shops, [
    { name: "Silver Electronics", amount: 1750, stored: false },
    { name: "City Mobile", amount: 1550, stored: true },
  ]);
  assert.equal(result.total, 3300);
});

test("shops seen only in the ledger are listed but are not deletable suggestions", () => {
  const result = summarize([], [{ supplier: "dhaka store", lineCost: 900 }]);
  assert.deepEqual(result.shops, [
    { name: "dhaka store", amount: 900, stored: false },
  ]);
});

test("rows without a supplier or with unusable cost are ignored, and cost is rounded", () => {
  const result = summarize(
    [],
    [
      { supplier: null, lineCost: 5000 },
      { supplier: "   ", lineCost: 5000 },
      { supplier: "Repair Co", lineCost: -40 },
      { supplier: "Repair Co", lineCost: Number.NaN },
      { supplier: "Repair Co", lineCost: 99.6 },
    ]
  );
  assert.deepEqual(result.shops, [
    { name: "Repair Co", amount: 100, stored: false },
  ]);
  assert.equal(result.total, 100);
});

test("shops sort by bill descending then name, with one honest total", () => {
  const result = summarize(
    ["Alpha", "Beta"],
    [
      { supplier: "Beta", lineCost: 500 },
      { supplier: "Alpha", lineCost: 500 },
      { supplier: "Zeta", lineCost: 50 },
    ]
  );
  assert.deepEqual(result.shops.map((shop) => shop.name), [
    "Alpha",
    "Beta",
    "Zeta",
  ]);
  assert.equal(result.total, 1050);
});

test("deleting a saved shop is case-insensitive and preserves the rest", () => {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  try {
    partShops.savePartShopName("City Mobile");
    partShops.savePartShopName("Silver Electronics");
    const next = partShops.removePartShopName("  city   MOBILE ");
    assert.deepEqual(next, ["Silver Electronics"]);
    assert.deepEqual(partShops.loadPartShopNames(), ["Silver Electronics"]);
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
