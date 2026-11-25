/**
 * Secret expense-code engine.
 *
 * Two interchangeable ciphers are supported, both configured in ShopSettings:
 *
 *  - `keypad` (default, preserves every existing ledger code):
 *      1→*  2→ABC  3→DEF  4→GHI  5→JKL
 *      6→MNO 7→PQRS 8→TUV  9→WXYZ  0→+  00→#
 *  - `custom`: an explicit multi-character map. Every digit (including the
 *    `00` pair) owns a LIST of characters. Encoding uses the FIRST character
 *    of that list; decoding accepts ANY character from it. A character may
 *    belong to exactly one digit — collisions are refused by validation.
 *
 * The old 10-character `word` custom cipher is still accepted and mirrored:
 * `normalizeCipherConfig` turns it into groups, and every saved groups config
 * carries a derived `word` so older readers/ledger codes keep working.
 *
 * This module is pure (no database, no React). ShopSettings stores the config
 * as JSON; `normalizeCipherConfig` is the single boundary that turns a stored
 * string or an object into a validated config.
 */

export type CipherMode = "keypad" | "custom";

/** Eleven editable slots: 1–9, a single zero, and the 00 pair. */
export const CIPHER_DIGITS = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00",
] as const;
export type CipherDigit = (typeof CIPHER_DIGITS)[number];
/** One digit → its allowed characters. First character is the encode glyph. */
export type CipherGroups = Record<string, string[]>;

export type CipherConfig = {
  mode: CipherMode;
  /** Legacy 10-character word, always kept in sync with `groups`. */
  word?: string;
  /** Authoritative multi-character map for `custom` mode. */
  groups?: CipherGroups;
};

export const KEYPAD_CIPHER: CipherConfig = { mode: "keypad" };

export const CIPHER_WORD_ERROR =
  "কাস্টম কোডে অবশ্যই ১০টি আলাদা অক্ষর লাগবে (১ম=১, ১০ম=০)";
export const CIPHER_INVALID_NOTICE = "সবগুলো ঘরে সঠিক অক্ষর দিন";
export const CIPHER_GROUPS_ERROR =
  "প্রতিটি ঘরে কমপক্ষে একটি বৈধ অক্ষর দিন (০-৯ বাতিল)";

/** Preset that reproduces every historical keypad code byte-for-byte. */
export const KEYPAD_CIPHER_GROUPS: CipherGroups = {
  "1": ["*"],
  "2": ["A", "B", "C"],
  "3": ["D", "E", "F"],
  "4": ["G", "H", "I"],
  "5": ["J", "K", "L"],
  "6": ["M", "N", "O"],
  "7": ["P", "Q", "R", "S"],
  "8": ["T", "U", "V"],
  "9": ["W", "X", "Y", "Z"],
  "0": ["+"],
  "00": ["#"],
};

const LEGACY_WORD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

/** Digits typed in Bengali are never valid cipher characters. */
const BN_DIGITS: Record<string, string> = {
  "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
  "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9",
};

export function emptyCipherGroups(): CipherGroups {
  const groups: CipherGroups = {};
  for (const digit of CIPHER_DIGITS) groups[digit] = [];
  return groups;
}

export function cloneCipherGroups(groups: CipherGroups = {}): CipherGroups {
  const copy = emptyCipherGroups();
  for (const digit of CIPHER_DIGITS) {
    copy[digit] = Array.from(groups[digit] ?? []);
  }
  return copy;
}

/**
 * Canonicalise an untrusted groups value into eleven clean character lists.
 * Pure parsing only — no collision/required-field rules live here. That keeps
 * runtime money encoding/decoding independent of the strict validator.
 */
export function parseCipherGroups(raw: unknown): CipherGroups {
  const source = raw && typeof raw === "object"
    ? (raw as Record<string, unknown>)
    : {};
  const groups = emptyCipherGroups();
  for (const digit of CIPHER_DIGITS) {
    groups[digit] = parseCipherChars(source[digit]);
  }
  return groups;
}

/**
 * Turn free-form field text ("A, B, C" or "ABC") into a list of single
 * characters. Digits, whitespace and separators are dropped; repeats inside
 * one digit are harmless and deduplicated. Case is normalised on decode.
 */
export function parseCipherChars(raw: unknown): string[] {
  if (Array.isArray(raw)) raw = raw.join(",");
  const text = String(raw ?? "").toUpperCase();
  const chars: string[] = [];
  for (const ch of Array.from(text)) {
    if (ch in BN_DIGITS) continue;
    if (/[\d\s,;|]/.test(ch)) continue;
    if (!chars.includes(ch)) chars.push(ch);
  }
  return chars.slice(0, 32);
}

