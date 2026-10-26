"use client";

import { useEffect, useState } from "react";
import { BACKUP_EVENT, readLastBackup } from "@/lib/backup";

/** Last backup stamp shared by AutoBackup and the Service utilities rail. */
export function useLastBackup(): string | null {
  const [stamp, setStamp] = useState<string | null>(null);

  useEffect(() => {
    setStamp(readLastBackup());
    const onBackup = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setStamp(detail || readLastBackup());
    };
    window.addEventListener(BACKUP_EVENT, onBackup);
    return () => window.removeEventListener(BACKUP_EVENT, onBackup);
  }, []);

  return stamp;
}
