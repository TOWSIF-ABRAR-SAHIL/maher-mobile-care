"use client";

import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SnapshotInfo } from "@/app/api/backup/list/route";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Pick a snapshot and restore it (with pre-restore safety copy). */
export function RestoreDialog({
  open,
  onClose,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [snaps, setSnaps] = useState<SnapshotInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmFile(null);
    setLoading(true);
    fetch("/api/backup/list")
      .then((r) => r.json())
      .then((d) => setSnaps(d.snapshots ?? []))
      .catch(() => toast.error("ব্যাকআপ তালিকা আসেনি"))
      .finally(() => setLoading(false));
  }, [open ]);

  const restore = async (file: string) => {
    if (confirmFile !== file) {
      // First click arms the confirm — second click executes.
      setConfirmFile(file);
      return;
    }
    setRestoring(true);
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ফিরিয়ে আনা যায়নি");
      toast.success(
        `ফিরিয়ে আনা হয়েছে (${data.restored ?? 0}টি রেকর্ড, safety-copy রাখা আছে)`
      );
      onRestored();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফিরিয়ে আনা যায়নি");
    } finally {
      setRestoring(false);
      setConfirmFile(null);
    }
  };

  return (
    <div className="print:hidden">
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2">
                <History className="h-5 w-5" />
                ব্যাকআপ থেকে ফিরিয়ে আনুন
              </span>
            </DialogTitle>
          </DialogHeader>
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            Restore করলে এখনকার data মুছে গিয়ে ঐ snapshot-এর data আসবে।
            ভুল হলে ফেরত পেতে restore-এর আগের safety-copy auto রাখা হবে।
          </p>
          {loading ? (
            <p className="py-6 text-center text-sm text-gray-500">
              তালিকা আসছে…
            </p>
          ) : snaps.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-500">
              কোনো ব্যাকআপ নেই। আগে ব্যাকআপ বাটনে backup নিন।
            </p>
          ) : (
            <div className="space-y-2">
              {snaps.map((s) => (
                <div
                  key={s.file}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {fmtDate(s.mtime)}
                      {s.kind === "safety" ? (
                        <span className="ml-1 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">
                          safety
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {s.file} • {s.sizeKB} KB •{" "}
                      {s.rowCount === null
                        ? "রেকর্ড পড়া যায়নি"
                        : `${s.rowCount}টি রেকর্ড`}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={confirmFile === s.file ? "default" : "outline"}
                    className={
                      confirmFile === s.file
                        ? "shrink-0 bg-red-600 hover:bg-red-700"
                        : "shrink-0"
                    }
                    disabled={restoring}
                    onClick={() => void restore(s.file)}
                  >
                    {restoring && confirmFile === s.file ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : null}
                    {confirmFile === s.file ? "নিশ্চিত?" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
