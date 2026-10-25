"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Loader2,
  Printer,
  RefreshCw,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HeaderSearch, MobileSearch } from "@/components/HeaderSearch";
import { bengaliDateLabel } from "@/lib/dhaka";
import type { ServiceDTO } from "@/lib/types";

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
  onManageTechnicians,
  onPrint,
  searchRefreshKey,
  onSearchEdit,
  onSearchReceipt,
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
  onManageTechnicians: () => void;
  onPrint: () => void;
  searchRefreshKey: number;
  onSearchEdit: (service: ServiceDTO) => void;
  onSearchReceipt: (service: ServiceDTO) => void;
}) {
  return (
    <header className="sticky top-0 z-40 rounded-xl border-b border-blue-950/60 bg-[#0b2a4a] px-3 py-2.5 text-white shadow-sm xl:py-1.5 print:static print:rounded-none print:border print:border-gray-300 print:bg-white print:text-black print:shadow-none">
      <div className="flex flex-col gap-2 xl:gap-1.5">
        {/* Row 1: title + search. Below xl this is the phone/tablet header. */}
        <div className="flex items-start justify-between gap-3 xl:items-center">
          <div className="min-w-0 flex-1">
            <div className="xl:flex xl:items-baseline xl:gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl xl:text-xl print:text-black">
                MAHER MOBILE CARE
              </h1>
              <p className="text-xs text-blue-100 sm:text-sm xl:text-xs print:text-gray-600">
                দৈনিক সার্ভিস ট্র্যাকার ও টেকনিশিয়ান ড্যাশবোর্ড
              </p>
            </div>
            {/* Desktop keeps the header to two lines: the backup time moves
                into the Backup button's tooltip instead of a third line. */}
            <p className="text-xs text-blue-200 xl:hidden print:hidden">
              {lastBackup
                ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
                : "এখনো ব্যাকআপ হয়নি"}
            </p>
          </div>
          {/* One of these is visible at a time: icon below xl, input at xl+. */}
          <HeaderSearch
            refreshKey={searchRefreshKey}
            onEdit={onSearchEdit}
            onReceipt={onSearchReceipt}
          />
          <MobileSearch
            refreshKey={searchRefreshKey}
            onEdit={onSearchEdit}
            onReceipt={onSearchReceipt}
          />
        </div>

        {/* Date + actions. Stacked through 1279px, one row from xl. */}
        <div className="flex flex-col gap-2 print:hidden xl:flex-row xl:items-center xl:justify-between xl:[&_button]:h-8 xl:[&_button]:px-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label="আগের দিন"
              className="shrink-0 bg-white text-gray-800 hover:bg-blue-50"
              onClick={onPrev}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">আগের দিন</span>
            </Button>
            <div className="min-w-0 flex-1 md:w-[210px] md:flex-none">
              <Input
                type="date"
                value={date}
                aria-label="তারিখ বাছুন"
                onChange={(e) => {
                  if (e.target.value) onDateChange(e.target.value);
                }}
                className="h-8 w-full bg-white text-gray-800"
              />
              <p className="mt-0.5 hidden truncate text-center text-xs text-blue-100 sm:block">
                {bengaliDateLabel(date)}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              aria-label="পরের দিন"
              className="shrink-0 bg-white text-gray-800 hover:bg-blue-50"
              onClick={onNext}
            >
              <span className="hidden sm:inline">পরের দিন</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* 2 columns on phones, 3 on large phones, one wrapping row at md+. */}
          <div
            data-testid="header-actions"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center md:gap-2 [&_button]:whitespace-nowrap"
          >
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
              title="এখনই রিফ্রেশ করুন"
              aria-label="এখনই রিফ্রেশ করুন"
            >
              {syncing ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 sm:mr-1" />
              )}
              <span className="sm:hidden">সিঙ্ক</span>
              <span className="hidden sm:inline">রিফ্রেশ</span>
            </Button>
            <Button
              size="sm"
              className="border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
              onClick={onBackup}
              disabled={backingUp}
              title={
                lastBackup
                  ? `সর্বশেষ ব্যাকআপ: ${lastBackup}`
                  : "এখনো ব্যাকআপ হয়নি"
              }
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
              onClick={onManageTechnicians}
              title="টেকনিশিয়ান যোগ / বদল / ডিলিট"
            >
              <Settings className="mr-1 h-4 w-4" />
              টেকনিশিয়ান
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white"
              onClick={onRestore}
              title="ব্যাকআপ থেকে ফিরিয়ে আনুন"
            >
              <History className="mr-1 h-4 w-4" />
              রিস্টোর
            </Button>
            <Button
              size="sm"
              className="bg-white text-gray-800 hover:bg-blue-50"
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