/** Mirror the legacy word into groups. It has no separate 00 glyph: a zero
 *  pair is written as the zero character twice, which preserves old codes. */
export function groupsFromWord(word: string): CipherGroups {
  const groups = emptyCipherGroups();
  const check = validateCipherWord(word);
  if (!check.ok) return groups;
  check.chars.forEach((ch, index) => {
    groups[index === 9 ? "0" : String(index + 1)] = [ch.toUpperCase()];
  });
  return groups;
}

/** First character of each digit list, in legacy word order. */
export function wordFromGroups(groups: CipherGroups): string {
  return LEGACY_WORD_DIGITS.map((digit) => groups[digit]?.[0] ?? "").join("");
}

export function validateCipherWord(word: unknown): {
  ok: boolean;
  error: string | null;
  chars: string[];
} {
  if (typeof word !== "string") return { ok: false, error: CIPHER_WORD_ERROR, chars: [] };
  const chars = Array.from(word.trim());
  if (chars.length !== 10) return { ok: false, error: CIPHER_WORD_ERROR, chars };
  if (chars.some((ch) => ch in BN_DIGITS || /\d|\s/.test(ch))) {
    return { ok: false, error: CIPHER_WORD_ERROR, chars };
  }
  if (new Set(chars.map((ch) => ch.toUpperCase())).size !== 10) {
    return { ok: false, error: CIPHER_WORD_ERROR, chars };
  }
  return { ok: true, error: null, chars };
}

export type CipherGroupValidation = {
  ok: boolean;
  error: string | null;
  /** The first character found in two different digits, if any. */
  duplicate: string | null;
  /** Every digit taking part in a collision, so both fields turn red. */
  conflictDigits: CipherDigit[];
  chars: CipherGroups;
};

/**
 * Strict multi-character validation. Digits 1–0 must each own at least one
 * character; 00 may be empty (legacy word behaviour). No character may appear
 * under two different digits — not even across the 00 slot.
 */
export function validateCipherGroups(raw: unknown): CipherGroupValidation {
  const chars = parseCipherGroups(raw);

  // A collision is reported first, even while other fields are still empty.
  // The shopkeeper sees the exact offending character the moment it is typed,
  // instead of a generic "fill every field" notice that hides the real bug.
  const owner = new Map<string, CipherDigit>();
  const conflicts = new Set<CipherDigit>();
  let duplicate: string | null = null;
  for (const digit of CIPHER_DIGITS) {
    for (const ch of chars[digit]) {
      const first = owner.get(ch);
      if (first === undefined) {
        owner.set(ch, digit);
      } else if (first !== digit) {
        conflicts.add(first);
        conflicts.add(digit);
        if (!duplicate) duplicate = ch;
      }
    }
  }

  if (duplicate) {
    return {
      ok: false,
      error: `'${duplicate}' অক্ষরটি একাধিক ঘরে ব্যবহার করা হয়েছে। প্রতিটি অক্ষর কেবল একটি ঘরে থাকতে পারবে।`,
      duplicate,
      conflictDigits: CIPHER_DIGITS.filter((digit) => conflicts.has(digit)),
      chars,
    };
  }

  const required = CIPHER_DIGITS.filter((digit) => digit !== "00");
  if (required.some((digit) => chars[digit].length === 0)) {
    return {
      ok: false,
      error: CIPHER_INVALID_NOTICE,
      duplicate: null,
      conflictDigits: [],
      chars,
    };
  }
  return {
    ok: true,
    error: null,
    duplicate: null,
    conflictDigits: [],
    chars,
  };
}

export function normalizeCipherConfig(raw: unknown): CipherConfig {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.mode === "custom") {
      if (obj.groups !== undefined) {
        // Strict collision/required-field validation belongs to the save
        // boundary (`validateCipherInput`) and the Dashboard editor. Runtime
        // normalisation only canonicalises a persisted map, so a validator
        // change can never break expense/part-price encoding on the money path.
        const groups = parseCipherGroups(obj.groups);
        if (CIPHER_DIGITS.every(
          (digit) => digit === "00" || groups[digit].length > 0
        )) {
          return {
            mode: "custom",
            groups,
            word: wordFromGroups(groups),
          };
        }
      }
      if (validateCipherWord(obj.word).ok) {
        return { mode: "custom", word: String(obj.word).trim() };
      }
      return { mode: "keypad" };
    }
    return { mode: "keypad" };
  }
  if (typeof raw === "string" && raw.trim()) {
    const text = raw.trim();
    if (text.startsWith("{")) {
      try {
        return normalizeCipherConfig(JSON.parse(text));
      } catch {
        return { mode: "keypad" };
      }
    }
    // A bare 10-character string is a shorthand legacy custom word.
    if (validateCipherWord(text).ok) return { mode: "custom", word: text };
  }
  return { mode: "keypad" };
}

