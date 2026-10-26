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
 * Reuses the existing refresh/backup/restore handlers and only reports what
 * the app can actually verify: the last backup label stored by this browser,
 * plus the browser's own online/offline signal. It never claims a backup is
 * safe until the POST has completed.
 */
export function SystemUtilities({
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
      data-testid="home-utilities"
      aria-labelledby="home-utility-title"
      className="flex h-full flex-col overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex items-start justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Database className="h-3.5 w-3.5 text-maher-navy" />
          <div>
            <h2
              id="home-utility-title"
              className="text-[13px] font-semibold tracking-tight text-maher-ink"
            >
              সিস্টেম ও ব্যাকআপ
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              লোকাল SQLite · এই পিসিতে
            </p>
          </div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            online
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700"
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
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {lastBackup
              ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
              : "এখনো ব্যাকআপ হয়নি"}
          </p>

          <div className="mt-3 grid grid-cols-3 gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="home-refresh"
              onClick={onRefresh}
              disabled={refreshing}
              className="bg-white px-2 text-[11px]"
            >
              <RefreshCw
                className={cn(
                  "mr-1 h-3.5 w-3.5",
                  refreshing && "animate-spin"
                )}
              />
              রিফ্রেশ
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="home-backup"
              onClick={onBackup}
              disabled={backingUp}
              className="bg-maher-navy px-2 text-[11px] text-white hover:bg-maher-navy-light"
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
              data-testid="home-restore"
              onClick={onRestore}
              className="bg-white px-2 text-[11px]"
            >
              <History className="mr-1 h-3.5 w-3.5" />
              রিস্টোর
            </Button>
          </div>
        </div>

        <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
          দিনে একবার অটো ব্যাকআপ হয়। ব্যাকআপ ফাইল শুধু এই পিসিতেই থাকে।
        </p>
      </div>
    </section>
  );
}
