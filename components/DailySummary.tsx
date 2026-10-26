"use client";

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { TechnicianStats } from "@/components/TechnicianStats";
import { TodayStats } from "@/components/TodayStats";
import { cn, formatTaka } from "@/lib/utils";
import type { StatsResponse } from "@/lib/types";

/**
 * One compact bar for everything that summarises the selected day: the
 * technician breakdown and the day totals. Collapsed by default so the form and
 * the service table stay above the fold; the bar itself already shows the four
 * headline numbers, so a glance never needs a click.
 */
export function DailySummary({
  stats,
  loading,
  selected,
  onSelect,
  date,
  today,
}: {
  stats: StatsResponse | null;
  loading: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
  date: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const day = stats?.today ?? null;
  const totalExpense = day ? day.expense + day.damageLoss : 0;

  return (
    <section data-testid="daily-summary" className="print:hidden">
      <button
        type="button"
        data-testid="toggle-daily-summary"
        aria-expanded={open}
        aria-controls="daily-summary-body"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-maher-border bg-card px-3 py-2 text-left transition hover:border-maher-navy/30 hover:bg-maher-surface/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-maher-navy"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-semibold text-maher-navy">
            আজকের হিসাব
          </span>
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">
            টেকনিশিয়ান অনুযায়ী দৈনিক কাজের হিসাব
          </span>
        </span>

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
          <Metric
            label="কাজ"
            value={day ? `${day.count} টি` : "…"}
            tone="text-maher-navy"
          />
          <Metric
            label="বিল"
            value={day ? formatTaka(day.bill) : "…"}
            tone={day && day.bill > 0 ? "text-maher-done" : "text-muted-foreground"}
          />
          <Metric
            label="বাকি"
            value={day ? formatTaka(day.due) : "…"}
            tone={day && day.due > 0 ? "text-maher-due" : "text-muted-foreground"}
          />
          <Metric
            label="খরচ"
            value={day ? formatTaka(totalExpense) : "…"}
            tone={
              totalExpense > 0 ? "text-maher-money" : "text-muted-foreground"
            }
          />
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180"
            )}
          />
        </span>
      </button>

      {/* Collapsed with max-height instead of `hidden` so the panels keep
          their layout hooks (the day totals stay in the DOM for reading and
          printing tests) while taking no visual space. */}
      <div
        id="daily-summary-body"
        aria-hidden={!open}
        className={cn(
          "space-y-2 overflow-hidden transition-[max-height,opacity] duration-200 motion-reduce:transition-none",
          open ? "mt-2 max-h-[2400px] opacity-100" : "max-h-0 opacity-0"
        )}
      >
        <TechnicianStats
          stats={stats?.techStats ?? []}
          loading={loading}
          selected={selected}
          onSelect={onSelect}
        />
        <TodayStats
          stats={stats?.today ?? null}
          loading={loading}
          date={date}
          today={today}
        />
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <span className="whitespace-nowrap text-muted-foreground">
      {label} <span className={cn("font-semibold", tone)}>{value}</span>
    </span>
  );
}
