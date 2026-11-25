"use client";

import { useState } from "react";
import {
  DatabaseBackup,
  FileCode,
  FileSpreadsheet,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishBackup } from "@/lib/backup";

type ExportFormat = "system" | "excel" | "pdf" | "csv";

type ExportOption = {
  format: ExportFormat;
  testId: string;
  icon: typeof ShieldCheck;
  title: string;
  subtext: string;
  badge: string;
  fallback: string;
};

const OPTIONS: ExportOption[] = [
  {
    format: "system",
    testId: "export-system-backup",
    icon: ShieldCheck,
    title: "সম্পূর্ণ সিস্টেম রিকভারি ব্যাকআপ",
    subtext:
      "পিসি পরিবর্তন বা ডাটা পুনরুদ্ধারের মূল ব্যাকআপ ফাইল। এটি রিস্টোর অপশনে ব্যবহারযোগ্য।",
    badge: ".db / .sql / .maherbackup",
    fallback: "MAHER_SYSTEM_BACKUP.db",
  },
  {
    format: "excel",
    testId: "export-excel",
    icon: FileSpreadsheet,
    title: "এক্সেল স্প্রেডশিট",
    subtext: "সার্ভিস, প্রোডাক্ট ও হিসাবের বহু-ট্যাব বিশিষ্ট সম্পূর্ণ এক্সেল শিট।",
    badge: ".xlsx",
    fallback: "mss-backup.xlsx",
  },
  {
    format: "pdf",
    testId: "export-pdf",
    icon: FileText,
    title: "পিডিএফ সামারি রিপোর্ট",
    subtext: "প্রিন্ট ও অফিশিয়াল ডকুমেন্টের জন্য তৈরি করা সারাংশ রিপোর্ট।",
    badge: ".pdf",
    fallback: "mss-business-overview.pdf",
  },
  {
    format: "csv",
    testId: "export-csv",
    icon: FileCode,
    title: "সিএসভি ডাটা ফাইল",
    subtext: "অন্য সফটওয়্যারে ব্যবহারের উপযোগী র ডাটা ফাইল।",
    badge: ".csv",
    fallback: "mss-backup.csv",
  },
];

function exportUrl(format: ExportFormat): string {
  if (format === "system") return "/api/backup?format=system";
  if (format === "excel") return "/api/backup?format=xlsx";
  if (format === "pdf") return "/api/backup?format=pdf";
  return "/api/backup";
}

/** Four-format export picker opened by the Dashboard backup action. */
export function BackupExportDialog({
  open,
  onClose,
  onExported,
}: {
  open: boolean;
  onClose: () => void;
  onExported: () => void;
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const download = async (option: ExportOption) => {
    if (busy) return;
    setBusy(option.format);
    try {
      const res = await fetch(exportUrl(option.format), { cache: "no-store" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "ব্যাকআপ তৈরি করা যায়নি");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const fileName =
        /filename="([^"]+)"/.exec(disposition)?.[1] ?? option.fallback;
      const { downloadBlob } = await import("@/lib/download");
      downloadBlob(blob, fileName);
      publishBackup();
      toast.success(`${option.title} তৈরি হয়েছে`);
      onExported();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ব্যাকআপ তৈরি করা যায়নি");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="print:hidden">
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) onClose();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#223D57] text-white">
                <DatabaseBackup className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-left text-xl font-bold text-[#1F2A36]">
                  ডাটা ব্যাকআপ নিন
                </DialogTitle>
                <DialogDescription className="mt-1 text-left text-sm text-[#5E6B78]">
                  আপনার প্রয়োজন অনুযায়ী ফরম্যাট বেছে নিন। সব ফাইল এই পিসিতেই তৈরি
                  হয় এবং কোথাও পাঠানো হয় না।
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="ব্যাকআপ ফরম্যাট">
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = busy === option.format;
              return (
                <button
                  key={option.format}
                  type="button"
                  data-testid={option.testId}
                  disabled={!!busy}
                  aria-busy={active}
                  onClick={() => void download(option)}
                  className="group flex h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors duration-150 hover:border-[#35648C] hover:bg-[#F3F5F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#35648C] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3F5F7] text-[#223D57] group-hover:bg-white">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="rounded-md border border-slate-200 bg-[#F3F5F7] px-2 py-1 text-[10px] font-bold tracking-wide text-[#35648C]">
                      {option.badge}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-bold leading-snug text-[#1F2A36]">
                    {option.title}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-[#5E6B78]">
                    {option.subtext}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-[#2F5F88]">
                    {active ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        তৈরি হচ্ছে…
                      </>
                    ) : (
                      <>ডাউনলোড করুন</>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-[#F3F5F7] px-3 py-2 text-xs text-[#5E6B78]">
            <span>কোনো ফাইল নির্বাচন না করেই বন্ধ করতে পারেন।</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-[#223D57]"
              disabled={!!busy}
              onClick={onClose}
            >
              বন্ধ করুন
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
