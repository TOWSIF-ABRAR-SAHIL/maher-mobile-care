import { Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatTaka, toBnDigits } from "@/lib/utils";
import type { DayStats } from "@/lib/types";

function Metric({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  value: string;
  hint: string;
  tone: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 bg-white px-4 py-3", className)}>
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-1 truncate text-[22px] font-bold leading-none tracking-tight tabular-nums sm:text-[24px]",
          tone
        )}
      >
        {value}
      </dd>
      <dd className="mt-1 truncate text-[10px] leading-snug text-muted-foreground">
        {hint}
      </dd>
    </div>
  );
}

/**
 * Today-only money summary. Every figure is the existing day-stats value:
 * bill/advance/due already exclude Returned rows, and profit repeats the
 * monthly report formula (bill − expense − damageLoss). Refunds are a memo and
 * are deliberately not netted into profit, exactly like the reports.
 */
export function FinanceSummary({
  stats,
  loading,
}: {
  stats: DayStats | null;
  loading: boolean;
}) {
  const expense = stats ? stats.expense + stats.damageLoss : 0;
  const profit = stats ? stats.bill - expense : 0;

  return (
    <section
      data-testid="home-money-band"
      aria-labelledby="home-money-title"
      className="overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-maher-border px-4 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-maher-navy" />
            <h2
              id="home-money-title"
              className="text-[13px] font-semibold tracking-tight text-maher-ink"
            >
              আজকের হিসাব
            </h2>
          </span>
          <span className="text-[11px] text-muted-foreground">
            {stats ? `শুধু আজকের কাজ · ${toBnDigits(stats.count)}টি` : "…"}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          বিল − খরচ − ক্ষতি = নিট লাভ
        </span>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-2 gap-px bg-maher-border sm:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="bg-white px-4 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-6 w-24" />
              <Skeleton className="mt-2 h-2.5 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px bg-maher-border sm:grid-cols-3 xl:grid-cols-5">
            <Metric
              label="মোট বিল"
              value={formatTaka(stats.bill)}
              hint="আজকের কাজের বিল"
              tone={
                stats.bill > 0 ? "text-maher-navy" : "text-muted-foreground"
              }
            />
            <Metric
              label="মোট জমা"
              value={formatTaka(stats.advance)}
              hint="এই কাজগুলোর বিপরীতে আদায়"
              tone={
                stats.advance > 0
                  ? "text-maher-done"
                  : "text-muted-foreground"
              }
            />
            <Metric
              label="মোট বাকি"
              value={formatTaka(stats.due)}
              hint={stats.due > 0 ? "এই কাজগুলোতে বাকি" : "সব পরিশোধিত"}
              tone={stats.due > 0 ? "text-maher-due" : "text-muted-foreground"}
            />
            <Metric
              label="খরচ + ক্ষতি"
              value={formatTaka(expense)}
              hint={
                stats.damageLoss > 0
                  ? `এর মধ্যে ক্ষতি ${formatTaka(stats.damageLoss)}`
                  : "পার্টস ও দোকান খরচ"
              }
              tone={
                expense > 0 ? "text-maher-money" : "text-muted-foreground"
              }
            />
            <Metric
              label="নিট লাভ"
              value={formatTaka(profit)}
              hint="বিল − খরচ − ক্ষতি"
              tone={
                profit > 0
                  ? "text-maher-done"
                  : profit < 0
                    ? "text-maher-due"
                    : "text-muted-foreground"
              }
              className="col-span-2 bg-maher-blue-soft/20 sm:col-span-1"
            />
          </dl>

          {stats.refund > 0 || stats.returnedCount > 0 ? (
            <p className="border-t border-maher-border px-4 py-2 text-[11px] leading-snug text-muted-foreground">
              {stats.returnedCount > 0
                ? `ফেরত ${toBnDigits(stats.returnedCount)}টি কাজ`
                : "ফেরত"}
              {stats.refund > 0
                ? ` · রিফান্ড ${formatTaka(stats.refund)}`
                : ""}{" "}
              — ফেরত/রিফান্ড লাভের হিসাবে যোগ করা হয় না।
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
