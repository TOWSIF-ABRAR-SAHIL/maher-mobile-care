"use client";

import { CalendarDays, Download, History, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Header({
  date,
  onPrev,
  onNext,
  onDateChange,
  onToday,
  lastBackup,
  onSync,
  syncing,
  onBackup,
  backingUp,
  onRestore,
  onPrint,
}: {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  onDateChange: (date: string) => void;
  onToday: () => void;
  lastBackup: string | null;
  onSync: () => void;
  syncing: boolean;
  onBackup: () => void;
  backingUp: boolean;
  onRestore: () => void;
  onPrint: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 rounded-xl border-b border-blue-950/40 bg-gradient-to-r from-blue-900 via-[#1d4ed8] to-blue-900 px-4 py-3 text-white shadow-md print:static print:rounded-none print:border print:border-gray-300 print:bg-white print:text-black print:shadow-none">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-white drop-shadow-sm sm:text-2xl print:text-black">
            MAHER MOBILE CARE
          </h1>
          <p className="text-xs text-blue-100 sm:text-sm print:text-gray-600">
            দৈনিক সার্ভিস ট্র্যাকার ও টেকনিশিয়ান ড্যাশবোর্ড
          </p>
          <p className="text-[11px] text-blue-200 print:hidden">
            {lastBackup
              ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
              : "এখনো ব্যাকআপ হয়নি"}
          </p>
        </div>
        <div className="flex flex-col gap-2 print:hidden lg:w-auto lg:flex-row lg:flex-wrap lg:items-center">
          {/* Date nav — always one neat row */}
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 bg-white text-gray-800 hover:bg-blue-50"
              onClick={onPrev}
            >
              ◄ আগের দিন
            </Button>
            <Input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) onDateChange(e.target.value);
              }}
              className="h-8 min-w-0 flex-1 bg-white text-gray-800 lg:w-auto lg:flex-none"
            />
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 bg-white text-gray-800 hover:bg-blue-50"
              onClick={onNext}
            >
              পরের দিন ►
            </Button>
          </div>
          {/* Actions — 2x2 grid on mobile, one row on desktop */}
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center lg:gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="bg-white text-gray-800 hover:bg-blue-50"
            onClick={onToday}
          >
            <CalendarDays className="mr-1 h-4 w-4" />
            আজ
          </Button>
          <Button
            size="sm"
            className="border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={onSync}
            disabled={syncing}
            title="এখনই রিফ্রেশ (Sync Now)"
          >
            {syncing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 sm:mr-1" />
            )}
            <span className="sm:hidden">Sync</span>
            <span className="hidden sm:inline">Sync Now</span>
          </Button>
          <Button
            size="sm"
            className="border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={onBackup}
            disabled={backingUp}
          >
            {backingUp ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1 h-4 w-4" />
            )}
            ব্যাকআপ
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
            onClick={onRestore}
            title="ব্যাকআপ থেকে ফিরিয়ে আনুন"
          >
            <History className="mr-1 h-4 w-4" />
            Restore
          </Button>
          <Button
            size="sm"
            className="bg-green-600 text-white hover:bg-green-700"
            onClick={onPrint}
          >
            <Printer className="mr-1 h-4 w-4" />
            প্রিন্ট
          </Button>
          </div>
        </div>
      </div>
    </header>
  );
}
