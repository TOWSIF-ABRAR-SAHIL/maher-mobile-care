"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { bengaliDateLabel, dhakaDateKey, isDateKey } from "@/lib/dhaka";
import { toBnDigits } from "@/lib/utils";

const MONTHS_BN = [
  "জানুয়ারি",
  "ফেব্রুয়ারি",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্টেম্বর",
  "অক্টোবর",
  "নভেম্বর",
  "ডিসেম্বর",
];

const WEEKDAYS_BN = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহ", "শুক্র", "শনি"];

const pad = (n: number) => String(n).padStart(2, "0");

function parts(key: string): { y: number; m: number; d: number } | null {
  if (!isDateKey(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  return { y, m, d };
}

/**
 * Navbar date field with a controlled Bengali calendar popover.
 *
 * The native <input type="date"> picker cannot be closed by clicking its own
 * calendar button again (browser/OS owned), so the visible calendar affordance
 * is our own toggle. The native input stays in place for typing and for the
 * existing date-navigation tests.
 */
export function HeaderDatePicker({
  date,
  onDateChange,
}: {
  date: string;
  onDateChange: (date: string) => void;
}) {
  const todayKey = dhakaDateKey(new Date());
  const selected = parts(date) ?? parts(todayKey)!;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ y: selected.y, m: selected.m });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const toggle = () => {
    if (!open) {
      const current = parts(date) ?? parts(todayKey)!;
      setView({ y: current.y, m: current.m });
    }
    setOpen((value) => !value);
  };

  // Outside click / Escape closes the popover just like a normal menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        panelRef.current?.contains(target) ||
        rootRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const changeMonth = (delta: number) => {
    const next = new Date(Date.UTC(view.y, view.m - 1 + delta, 1));
    setView({ y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 });
  };

  const pickDay = (day: number) => {
    onDateChange(`${view.y}-${pad(view.m)}-${pad(day)}`);
    setOpen(false);
    toggleRef.current?.focus();
  };

  const firstWeekday = new Date(
    Date.UTC(view.y, view.m - 1, 1)
  ).getUTCDay();
  const totalDays = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div ref={rootRef} className="relative w-full">
      <Input
        type="date"
        value={date}
        aria-label="তারিখ বাছুন"
        onChange={(event) => {
          if (!event.target.value) return;
          onDateChange(event.target.value);
          setOpen(false);
        }}
        className="h-8 w-full bg-white pr-9 text-gray-800 [&::-webkit-calendar-picker-indicator]:opacity-0"
      />
      <button
        ref={toggleRef}
        type="button"
        data-testid="calendar-toggle"
        aria-label={open ? "ক্যালেন্ডার বন্ধ করুন" : "ক্যালেন্ডার খুলুন"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="header-calendar"
        onClick={toggle}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md bg-white text-gray-600 transition-colors hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-blue-500"
      >
        <CalendarDays className="h-4 w-4" />
      </button>
      <p className="mt-0.5 hidden truncate text-center text-xs text-blue-100 sm:block">
        {bengaliDateLabel(date)}
      </p>

      {open ? (
        <div
          ref={panelRef}
          id="header-calendar"
          data-testid="calendar-panel"
          role="dialog"
          aria-label="তারিখ বাছুন"
          className="absolute left-1/2 top-full z-50 mt-2 w-[288px] max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-gray-900 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              aria-label="আগের মাস"
              onClick={() => changeMonth(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-slate-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold">
              {MONTHS_BN[view.m - 1]} {toBnDigits(view.y)}
            </p>
            <button
              type="button"
              aria-label="পরের মাস"
              onClick={() => changeMonth(1)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-slate-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS_BN.map((weekday) => (
              <span
                key={weekday}
                className="py-1 text-[10px] font-medium text-gray-500"
              >
                {weekday}
              </span>
            ))}
            {cells.map((day, index) => {
              if (day === null) {
                return (
                  <span key={`blank-${index}`} aria-hidden="true" />
                );
              }
              const key = `${view.y}-${pad(view.m)}-${pad(day)}`;
              const isSelected = key === date;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  data-date={key}
                  aria-label={bengaliDateLabel(key)}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => pickDay(day)}
                  className={`h-8 rounded-md text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 ${
                    isSelected
                      ? "bg-blue-700 text-white hover:bg-blue-800"
                      : isToday
                        ? "bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-300 hover:bg-blue-100"
                        : "text-gray-700 hover:bg-slate-100"
                  }`}
                >
                  {toBnDigits(day)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
