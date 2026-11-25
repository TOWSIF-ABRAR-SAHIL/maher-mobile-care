import { prisma } from "@/lib/prisma";
import { SHOP } from "@/lib/shop";
import {
  CIPHER_INVALID_NOTICE,
  CIPHER_WORD_ERROR,
  normalizeCipherConfig,
  validateCipherGroups,
  validateCipherWord,
  wordFromGroups,
  type CipherConfig,
} from "@/lib/secret-code";

/**
 * White-label shop profile.
 *
 * One optional singleton row (id = 1) lives in SQLite. A missing row — a fresh
 * install, an old snapshot, or a build-time render with no database — yields
 * an empty tenant profile, which is what triggers onboarding. Nothing in the
 * ledger depends on settings being present. Excluded from backup/restore.
 */

export const SHOP_SETTINGS_ID = 1;

/**
 * Additive self-heal for older shop PCs that never ran the settings migration.
 * Mirrors prisma/migrations/20261122120000_add_shop_settings exactly — it only
 * creates the empty singleton table, so no service/inventory row can change.
 */
const SHOP_SETTINGS_DDL = `CREATE TABLE IF NOT EXISTS "ShopSettings" (
  "id" INTEGER NOT NULL PRIMARY KEY,
  "shopName" TEXT NOT NULL,
  "slogan" TEXT,
  "address" TEXT,
  "phone" TEXT,
  "whatsapp" TEXT,
  "terms" TEXT,
  "secretCipher" TEXT,
  "logoPath" TEXT,
  "updatedAt" DATETIME NOT NULL
)`;

export const DEFAULT_SETTINGS: {
  shopName: string;
  slogan: string;
  address: string;
  phone: string;
  whatsapp: string;
  terms: string;
  logoPath: string | null;
} = {
  shopName: SHOP.name,
  slogan: SHOP.tagline,
  address: SHOP.address,
  phone: SHOP.phone,
  whatsapp: SHOP.phone,
  terms: "",
  logoPath: null,
};

/** True only when the tenant has actually configured a shop identity. */
export function isShopProfileConfigured(settings: {
  shopName: string;
  updatedAt: string | null;
}): boolean {
  return !!settings.updatedAt && !!settings.shopName.trim();
}

export type ShopSettingsDTO = typeof DEFAULT_SETTINGS & {
  secretCipher: CipherConfig;
  updatedAt: string | null;
};

export type ShopSettingsInput = Partial<typeof DEFAULT_SETTINGS> & {
  secretCipher?: CipherConfig | string | null;
};

const LIMITS: Record<keyof typeof DEFAULT_SETTINGS, number> = {
  shopName: 80,
  slogan: 120,
  address: 240,
  phone: 40,
  whatsapp: 40,
  terms: 2000,
  logoPath: 240,
};

export class ShopSettingsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ShopSettingsError";
    this.status = status;
  }
}

function clean(value: unknown, key: keyof typeof DEFAULT_SETTINGS): string {
  if (value == null) return "";
  if (typeof value !== "string") {
    throw new ShopSettingsError(`${key} must be a string`);
  }
  const text = value.trim();
  if (text.length > LIMITS[key]) {
    throw new ShopSettingsError(`${key} is too long (max ${LIMITS[key]})`);
  }
  return text;
}

export function validateShopSettings(
  input: ShopSettingsInput,
  base: typeof DEFAULT_SETTINGS = DEFAULT_SETTINGS
): typeof DEFAULT_SETTINGS {
  if (!input || typeof input !== "object") {
    throw new ShopSettingsError("settings payload is required");
  }
  // Pick only the persisted profile keys — never carry DTO extras such as
  // updatedAt/secretCipher into the Prisma write.
  const next = {} as typeof DEFAULT_SETTINGS;
  for (const key of Object.keys(LIMITS) as (keyof typeof DEFAULT_SETTINGS)[]) {
    (next as Record<string, string | null>)[key] =
      key in input ? clean(input[key], key) : base[key];
  }
  if (!next.shopName) {
    throw new ShopSettingsError("shopName is required");
  }
  return next;
}

