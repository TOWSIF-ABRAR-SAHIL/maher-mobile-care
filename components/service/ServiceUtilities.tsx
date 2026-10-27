"use client";

import { useEffect, useState } from "react";
import {
  Database,
  Download,
  History,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The Service desk's system rail. Refresh reuses the page's existing loaders,
 * backup is the same snapshot + CSV download the old Home card used, and
 * restore opens the shared RestoreDialog (which asks for a confirmation click).
 * Kept as one slim row so it never competes with the service workflow.
 */
export function ServiceUtilities({
  lastBackup,
  refreshing,
  backingUp,
  onRefresh,
  onBackup,
  onRestore,
}: {
  lastBackup: string | null;
  refreshing: boolean;
  backingUp: boolean;
  onRefresh: () => void;
  onBackup: () => void;
  onRestore: () => void;
}) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <section
      data-testid="service-utilities"
      aria-label="সিস্টেম, ব্যাকআপ ও রিস্টোর"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-maher-border bg-white px-3 py-2 text-[11px] shadow-card print:hidden"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-maher-ink">
        <Database className="h-3.5 w-3.5 text-maher-navy" />
        সিস্টেম
      </span>

      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
          online
            ? "border-maher-done/35 bg-maher-done/10 text-maher-done"
            : "border-maher-money/40 bg-maher-money/10 text-maher-money"
        )}
        title={
          online
            ? "ব্রাউজার অনলাইন (ডেটা তবুও লোকাল SQLite-এ থাকে)"
            : "ব্রাউজার অফলাইন — লোকাল ডেটা দিয়ে কাজ চলবে"
        }
      >
        {online ? (
          <Wifi className="h-3 w-3" />
        ) : (
          <WifiOff className="h-3 w-3" />
        )}
        {online ? "অনলাইন" : "অফলাইন"}
      </span>

      <p
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={
          lastBackup
            ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
            : "এখনো ব্যাকআপ হয়নি"
        }
      >
        {lastBackup
          ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
          : "এখনো ব্যাকআপ হয়নি"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="service-refresh"
          onClick={onRefresh}
          disabled={refreshing}
          className="h-7 bg-white px-2 text-[11px]"
        >
          <RefreshCw
            className={cn("mr-1 h-3.5 w-3.5", refreshing && "animate-spin")}
          />
          রিফ্রেশ
        </Button>
        <Button
          type="button"
          size="sm"
          data-testid="service-backup"
          onClick={onBackup}
          disabled={backingUp}
          className="h-7 bg-maher-navy px-2 text-[11px] text-white hover:bg-maher-navy-light"
        >
          {backingUp ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 h-3.5 w-3.5" />
          )}
          ব্যাকআপ
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="service-restore"
          onClick={onRestore}
          className="h-7 bg-white px-2 text-[11px]"
        >
          <History className="mr-1 h-3.5 w-3.5" />
          রিস্টোর
        </Button>
      </div>
    </section>
  );
}
