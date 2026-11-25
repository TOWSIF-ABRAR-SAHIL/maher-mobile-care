import { CLOCK_TAMPER_MESSAGE, evaluateClock } from "./clock-guard";
import { verifyLicenseToken } from "./crypto";
import { getMachineId } from "./machine-id";
import {
  DEFAULT_TRIAL_DAYS,
  daysUntil,
  getLicenseState,
  saveLicenseState,
} from "./license-store";
import {
  LIFETIME_DAYS_REMAINING,
  type LicenseStatus,
  type LicenseType,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_EXPIRED_MESSAGE =
  "ট্রায়ালের মেয়াদ শেষ হয়ে গেছে। লাইসেন্স কি দিয়ে সক্রিয় করুন।";
const LICENSE_EXPIRED_MESSAGE =
  "লাইসেন্স কির মেয়াদ শেষ হয়ে গেছে। নতুন কি দিয়ে রিনিউ করুন।";
const LICENSE_INVALID_MESSAGE = "সংরক্ষিত লাইসেন্স কি বৈধ নয়। নতুন কি দিন।";

const TIER_DAYS: Partial<Record<LicenseType, number>> = {
  TRIAL: DEFAULT_TRIAL_DAYS,
  "30_DAYS": DEFAULT_TRIAL_DAYS,
  "1_YEAR": 365,
  "2_YEARS": 730,
  "3_YEARS": 1095,
  ANNUAL: 365, // legacy one-year alias
};

/** Exact term + remaining share; never rendered for a LIFETIME licence. */
function termFields(
  type: LicenseType | null,
  issuedAt: string | null,
  expiresAt: string | null,
  now: number
): Pick<LicenseStatus, "totalDays" | "progressPercent"> {
  if (!type || type === "LIFETIME" || !expiresAt) {
    return { totalDays: null, progressPercent: null };
  }
  const totalDays = TIER_DAYS[type] ?? null;
  if (!totalDays) return { totalDays: null, progressPercent: null };
  const start = Date.parse(issuedAt ?? "");
  const end = Date.parse(expiresAt);
  const span = Number.isFinite(start) && end > start ? end - start : totalDays * DAY_MS;
  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round(((end - now) / span) * 100))
  );
  return { totalDays, progressPercent };
}

function finalize(
  value: Omit<LicenseStatus, "totalDays" | "progressPercent" | "isExpired" | "unlimited">,
  now: number
): LicenseStatus {
  // A LIFETIME key (or a null expiry) is never expired, whatever the clock says.
  const unlimited = value.type === "LIFETIME" || value.expiresAt === null;
  const isExpired =
    !unlimited &&
    (value.status === "EXPIRED" ||
      (!!value.expiresAt && Date.parse(value.expiresAt) <= now));
  return {
    ...value,
    ...termFields(value.type, value.issuedAt, value.expiresAt, now),
    isExpired,
    unlimited,
  };
}

/** Single source of truth for both the gate and the dashboard card. */
export function getLicenseStatus(now: number = Date.now()): LicenseStatus {
  const machineId = getMachineId();

  // Explicit headless bypass for the 41 legacy suites; the licensing suite
  // deliberately does NOT set this so it exercises the real engine.
  if (process.env.MAHER_LICENSE_BYPASS === "1") {
    return finalize(
      {
        status: "TRIAL",
        active: true,
        machineId,
        type: "TRIAL",
        shopName: "",
        issuedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + DEFAULT_TRIAL_DAYS * DAY_MS).toISOString(),
        daysRemaining: null,
        trialDaysRemaining: DEFAULT_TRIAL_DAYS,
        message: null,
        clockTampered: false,
      },
      now
    );
  }

  // Share one timestamp with a freshly created state; otherwise trialEndsAt
  // lands a millisecond after `now` and daysUntil rounds 30 up to 31.
  const state = getLicenseState(now);
  const clock = evaluateClock(state.lastSeenTimestamp, now);
  if (clock.tampered) {
    return finalize(
      {
        status: "CLOCK_TAMPERED",
        active: false,
        machineId,
        type: state.license?.payload.type ?? null,
        shopName: state.license?.payload.shopName ?? null,
        issuedAt: state.license?.payload.issuedAt ?? null,
        expiresAt: state.license?.payload.expiresAt ?? null,
        daysRemaining: daysUntil(state.license?.payload.expiresAt, now),
        trialDaysRemaining: null,
        message: CLOCK_TAMPER_MESSAGE,
        clockTampered: true,
      },
      now
    );
  }
  if (clock.lastSeenTimestamp !== state.lastSeenTimestamp) {
    state.lastSeenTimestamp = clock.lastSeenTimestamp;
    saveLicenseState(state);
  }

  if (state.license) {
    const verified = verifyLicenseToken(state.license.token, { machineId, now });
    if (verified.ok && verified.payload) {
      const payload = verified.payload;
      const unlimited = payload.type === "LIFETIME" || payload.expiresAt === null;
      return finalize(
        {
          status: "ACTIVE",
          active: true,
          machineId,
          type: payload.type,
          shopName: payload.shopName,
          issuedAt: payload.issuedAt,
          expiresAt: payload.expiresAt,
          daysRemaining: unlimited
            ? LIFETIME_DAYS_REMAINING
            : daysUntil(payload.expiresAt, now),
          trialDaysRemaining: null,
          message: null,
          clockTampered: false,
        },
        now
      );
    }
    const expired = verified.reason === "EXPIRED";
    return finalize(
      {
        status: expired ? "EXPIRED" : "INVALID",
        active: false,
        machineId,
        type: state.license.payload.type,
        shopName: state.license.payload.shopName,
        issuedAt: state.license.payload.issuedAt,
        expiresAt: state.license.payload.expiresAt,
        daysRemaining: daysUntil(state.license.payload.expiresAt, now),
        trialDaysRemaining: null,
        message: expired ? LICENSE_EXPIRED_MESSAGE : LICENSE_INVALID_MESSAGE,
        clockTampered: false,
      },
      now
    );
  }

  const trialActive =
    !state.trialClaimed &&
    !!state.trialEndsAt &&
    now < Date.parse(state.trialEndsAt as string);
  if (trialActive) {
    return finalize(
      {
        status: "TRIAL",
        active: true,
        machineId,
        type: "TRIAL",
        shopName: "",
        issuedAt: state.installedAt,
        expiresAt: state.trialEndsAt,
        daysRemaining: null,
        trialDaysRemaining: daysUntil(state.trialEndsAt, now),
        message: null,
        clockTampered: false,
      },
      now
    );
  }

  return finalize(
    {
      status: "EXPIRED",
      active: false,
      machineId,
      type: null,
      shopName: "",
      issuedAt: state.installedAt,
      expiresAt: state.trialEndsAt,
      daysRemaining: null,
      trialDaysRemaining: 0,
      message: TRIAL_EXPIRED_MESSAGE,
      clockTampered: false,
    },
    now
  );
}