export type CipherMap = {
  mode: CipherMode;
  /** Digit → first (canonical) character of its list. */
  encode: Record<string, string>;
  /** Character → digit, built from EVERY character of every list. */
  decode: Record<string, string>;
  doubleZero: string;
  allowed: Set<string>;
};

function buildCustomMap(groups: CipherGroups): CipherMap {
  const encode: Record<string, string> = {};
  const decode: Record<string, string> = {};
  for (let d = 0; d <= 9; d += 1) decode[String(d)] = String(d);
  for (const digit of CIPHER_DIGITS) {
    const list = groups[digit] ?? [];
    if (list.length > 0 && !encode[digit]) encode[digit] = list[0];
    for (const ch of list) {
      if (!decode[ch]) decode[ch] = digit;
    }
  }
  const doubleZero = groups["00"]?.length
    ? groups["00"][0]
    : `${encode["0"] ?? "0"}${encode["0"] ?? "0"}`;
  return {
    mode: "custom",
    encode,
    decode,
    doubleZero,
    allowed: new Set([...Object.keys(decode), ...Object.values(encode)]),
  };
}

function buildKeypadMap(): CipherMap {
  return buildCustomMap(KEYPAD_CIPHER_GROUPS);
}

export function buildCipherMap(config: CipherConfig = KEYPAD_CIPHER): CipherMap {
  const normalized = normalizeCipherConfig(config);
  if (normalized.mode === "custom") {
    if (normalized.groups) return buildCustomMap(normalized.groups);
    if (normalized.word) return buildCustomMap(groupsFromWord(normalized.word));
  }
  return buildKeypadMap();
}

/** Encode a non-negative integer amount with the active cipher. */
export function encodeWithCipher(amount: number, config: CipherConfig = KEYPAD_CIPHER): string {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("amount must be a non-negative safe integer");
  }
  const map = buildCipherMap(config);
  const digits = String(amount);
  let code = "";
  for (let i = digits.length - 1; i >= 0; ) {
    if (i >= 1 && digits[i] === "0" && digits[i - 1] === "0") {
      code = map.doubleZero + code;
      i -= 2;
    } else {
      code = (map.encode[digits[i]] ?? digits[i]) + code;
      i -= 1;
    }
  }
  return code;
}

/** Decode a typed code back to digits. Returns null when a character is unknown. */
export function decodeWithCipher(raw: unknown, config: CipherConfig = KEYPAD_CIPHER): number | null {
  const input = String(raw ?? "")
    .trim()
    .replace(/[,\s৳]/g, "")
    .replace(/[০-৯]/g, (ch) => BN_DIGITS[ch] ?? ch);
  if (!input) return null;
  const map = buildCipherMap(config);
  let digits = "";
  for (const ch of input) {
    const upper = ch.toUpperCase();
    if (!map.allowed.has(upper)) return null;
    digits += map.decode[upper] ?? upper;
  }
  if (!/^\d+$/.test(digits)) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : null;
}

/** Dynamic counterpart of the legacy `decodeShopExpense` amount lookup. */
export function decodeSecretCode(raw: unknown, config: CipherConfig = KEYPAD_CIPHER): number | null {
  return decodeWithCipher(raw, config);
}

export function describeCipher(config: CipherConfig = KEYPAD_CIPHER): string {
  const normalized = normalizeCipherConfig(config);
  if (normalized.mode === "custom" && normalized.groups) {
    return CIPHER_DIGITS.map(
      (digit) => `${digit}=${(normalized.groups?.[digit] ?? []).join("")}`
    ).join(" ");
  }
  if (normalized.mode === "custom" && normalized.word) {
    const chars = Array.from(normalized.word);
    return `1=${chars[0]} 2=${chars[1]} 3=${chars[2]} 4=${chars[3]} 5=${chars[4]} 6=${chars[5]} 7=${chars[6]} 8=${chars[7]} 9=${chars[8]} 0=${chars[9]}`;
  }
  return "1=* 2=ABC 3=DEF 4=GHI 5=JKL 6=MNO 7=PQRS 8=TUV 9=WXYZ 0/00=#";
}
