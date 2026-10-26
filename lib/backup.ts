"use client";

/** localStorage keys shared by the auto-backup runner, Home utilities and the
 *  backup button. Keeping them in one module stops the two paths from using
 *  different stamps and re-running a snapshot that already happened. */
export const LAST_BACKUP_KEY = "maher-last-backup";
export const AUTO_BACKUP_DATE_KEY = "maher-auto-backup-date";
export const BACKUP_EVENT = "maher:backup";

export function formatBackupStamp(date = new Date()): string {
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY);
  } catch {
    return null;
  }
}

/** Persist a stamp and let any mounted page (Home's utilities card) react. */
export function publishBackup(stamp = formatBackupStamp()): string {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, stamp);
  } catch {
    /* private mode etc. — the event still updates the current page */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BACKUP_EVENT, { detail: stamp }));
  }
  return stamp;
}
