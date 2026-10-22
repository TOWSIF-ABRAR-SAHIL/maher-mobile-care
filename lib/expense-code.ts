import { parseBnNumber } from "./utils";

/**
 * Shop-expense input accepts either a normal amount ("1500") or a keypad
 * code ("*J#" => 1500). The code is an obfuscation convenience, not
 * encryption: it is decoded on the server as well as previewed in the form.
 *
 * Mapping (phone-keypad style):
 *   * => 1        + => 0        # => 00
 *   ABC => 2      DEF => 3      GHI => 4
 *   JKL => 5      MNO => 6      PQRS => 7
 *   TUV => 8      WXYZ => 9
 *   digits 0-9 stay unchanged; lowercase is accepted.
 */

export const MAX_SHOP_EXPENSE = 999_999_999;
const MAX_CODE_LENGTH = 24;

export const SHOP_EXPENSE_ERROR =
  "দোকান খরচে সঠিক সংখ্যা বা গোপন কোড দিন (A–Z, 0–9, *, +, #)";
export const SHOP_EXPENSE_LENGTH_ERROR =
  "গোপন কোড অনেক বড়; সর্বোচ্চ ২৪ অক্ষর দিন";
export const SHOP_EXPENSE_AMOUNT_ERROR = "দোকান খরচের পরিমাণ অনেক বড়";

export type ShopExpenseKind = "empty" | "number" | "code" | "invalid";

export interface DecodedShopExpense {
  kind: ShopExpenseKind;
  /** Trimmed input exactly as typed. */
  raw: string;
  /** Numeric Taka value, or null when the input is invalid. */
  amount: number | null;
  /** Bengali validation message for an invalid input. */
  error: string | null;
}

/**
 * The value the database should keep: a canonical keypad code for a plain
 * number, the typed code unchanged, or NULL for an empty input.
 */
export interface NormalizedShopExpense extends DecodedShopExpense {
  stored: string | null;
  /** True only when a plain number was converted into a code. */
  converted: boolean;
}

const BN_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

const CODE_DIGITS: Record<string, string> = {
  "*": "1",
  "+": "0",
  "#": "00",

  A: "2", B: "2", C: "2",
  D: "3", E: "3", F: "3",
  G: "4", H: "4", I: "4",
  J: "5", K: "5", L: "5",
  M: "6", N: "6", O: "6",
  P: "7", Q: "7", R: "7", S: "7",
  T: "8", U: "8", V: "8",
  W: "9", X: "9", Y: "9", Z: "9",
};

/**
 * Canonical encoding uses the first letter of each phone-keypad group:
 * 0→+, 1→*, 2→A, 3→D, 4→G, 5→J, 6→M, 7→P, 8→T, 9→W.
 * Consecutive `00` digits are folded into `#` from right to left.
 */
const ENCODE_DIGITS: Record<string, string> = {
  "0": "+",
  "1": "*",
  "2": "A",
  "3": "D",
  "4": "G",
  "5": "J",
  "6": "M",
  "7": "P",
  "8": "T",
  "9": "W",
};

/**
 * Convert a validated numeric expense into its canonical keypad code.
 * Examples: 1500 → *J#, 800 → T#, 450 → GJ+, 0 → +.
 */
export function encodeShopExpenseAmount(amount: number): string {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > MAX_SHOP_EXPENSE
  ) {
    throw new Error(SHOP_EXPENSE_AMOUNT_ERROR);
  }

  // Use the canonical decimal form, not the typed text: "001500" and "1500"
  // must produce exactly the same code.
  const digits = String(amount);
  let code = "";
  for (let i = digits.length - 1; i >= 0; ) {
    if (i >= 1 && digits[i] === "0" && digits[i - 1] === "0") {
      code = "#" + code;
      i -= 2;
    } else {
      code = ENCODE_DIGITS[digits[i]] + code;
      i -= 1;
    }
  }
  return code;
}

function invalid(raw: string, error: string): DecodedShopExpense {
  return { kind: "invalid", raw, amount: null, error };
}

function normalizeDigits(value: string): string {
  return value
    .split("")
    .map((ch) => BN_DIGITS[ch] ?? ch)
    .join("");
}

/**
 * Classify and decode one shop-expense input.
 *
 * Pure numbers are parsed exactly like bills/advance (Bengali digits, commas,
 * spaces and ৳ are accepted). Everything else must be made only of letters,
 * digits and the three keypad symbols; otherwise the form refuses to save.
 */
export function decodeShopExpense(raw: unknown): DecodedShopExpense {
  const input = String(raw ?? "").trim();
  if (!input) {
    return { kind: "empty", raw: "", amount: 0, error: null };
  }

  const numeric = parseBnNumber(input);
  if (numeric !== null) {
    if (!Number.isSafeInteger(numeric) || numeric > MAX_SHOP_EXPENSE) {
      return invalid(input, SHOP_EXPENSE_AMOUNT_ERROR);
    }
    return { kind: "number", raw: input, amount: numeric, error: null };
  }

  // Codes may be typed with spaces/commas (e.g. "G J +"); those are only
  // formatting and must not become 0s or invalid characters.
  const compact = normalizeDigits(input).replace(/[,\s৳]/g, "");
  if (!compact) {
    return { kind: "empty", raw: "", amount: 0, error: null };
  }
  if (compact.length > MAX_CODE_LENGTH) {
    return invalid(input, SHOP_EXPENSE_LENGTH_ERROR);
  }
  if (!/^[0-9*+#A-Za-z]+$/.test(compact)) {
    return invalid(input, SHOP_EXPENSE_ERROR);
  }

  let digits = "";
  for (const ch of compact) {
    const upper = ch.toUpperCase();
    digits += CODE_DIGITS[upper] ?? ch;
  }

  const amount = parseInt(digits, 10);
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(amount) ||
    amount > MAX_SHOP_EXPENSE
  ) {
    return invalid(input, SHOP_EXPENSE_AMOUNT_ERROR);
  }
  return { kind: "code", raw: input, amount, error: null };
}

/**
 * Normalize one input for storage.
 *
 * - Plain number → canonical code, amount preserved (`1500` → `*J#`).
 * - Typed code → same trimmed code (codes remain codes).
 * - Empty → NULL / 0.
 * - Invalid → error, never written.
 */
export function normalizeShopExpense(raw: unknown): NormalizedShopExpense {
  const decoded = decodeShopExpense(raw);
  if (decoded.kind === "empty") {
    return { ...decoded, stored: null, converted: false };
  }
  if (decoded.kind === "invalid" || decoded.amount === null) {
    return { ...decoded, stored: null, converted: false };
  }
  if (decoded.kind === "number") {
    return {
      ...decoded,
      stored: encodeShopExpenseAmount(decoded.amount),
      converted: true,
    };
  }
  return { ...decoded, stored: decoded.raw, converted: false };
}

/** True only for a valid code input, never for a plain number. */
export function isShopExpenseCode(raw: unknown): boolean {
  return decodeShopExpense(raw).kind === "code";
}
