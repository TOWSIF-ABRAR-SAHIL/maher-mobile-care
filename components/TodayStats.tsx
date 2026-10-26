import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/utils";
import type { DayStats } from "@/lib/types";

function DayCard({
  border,
  label,
  value,
  hint,
  valueClass,
}: {
  border: string;
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
}) {
  return (
    <div className={`rounded-xl border border-maher-border border-l-4 bg-card p-2.5 ${border}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tracking-tight tabular-nums ${valueClass ?? "text-foreground"}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TodayStats({
  stats,
  loading,
  date,
  today,
}: {
  stats: DayStats | null;
  loading: boolean;
  /** Selected YYYY-MM-DD day whose totals are shown. */
  date: string;
  /** Current YYYY-MM-DD day in Dhaka time. */
  today: string;
}) {
  const prefix = date === today ? "আজকের" : "নির্বাচিত দিনের";
  if (loading || !stats) {
    return (
      <div
        data-testid="today-stats"
        className="grid grid-cols-2 gap-2 md:grid-cols-4"
      >
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  const expenseHint = [
    stats.damageLoss > 0
      ? `এর মধ্যে ক্ষতি ${formatTaka(stats.damageLoss)}`
      : null,
    stats.codeCount > 0 ? `+ ${stats.codeCount}টি কোড` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const billHint = [
    `জমা ${formatTaka(stats.advance)}`,
    stats.refund > 0 ? `ফেরত ${formatTaka(stats.refund)}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const totalExpense = stats.expense + stats.damageLoss;

  return (
    <div
      data-testid="today-stats"
      className="grid grid-cols-2 gap-2 md:grid-cols-4"
    >
      <DayCard
        border={stats.count > 0 ? "border-l-maher-navy" : "border-l-maher-border"}
        label={`${prefix} মোট কাজ`}
        value={`${stats.count} টি`}
        valueClass={stats.count > 0 ? "text-maher-navy" : "text-foreground"}
        hint={
          stats.returnedCount > 0
            ? `+ ${stats.returnedCount}টি ফেরত`
            : undefined
        }
      />
      <DayCard
        border={stats.bill > 0 ? "border-l-maher-done" : "border-l-maher-border"}
        label={`${prefix} মোট বিল`}
        value={formatTaka(stats.bill)}
        valueClass={stats.bill > 0 ? "text-maher-done" : "text-foreground"}
        hint={billHint}
      />
      <DayCard
        border={stats.due > 0 ? "border-l-maher-due" : "border-l-maher-border"}
        label={`${prefix} মোট বাকি`}
        value={formatTaka(stats.due)}
        valueClass={stats.due > 0 ? "text-maher-due" : "text-foreground"}
      />
      <DayCard
        border={totalExpense > 0 ? "border-l-maher-money" : "border-l-maher-border"}
        label={`${prefix} মোট খরচ`}
        value={formatTaka(totalExpense)}
        valueClass={totalExpense > 0 ? "text-maher-money" : "text-foreground"}
        hint={expenseHint || undefined}
      />
    </div>
  );
}