export function toShopSettingsDTO(row: {
  shopName: string;
  slogan: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  terms: string | null;
  secretCipher: string | null;
  logoPath: string | null;
  updatedAt: Date;
}): ShopSettingsDTO {
  return {
    shopName: row.shopName || DEFAULT_SETTINGS.shopName,
    slogan: row.slogan ?? DEFAULT_SETTINGS.slogan,
    address: row.address ?? DEFAULT_SETTINGS.address,
    phone: row.phone ?? DEFAULT_SETTINGS.phone,
    whatsapp: row.whatsapp ?? DEFAULT_SETTINGS.whatsapp,
    terms: row.terms ?? DEFAULT_SETTINGS.terms,
    logoPath: row.logoPath ?? null,
    secretCipher: normalizeCipherConfig(row.secretCipher),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function fallbackSettings(): ShopSettingsDTO {
  return { ...DEFAULT_SETTINGS, secretCipher: { mode: "keypad" }, updatedAt: null };
}

/** Never throws: a missing table or unreadable DB still yields an empty profile. */
export async function getShopSettings(): Promise<ShopSettingsDTO> {
  try {
    const row = await prisma.shopSettings.findUnique({
      where: { id: SHOP_SETTINGS_ID },
    });
    return row ? toShopSettingsDTO(row) : fallbackSettings();
  } catch {
    return fallbackSettings();
  }
}

export async function getCipherConfig(): Promise<CipherConfig> {
  return (await getShopSettings()).secretCipher;
}

/**
 * Explicit settings edits are strict: a bad custom word must be refused with a
 * clear message, never silently downgraded to the keypad preset. Reading a
 * stored/legacy value still uses the lenient `normalizeCipherConfig`, so an old
 * or hand-edited row can never crash the header, receipt or API.
 */
export function validateCipherInput(raw: unknown): CipherConfig {
  if (raw === null || raw === undefined) return { mode: "keypad" };
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.mode === "custom") {
      // Multi-character groups are authoritative. A duplicate character
      // across two digits is a hard 400 — never silently dropped.
      if (obj.groups !== undefined) {
        const result = validateCipherGroups(obj.groups);
        if (!result.ok) {
          throw new ShopSettingsError(result.error ?? CIPHER_INVALID_NOTICE, 400);
        }
        return {
          mode: "custom",
          groups: result.chars,
          word: wordFromGroups(result.chars),
        };
      }
      const result = validateCipherWord(obj.word);
      if (!result.ok) throw new ShopSettingsError(result.error ?? CIPHER_WORD_ERROR, 400);
      return { mode: "custom", word: String(obj.word).trim() };
    }
    if (obj.mode === "keypad" || obj.mode == null) return { mode: "keypad" };
    throw new ShopSettingsError(CIPHER_WORD_ERROR, 400);
  }
  if (typeof raw === "string" && raw.trim()) {
    const text = raw.trim();
    if (text.startsWith("{")) {
      try {
        return validateCipherInput(JSON.parse(text));
      } catch (err) {
        if (err instanceof ShopSettingsError) throw err;
        throw new ShopSettingsError(CIPHER_WORD_ERROR, 400);
      }
    }
    const result = validateCipherWord(text);
    if (result.ok) return { mode: "custom", word: text };
    throw new ShopSettingsError(CIPHER_WORD_ERROR, 400);
  }
  throw new ShopSettingsError(CIPHER_WORD_ERROR, 400);
}

/** Prisma P2021 for this model means the old DB predates the settings table. */
function isMissingShopSettingsTable(err: unknown): boolean {
  const error = err as { code?: string; meta?: { modelName?: string } };
  return error?.code === "P2021" && error.meta?.modelName === "ShopSettings";
}

async function upsertSettingsRow(profile: typeof DEFAULT_SETTINGS, cipher: CipherConfig) {
  const values = { ...profile, secretCipher: JSON.stringify(cipher) };
  const write = () =>
    prisma.shopSettings.upsert({
      where: { id: SHOP_SETTINGS_ID },
      create: { id: SHOP_SETTINGS_ID, ...values },
      update: values,
    });

  try {
    return await write();
  } catch (err) {
    if (!isMissingShopSettingsTable(err)) throw err;
    await prisma.$executeRawUnsafe(SHOP_SETTINGS_DDL);
    return write();
  }
}

export async function saveShopSettings(
  input: ShopSettingsInput
): Promise<ShopSettingsDTO> {
  const current = await getShopSettings();
  const profile = validateShopSettings(input, current);
  let cipher: CipherConfig = current.secretCipher;
  if (input.secretCipher !== undefined) {
    cipher = validateCipherInput(input.secretCipher);
  }
  const row = await upsertSettingsRow(profile, cipher);
  return toShopSettingsDTO(row);
}
