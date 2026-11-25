/** Monotonic clock high-water mark — pure, no file or platform dependencies. */

export const CLOCK_TAMPER_MESSAGE =
  "কম্পিউটারের তারিখ ও সময় পরিবর্তন শনাক্ত হয়েছে। অনুগ্রহ করে সঠিক সময় ঠিক করুন।";

/** A small backward slip (NTP/DST correction) is allowed; a real rollback isn't. */
export const CLOCK_TOLERANCE_MS = 60 * 60 * 1000;

export interface ClockGuardResult {
  tampered: boolean;
  /** Time to persist: never moves backwards except while tampering is active. */
  lastSeenTimestamp: number;
  observedAt: number;
}

export function evaluateClock(
  previousLastSeen: number | null | undefined,
  now: number = Date.now()
): ClockGuardResult {
  const hasMark = typeof previousLastSeen === "number" && Number.isFinite(previousLastSeen);
  const tampered = hasMark && now < (previousLastSeen as number) - CLOCK_TOLERANCE_MS;
  return {
    tampered,
    // Keep the old mark while tampered so correcting the clock clears the lock.
    lastSeenTimestamp: tampered
      ? (previousLastSeen as number)
      : Math.max(now, hasMark ? (previousLastSeen as number) : 0),
    observedAt: now,
  };
}
