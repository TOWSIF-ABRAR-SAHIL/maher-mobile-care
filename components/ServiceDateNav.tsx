"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderDatePicker } from "@/components/HeaderDatePicker";

/**
 * Date navigation belongs to the service list, not the app chrome. Changing
 * the day changes the list and the form's booking day together; the desk
 * always means "today" until the user picks another day.
 */
export function ServiceDateNav({
  date,
  onPrev,
  onNext,
  onDateChange,
  onToday,
  isToday,
}: {
  date: string;
  onPrev: () => void;
  onNext: () => void;
  onDateChange: (date: string) => void;
  onToday: () => void;
  isToday: boolean;
}) {
  return (
    <div
      data-testid="service-date-nav"
      className="flex h-10 min-w-0 flex-nowrap items-center gap-1 print:hidden sm:gap-1.5"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="আগের দিন"
        className="h-9 shrink-0 rounded-lg border-slate-200/80 bg-white px-2.5 shadow-sm focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
        onClick={onPrev}
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">আগের দিন</span>
      </Button>
      <div className="min-w-[130px] max-w-[210px] flex-1 sm:w-[210px] sm:min-w-[142px] sm:flex-none">
        <HeaderDatePicker date={date} onDateChange={onDateChange} tone="light" />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="পরের দিন"
        className="h-9 shrink-0 rounded-lg border-slate-200/80 bg-white px-2.5 shadow-sm focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
        onClick={onNext}
      >
        <span className="mr-1 hidden sm:inline">পরের দিন</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant={isToday ? "secondary" : "default"}
        onClick={onToday}
        disabled={isToday}
        aria-current={isToday ? "date" : undefined}
        className={
          isToday
            ? "h-9 min-w-[68px] shrink-0 justify-center whitespace-nowrap rounded-lg border-slate-200/80 bg-slate-100 text-slate-500 shadow-sm disabled:opacity-100 sm:min-w-[86px]"
            : "h-9 min-w-[68px] shrink-0 justify-center whitespace-nowrap rounded-lg border-maher-navy bg-maher-navy text-white shadow-sm hover:bg-maher-navy-light focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10 sm:min-w-[86px]"
        }
      >
        <CalendarDays className="mr-1 hidden h-4 w-4 sm:block" />
        আজ
      </Button>
    </div>
  );
}
