"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { LicenseStatus } from "@/lib/licensing/types";
import { LicenseContext } from "./license-context";
import { LicenseGate } from "./LicenseGate";

/**
 * Root-level gatekeeper. Children render optimistically on the first paint so
 * SSR and every existing testid contract stay intact; the full-screen gate is
 * only mounted once the server has answered "locked".
 */
export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/license/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as LicenseStatus);
    } catch {
      // Keep the last known state; the app must never crash because a local
      // status probe failed.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = useCallback(
    async (key: string, mode: "activate" | "renew" = "activate") => {
      try {
        const res = await fetch("/api/license/activate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          status?: LicenseStatus;
        };
        if (!res.ok || !data.ok || !data.status) {
          toast.error(data.error ?? "লাইসেন্স সক্রিয় করা যায়নি।");
          await refresh();
          return false;
        }
        setStatus(data.status);
        setLoaded(true);
        toast.success(
          mode === "renew"
            ? "লাইসেন্স রিনিউ হয়েছে।"
            : "লাইসেন্স সক্রিয় হয়েছে।"
        );
        return true;
      } catch {
        toast.error("লাইসেন্স সক্রিয় করা যায়নি।");
        return false;
      }
    },
    [refresh]
  );

  const value = useMemo(
    () => ({ status, loaded, refresh, activate }),
    [status, loaded, refresh, activate]
  );

  return (
    <LicenseContext.Provider value={value}>
      {children}
      {loaded && status && !status.active ? <LicenseGate /> : null}
    </LicenseContext.Provider>
  );
}
