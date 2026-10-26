"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { AUTO_BACKUP_DATE_KEY, publishBackup } from "@/lib/backup";
import { dhakaDateKey } from "@/lib/dhaka";

/**
 * One automatic snapshot per Dhaka day, mounted once in the root layout so it
 * runs whichever page the shop opens first. The ref guard keeps React
 * StrictMode's double effect from taking two snapshots in development.
 */
export function AutoBackup() {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    const today = dhakaDateKey(new Date());
    try {
      if (localStorage.getItem(AUTO_BACKUP_DATE_KEY) === today) return;
    } catch {
      /* private mode: still try one snapshot for this session */
    }

    void (async () => {
      try {
        const res = await fetch("/api/backup", { method: "POST" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) return;
        try {
          localStorage.setItem(AUTO_BACKUP_DATE_KEY, today);
        } catch {
          /* ignore */
        }
        publishBackup();
        toast.success("অটো ব্যাকআপ হয়েছে");
      } catch {
        /* server busy — the manual backup on Service is still available */
      }
    })();
  }, []);

  return null;
}
