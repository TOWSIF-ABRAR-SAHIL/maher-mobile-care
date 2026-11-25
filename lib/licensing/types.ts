/** Shared, dependency-free shapes for the offline licensing engine. */

export type LicenseType =
  | "TRIAL"
  /** Admin alias for a 30-day trial extension. Verified exactly like TRIAL. */
  | "30_DAYS"
  | "1_YEAR"
  | "2_YEARS"
  | "3_YEARS"
  | "LIFETIME"
  /** Pre-1.3 admin key alias. Still verified so an issued key never breaks. */
  | "ANNUAL";

/** Display copy shared by the subscription card, the gate and the preview API. */
export const LICENSE_TYPE_LABEL: Record<LicenseType, string> = {
  TRIAL: "ফ্রি ট্রায়াল",
  "30_DAYS": "ফ্রি ট্রায়াল (৩০ দিন)",
  "1_YEAR": "১ বছর মেয়াদী",
  "2_YEARS": "২ বছর মেয়াদী",
  "3_YEARS": "৩ বছর মেয়াদী",
  LIFETIME: "লাইফটাইম আনলিমিটেড",
  ANNUAL: "১ বছর মেয়াদী",
};

export type LicenseStatusKind =
  | "TRIAL"
  | "ACTIVE"
  | "EXPIRED"
  | "INVALID"
  | "LOCKED"
  | "CLOCK_TAMPERED";

export interface LicensePayload {
  machineId: string;
  shopName: string;
  type: LicenseType;
  issuedAt: string;
  expiresAt: string | null;
}

/**
 * In-process sentinel for an unlimited licence. JSON serialises Infinity as
 * null, so the wire format also carries `unlimited: true` + `isExpired: false`
 * for clients that cannot represent Infinity.
 */
export const LIFETIME_DAYS_REMAINING = Number.POSITIVE_INFINITY;

export interface LicenseStatus {
  status: LicenseStatusKind;
  active: boolean;
  /** Explicit expiry verdict — always false for LIFETIME/null expiry. */
  isExpired: boolean;
  /** True when the licence has no expiry (LIFETIME). */
  unlimited: boolean;
  machineId: string;
  type: LicenseType | null;
  shopName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  /** Whole days left on the paid licence; Infinity (null on the wire) for LIFETIME. */
  daysRemaining: number | null;
  /** Whole days left in the fresh-install trial; null once a key is used. */
  trialDaysRemaining: number | null;
  /** Full term length in days (30 / 365 / 730 / 1095); null for LIFETIME. */
  totalDays: number | null;
  /** 0–100 share of the term still remaining; null for LIFETIME. */
  progressPercent: number | null;
  /** Lock/banner copy. Null while active (the UI builds the trial banner). */
  message: string | null;
  clockTampered: boolean;
}
