"use client";

import { useState } from "react";
import {
  Database,
  Download,
  Ellipsis,
  History,
  Loader2,
  Monitor,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Let a dialog finish closing (200ms motion contract) before the next dialog
 *  opens or a download starts, so focus and overlays hand over cleanly. */
const RUN_AFTER_CLOSE_MS = 180;

/**
 * The Service desk's compact backup strip. Backup stays one click away; the
 * noisier system actions (refresh, restore) live behind the small overflow
 * dialog so they never compete with the shop's daily workflow.
 */
export function ServiceUtilities({
  lastBackup,
  refreshing,
  backingUp,
  onRefresh,
  onBackup,
  onRestore,
  className,
}: {
  lastBackup: string | null;
  refreshing: boolean;
  backingUp: boolean;
  onRefresh: () => void;
  onBackup: () => void;
  onRestore: () => void;
  className?: string;
}) {
  const [dataOpen, setDataOpen] = useState(false);

  const closeThenRun = (run: () => void) => {
    setDataOpen(false);
    window.setTimeout(run, RUN_AFTER_CLOSE_MS);
  };

  const backupLabel = lastBackup
    ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
    : "এখনো ব্যাকআপ হয়নি";

  return (
    <section
      data-testid="service-utilities"
      aria-label="ডেটা ও ব্যাকআপ"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 text-[11px] print:hidden",
        className
      )}
    >
      <p
        className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"
        title={backupLabel}
      >
        <Database className="h-3.5 w-3.5 shrink-0 text-maher-navy/75" />
        <span className="truncate">
          {lastBackup ? (
            <>
              সর্বশেষ ব্যাকআপ:{" "}
              <span className="font-semibold text-maher-ink">{lastBackup}</span>
            </>
          ) : (
            "এখনো ব্যাকআপ হয়নি"
          )}
        </span>
      </p>

      <span
        className="hidden items-center gap-1 rounded-full border border-maher-border bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex"
        title="সব ডেটা এই PC-এর লোকাল SQLite ফাইলে থাকে — ইন্টারনেট বা ক্লাউড লাগে না"
      >
        <Monitor className="h-3 w-3 text-maher-done" />
        ডেটা এই PC-তে
      </span>

      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="service-backup"
          onClick={onBackup}
          disabled={backingUp}
          className="h-7 gap-1 border-maher-navy/25 bg-white px-2 text-[11px] text-maher-navy hover:border-maher-navy/40 hover:bg-maher-blue-soft/60 hover:text-maher-navy"
          title="ডেটাবেস snapshot + সাজানো Excel ডাউনলোড"
        >
          {backingUp ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          ব্যাকআপ
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          data-testid="service-data-menu"
          onClick={() => setDataOpen(true)}
          className="h-7 w-7 bg-white"
          aria-label="ডেটা ও ব্যাকআপ মেনু"
          title="ডেটা ও ব্যাকআপ"
        >
          <Ellipsis className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={dataOpen} onOpenChange={setDataOpen}>
        <DialogContent
          data-testid="service-data-dialog"
          className="sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-maher-navy" />
              ডেটা ও ব্যাকআপ
            </DialogTitle>
            <DialogDescription>
              সব ডেটা এই PC-তে লোকাল SQLite ফাইলে থাকে — কোনো ইন্টারনেট বা
              ক্লাউড নেই।
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl border border-maher-border bg-maher-surface/70 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              সর্বশেষ ব্যাকআপ
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-maher-ink">
              {lastBackup ?? "এখনো ব্যাকআপ হয়নি"}
            </p>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              স্ন্যাপশট backups ফোল্ডারে জমা হয়, আর একটি সাজানো Excel ফাইল
              ডাউনলোডে আসে — ইন্টারনেট লাগে না।
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
              Excel-এ সার্ভিস খাতা (কাস্টমার ও টাকার হিসাব), সারসংক্ষেপ আর
              সম্পূর্ণ ডেটা (অডিট) — তিনটি আলাদা শিটে।
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button
              type="button"
              data-testid="service-data-backup"
              onClick={() => closeThenRun(onBackup)}
              disabled={backingUp}
              className="h-9 justify-start bg-maher-navy text-white hover:bg-maher-navy-light"
            >
              {backingUp ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              এখনই ব্যাকআপ
              <span className="ml-auto text-[10px] font-normal text-white/70">
                snapshot + Excel
              </span>
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="service-refresh"
              onClick={() => closeThenRun(onRefresh)}
              disabled={refreshing}
              className="h-9 justify-start bg-white"
            >
              <RefreshCw
                className={cn("h-4 w-4", refreshing && "animate-spin")}
              />
              রিফ্রেশ
              <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                ডেটা আবার লোড
              </span>
            </Button>

            <div className="mt-1 border-t border-maher-border pt-3">
              <Button
                type="button"
                variant="outline"
                data-testid="service-restore"
                onClick={() => closeThenRun(onRestore)}
                className="h-9 w-full justify-start border-maher-due/35 bg-white text-maher-due-ink hover:border-maher-due/55 hover:bg-maher-due/10 hover:text-maher-due-ink"
              >
                <History className="h-4 w-4" />
                ব্যাকআপ থেকে রিস্টোর…
              </Button>
              <p className="mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
                পুরোনো snapshot ফিরিয়ে আনে — বর্তমান ডেটা মুছে যাবে। ভুল হলে
                ফেরত পেতে আগের safety-copy রাখা হয়।
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
