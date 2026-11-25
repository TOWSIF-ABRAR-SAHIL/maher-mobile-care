import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { resolveDatabaseFile } from "@/lib/db-path";
import type { LicensePayload } from "./types";

/**
 * Persistent, file-backed licensing state. Sits beside the shop database (or
 * under MAHER_USER_DATA_DIR), never inside it — a restore of shop.db therefore
 * cannot reset a trial or erase an activated licence.
 */
export interface StoredLicense {
  token: string;
  payload: LicensePayload;
  activatedAt: string;
}

export interface LicenseStoreState {
  version: 1;
  installedAt: string;
  trialEndsAt: string | null;
  trialClaimed: boolean;
  /** Monotonic high-water mark used by the clock-tamper guard. */
  lastSeenTimestamp: number;
  license: StoredLicense | null;
}

export interface LicenseTestPatch {
  reset?: boolean;
  clearLicense?: boolean;
  trialEndsAt?: string | number | null;
  lastSeenTimestamp?: number;
}

const STATE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fresh installs get a full calendar month before the gate engages. */
export const DEFAULT_TRIAL_DAYS = 30;

export function licenseStateFile(): string {
  const explicit = process.env.MAHER_LICENSE_FILE?.trim();
  if (explicit) return path.resolve(explicit);
  const userData = process.env.MAHER_USER_DATA_DIR?.trim();
  if (userData) {
    return path.join(path.resolve(userData), "data", "maher-license-state.json");
  }
  return path.join(path.dirname(resolveDatabaseFile()), "maher-license-state.json");
}

function configuredTrialDays(): number {
  const raw = process.env.MAHER_TRIAL_DAYS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_TRIAL_DAYS;
  const days = Number(raw);
  if (!Number.isFinite(days)) return DEFAULT_TRIAL_DAYS;
  return Math.max(0, Math.min(365, Math.floor(days)));
}

function hasTrialDaysOverride(): boolean {
  const raw = process.env.MAHER_TRIAL_DAYS?.trim();
  return raw !== undefined && raw !== "";
}

/**
 * One-time upgrade for installs created before the 30-day default shipped.
 * Only an active, unclaimed trial with a shorter-than-default term is touched;
 * expired trials, claimed licences and explicit MAHER_TRIAL_DAYS overrides are
 * left exactly as stored. Persisting the result makes the migration idempotent.
 */
function migrateLegacyTrial(state: LicenseStoreState, now: number): LicenseStoreState {
  if (hasTrialDaysOverride() || state.license || state.trialClaimed) return state;
  const ends = state.trialEndsAt ? Date.parse(state.trialEndsAt) : NaN;
  if (!Number.isFinite(ends) || ends <= now) return state;
  const installed = Date.parse(state.installedAt);
  if (ends - installed >= DEFAULT_TRIAL_DAYS * DAY_MS - 60_000) return state;
  return {
    ...state,
    trialEndsAt: new Date(installed + DEFAULT_TRIAL_DAYS * DAY_MS).toISOString(),
  };
}

function freshState(now = Date.now()): LicenseStoreState {
  const days = configuredTrialDays();
  return {
    version: STATE_VERSION,
    installedAt: new Date(now).toISOString(),
    trialEndsAt: days > 0 ? new Date(now + days * DAY_MS).toISOString() : null,
    trialClaimed: false,
    lastSeenTimestamp: now,
    license: null,
  };
}

function ensureDir(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}

export function saveLicenseState(state: LicenseStoreState): LicenseStoreState {
  const file = licenseStateFile();
  ensureDir(file);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temp, file);
  return state;
}

function validPayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.machineId === "string" &&
    typeof p.shopName === "string" &&
    typeof p.type === "string" &&
    typeof p.issuedAt === "string" &&
    (p.expiresAt === null || typeof p.expiresAt === "string")
  );
}

function normalizeState(value: unknown): LicenseStoreState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== STATE_VERSION) return null;
  if (typeof raw.installedAt !== "string" || !Number.isFinite(Date.parse(raw.installedAt))) {
    return null;
  }
  if (typeof raw.lastSeenTimestamp !== "number" || !Number.isFinite(raw.lastSeenTimestamp)) {
    return null;
  }
  const license = raw.license as Record<string, unknown> | null;
  const storedLicense: StoredLicense | null =
    license &&
    typeof license.token === "string" &&
    typeof license.activatedAt === "string" &&
    validPayload(license.payload)
      ? (license as unknown as StoredLicense)
      : null;
  return {
    version: STATE_VERSION,
    installedAt: raw.installedAt,
    trialEndsAt:
      typeof raw.trialEndsAt === "string" && Number.isFinite(Date.parse(raw.trialEndsAt))
        ? raw.trialEndsAt
        : null,
    trialClaimed: raw.trialClaimed === true,
    lastSeenTimestamp: raw.lastSeenTimestamp,
    license: storedLicense,
  };
}

export function getLicenseState(now = Date.now()): LicenseStoreState {
  const file = licenseStateFile();
  if (!existsSync(file)) return saveLicenseState(freshState(now));
  try {
    const parsed = normalizeState(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed) return saveLicenseState(freshState(now));
    const migrated = migrateLegacyTrial(parsed, now);
    return migrated === parsed ? parsed : saveLicenseState(migrated);
  } catch {
    // A half-written file must never brick the app: start a fresh trial.
    return saveLicenseState(freshState(now));
  }
}

export function activateLicense(token: string, payload: LicensePayload, now = Date.now()): LicenseStoreState {
  const state = getLicenseState();
  state.license = { token, payload, activatedAt: new Date(now).toISOString() };
  state.trialClaimed = true;
  return saveLicenseState(state);
}

export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - now) / DAY_MS));
}

/** Test-only state manipulation, exposed only by the env-guarded test API. */
export function patchLicenseStateForTest(patch: LicenseTestPatch): LicenseStoreState {
  const file = licenseStateFile();
  if (patch.reset === true && existsSync(file)) unlinkSync(file);
  const state = getLicenseState();

  if (patch.clearLicense === true) {
    state.license = null;
    state.trialClaimed = false;
  }
  if (patch.trialEndsAt !== undefined) {
    if (patch.trialEndsAt === null) state.trialEndsAt = null;
    else if (typeof patch.trialEndsAt === "number") {
      state.trialEndsAt = new Date(patch.trialEndsAt).toISOString();
    } else if (Number.isFinite(Date.parse(patch.trialEndsAt))) {
      state.trialEndsAt = patch.trialEndsAt;
    }
  }
  if (
    typeof patch.lastSeenTimestamp === "number" &&
    Number.isFinite(patch.lastSeenTimestamp)
  ) {
    state.lastSeenTimestamp = patch.lastSeenTimestamp;
  }
  return saveLicenseState(state);
}
