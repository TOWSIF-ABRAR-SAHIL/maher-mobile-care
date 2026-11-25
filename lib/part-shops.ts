/**
 * Locally managed service-part shop names (সার্ভিস খাতা).
 *
 * Created shop names are persisted in browser storage so they are available
 * offline on this PC and automatically appear in part shop selection lists.
 * Stored names are merged with suppliers already known from saved part rows.
 */

export const PART_SHOPS_STORAGE_KEY = "maher:service-part-shops";

export function normalizePartShopName(name: string): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

function readStored(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PART_SHOPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => normalizePartShopName(String(value ?? "")))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeStored(names: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PART_SHOPS_STORAGE_KEY,
      JSON.stringify(names)
    );
  } catch {
    /* storage unavailable — keep the in-memory value for this session */
  }
}

/** Stable, case-insensitive unique merge preserving first-seen display form. */
export function mergePartShopNames(...groups: Array<readonly string[]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group) {
      const name = normalizePartShopName(raw);
      if (!name) continue;
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

export function loadPartShopNames(): string[] {
  return mergePartShopNames(readStored());
}

export function savePartShopName(name: string): string[] {
  const clean = normalizePartShopName(name);
  const next = mergePartShopNames(readStored(), clean ? [clean] : []);
  writeStored(next);
  return next;
}

export function removePartShopName(name: string): string[] {
  const key = normalizePartShopName(name).toLocaleLowerCase();
  const next = readStored().filter(
    (item) => item.toLocaleLowerCase() !== key
  );
  writeStored(next);
  return next;
}

/** The only part-row fields needed to price a shop's bill. */
export interface PartShopBillRow {
  supplier: string | null;
  lineCost: number;
  /** RETURNED lines are no longer payable and never enter a shop balance. */
  partStatus?: string | null;
}

export interface PartShopBill {
  name: string;
  amount: number;
  /** True only for names saved by the shopkeeper, i.e. removable suggestions. */
  stored: boolean;
}

export interface PartShopBilling {
  shops: PartShopBill[];
  total: number;
}

/**
 * Prices every known shop from the service-parts ledger. Saved names keep
 * their display spelling and stay visible at ৳0; suppliers seen only in past
 * rows are listed too but cannot be "deleted" without erasing those rows.
 */
export function summarizePartShopBills(
  storedNames: readonly string[],
  rows: readonly PartShopBillRow[]
): PartShopBilling {
  const display = new Map<string, string>();
  const storedKeys = new Set<string>();

  for (const raw of storedNames) {
    const name = normalizePartShopName(raw);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    if (!display.has(key)) display.set(key, name);
    storedKeys.add(key);
  }

  const amounts = new Map<string, number>();
  for (const row of rows) {
    if (row?.partStatus === "RETURNED") continue;
    const name = normalizePartShopName(String(row?.supplier ?? ""));
    if (!name) continue;
    const value = Number(row?.lineCost);
    const amount = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
    if (amount === 0) continue;
    const key = name.toLocaleLowerCase();
    if (!display.has(key)) display.set(key, name);
    amounts.set(key, (amounts.get(key) ?? 0) + amount);
  }

  const shops = Array.from(display, ([key, name]) => ({
    name,
    amount: amounts.get(key) ?? 0,
    stored: storedKeys.has(key),
  })).sort(
    (a, b) =>
      b.amount - a.amount ||
      a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase())
  );

  return {
    shops,
    total: shops.reduce((sum, shop) => sum + shop.amount, 0),
  };
}
