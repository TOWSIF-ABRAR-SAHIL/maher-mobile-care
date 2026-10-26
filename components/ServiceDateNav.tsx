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
      className="flex min-w-0 flex-wrap items-center gap-1.5 print:hidden"
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="আগের দিন"
        className="h-9 shrink-0 bg-white px-2.5"
        onClick={onPrev}
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="ml-1 hidden sm:inline">আগের দিন</span>
      </Button>
      <div className="min-w-[142px] flex-1 sm:w-[210px] sm:flex-none">
        <HeaderDatePicker date={date} onDateChange={onDateChange} tone="light" />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="পরের দিন"
        className="h-9 shrink-0 bg-white px-2.5"
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
        className={
          isToday
            ? "h-9 shrink-0 bg-maher-surface-strong text-maher-navy/60"
            : "h-9 shrink-0 bg-maher-navy text-white hover:bg-maher-navy-light"
        }
      >
        <CalendarDays className="mr-1 h-4 w-4" />
        আজ
      </Button>
    </div>
  );
}
