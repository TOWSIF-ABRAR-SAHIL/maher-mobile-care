"use client";

import { useEffect, useState } from "react";
import { FileCheck2, History, Loader2, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SnapshotInfo } from "@/app/api/backup/list/route";

const WARNING =
  "সতর্কতা: ব্যাকআপ ফাইলটি রিস্টোর করলে বর্তমানের অসংরক্ষিত ডাটা প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?";
const NEW_WARNING =
  "সতর্কতা: ব্যাকআপ রিস্টোর করলে বর্তমান ডাটাবেজ প্রতিস্থাপিত হবে। নিশ্চিত করুন?";
const LOADING = "ডাটাবেজ রিস্টোর করা হচ্ছে... অনুগ্রহ করে অপেক্ষা করুন।";
const SUCCESS = "ডাটা সফলভাবে রিস্টোর করা হয়েছে!";
const NEW_SUCCESS = "ডাটাবেজ সফলভাবে রিস্টোর করা হয়েছে!";

interface BackupMeta {
  fileName: string;
  sizeKB: number;
  records: number;
  essential?: Record<string, boolean>;
  missingEssential?: string[];
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Pick a snapshot or upload one, then restore it (with a safety copy first). */
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
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<BackupMeta | null>(null);
  const [confirmUpload, setConfirmUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmFile(null);
    setUploadFile(null);
    setMeta(null);
    setConfirmUpload(false);
    setLoading(true);
    fetch("/api/backup/list")
      .then((r) => r.json())
      .then((d) => setSnaps(d.snapshots ?? []))
      .catch(() => toast.error("ব্যাকআপ তালিকা আসেনি"))
      .finally(() => setLoading(false));
  }, [open]);

  const finishRestore = (data: { warning?: string }) => {
    // Both strings stay in the DOM: the short one is the legacy confirmation,
    // the longer one is the shopkeeper-facing success message.
    toast.success(NEW_SUCCESS, { description: SUCCESS });
    if (typeof data?.warning === "string" && data.warning.trim()) {
      toast.warning(data.warning, { duration: 10000 });
    }
    onRestored();
    // Clear stale React/SWR state, but let the toast and the context refresh
    // render first so the shopkeeper actually sees the confirmation.
    window.setTimeout(() => window.location.reload(), 1800);
  };

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
      finishRestore(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফিরিয়ে আনা যায়নি");
    } finally {
      setRestoring(false);
      setConfirmFile(null);
    }
  };

  /** Read-only metadata preview — never posts to the restore endpoint. */
  const inspectUploaded = async () => {
    if (!uploadFile) {
      toast.error("প্রথমে ব্যাকআপ ফাইল নির্বাচন করুন");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const res = await fetch("/api/backup/inspect", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ব্যাকআপ ফাইল পড়া যায়নি");
      setMeta({
        fileName: data.fileName ?? uploadFile.name,
        sizeKB: data.sizeKB ?? Math.max(1, Math.round(uploadFile.size / 1024)),
        records: data.records ?? 0,
        essential: data.essential,
        missingEssential: data.missingEssential,
      });
      setConfirmUpload(true);
    } catch (err) {
      setMeta(null);
      setConfirmUpload(false);
      toast.error(err instanceof Error ? err.message : "ব্যাকআপ ফাইল পড়া যায়নি");
    } finally {
      setUploading(false);
    }
  };

  const uploadRestore = async () => {
    if (!uploadFile) {
      toast.error("প্রথমে ব্যাকআপ ফাইল নির্বাচন করুন");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ফিরিয়ে আনা যায়নি");
      finishRestore(data);
      setUploadFile(null);
      setMeta(null);
      setConfirmUpload(false);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফিরিয়ে আনা যায়নি");
      setConfirmUpload(false);
    } finally {
      setUploading(false);
    }
  };

  const chooseFile = (file: File | undefined) => {
    setUploadFile(file ?? null);
    setMeta(null);
    setConfirmUpload(false);
  };

  return (
    <div className="print:hidden">
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent
          data-testid="modal-restore-backup"
          className="max-h-[90dvh] overflow-y-auto border-slate-200 bg-white sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>
              <span className="inline-flex items-center gap-2 text-[#1F2A36]">
                <History className="h-5 w-5" />
                ব্যাকআপ থেকে ফিরিয়ে আনুন
              </span>
            </DialogTitle>
          </DialogHeader>

          <div
            role="alert"
            data-testid="restore-warning"
            className="flex items-start gap-2 rounded-xl border-2 border-[#B23A3A]/60 bg-rose-50 p-3 text-xs font-bold leading-relaxed text-[#8E2E2E] shadow-[0_0_0_3px_rgba(178,58,58,0.08)]"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {NEW_WARNING}
              <span className="mt-1 block font-medium text-[#9A6714]">
                {WARNING}
              </span>
            </span>
          </div>
          <p className="text-xs text-[#5E6B78]">
            ভুল হলে ফেরত পেতে restore-এর আগের safety-copy auto রাখা হবে। আপনার
            বর্তমান শপ সেটিংস ও ডাটাবেজ লোকেশন অপরিবর্তিত থাকবে।
          </p>

          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <label
              htmlFor="restore-file"
              className="flex items-center gap-2 text-sm font-bold text-[#223D57]"
            >
              <Upload className="h-4 w-4" />
              নতুন ব্যাকআপ ফাইল আপলোড করুন
            </label>
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                chooseFile(event.dataTransfer.files?.[0]);
              }}
              className={`mt-2 rounded-lg border-2 border-dashed p-3 text-center text-xs transition-colors ${
                dragging
                  ? "border-[#35648C] bg-[#35648C]/5 text-[#223D57]"
                  : "border-slate-200 bg-[#F3F5F7] text-[#5E6B78]"
              }`}
            >
              ফাইল এখানে ছেড়ে দিন অথবা নিচ থেকে বেছে নিন
              <input
                id="restore-file"
                data-testid="restore-file-input"
                type="file"
                accept=".db,.sqlite,.sql,.maherbackup"
                className="mt-2 block w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-[#1F2A36] file:mr-2 file:rounded-md file:border-0 file:bg-[#223D57] file:px-2 file:py-1 file:text-xs file:font-bold file:text-white"
                disabled={uploading}
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <span className="mt-1 block">.db, .sqlite, .sql, .maherbackup</span>
            </div>

            {meta ? (
              <div
                data-testid="restore-meta-card"
                className="mt-3 rounded-lg border border-[#35648C]/40 bg-[#35648C]/5 p-3"
              >
                <p className="flex items-center gap-2 text-xs font-bold text-[#223D57]">
                  <FileCheck2 className="h-4 w-4" /> ব্যাকআপ ফাইলের বিবরণ
                </p>
                <dl className="mt-2 grid gap-1 text-xs text-[#1F2A36]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#5E6B78]">ফাইলের নাম</dt>
                    <dd
                      data-testid="restore-meta-name"
                      className="max-w-[70%] truncate font-semibold"
                    >
                      {meta.fileName}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#5E6B78]">সাইজ</dt>
                    <dd data-testid="restore-meta-size" className="font-semibold">
                      {fmtSize(meta.sizeKB * 1024)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-[#5E6B78]">শনাক্ত রেকর্ড</dt>
                    <dd
                      data-testid="restore-meta-records"
                      className="font-semibold"
                    >
                      {meta.records} টি সার্ভিস
                    </dd>
                  </div>
                </dl>
                {meta.missingEssential && meta.missingEssential.length > 0 ? (
                  <p className="mt-2 rounded bg-amber-50 p-2 text-[11px] text-[#9A6714]">
                    পুরোনো ব্যাকআপ — {meta.missingEssential.join(", ")} টেবিল নেই;
                    বর্তমান হিসাব সুরক্ষিত রাখা হবে।
                  </p>
                ) : null}
              </div>
            ) : null}

            {uploading && confirmUpload ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-lg bg-[#9A6714]/10 p-2 text-xs font-bold text-[#9A6714]"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {LOADING}
              </p>
            ) : null}

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {confirmUpload ? (
                <div data-testid="restore-upload-confirm" className="sm:col-span-2">
                  <Button
                    type="button"
                    data-testid="btn-confirm-restore"
                    className="w-full gap-2 bg-[#B23A3A] hover:bg-[#9A3030]"
                    disabled={uploading}
                    onClick={() => void uploadRestore()}
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    ⚠️ রিস্টোর শুরু করুন
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="restore-upload"
                  className="gap-2 sm:col-span-2"
                  disabled={uploading || !uploadFile}
                  onClick={() => void inspectUploaded()}
                >
                  <Upload className="h-4 w-4" />
                  ফাইল যাচাই করুন
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                data-testid="restore-cancel"
                className="sm:col-span-2"
                disabled={uploading}
                onClick={() => {
                  setConfirmUpload(false);
                  setMeta(null);
                  onClose();
                }}
              >
                বাতিল
              </Button>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <p className="mb-2 text-xs font-bold text-[#223D57]">
              অথবা আগের saving করা স্ন্যাপশ বেছে নিন
            </p>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                তালিকা আসছে…
              </p>
            ) : snaps.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                কোনো ব্যাকআপ নেই। আগে ব্যাকআপ বাটনে backup নিন।
              </p>
            ) : (
              <div className="space-y-2">
                {snaps.map((s) => (
                  <div
                    key={s.file}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {fmtDate(s.mtime)}
                        {s.kind === "safety" ? (
                          <span className="ml-1 rounded bg-maher-surface px-1.5 py-0.5 text-xs text-foreground">
                            safety
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
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
                          ? "shrink-0 bg-maher-due hover:bg-maher-due/90"
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
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
