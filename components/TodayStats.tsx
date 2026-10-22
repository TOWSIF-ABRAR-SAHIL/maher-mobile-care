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
    <div className={`rounded-xl border border-l-4 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${border}`}>
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`mt-1 text-xl font-extrabold tracking-tight tabular-nums ${valueClass ?? "text-gray-900"}`}>
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
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
        className="grid grid-cols-2 gap-2 lg:grid-cols-4"
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

  return (
    <div
      data-testid="today-stats"
      className="grid grid-cols-2 gap-2 lg:grid-cols-4"
    >
      <DayCard
        border="border-l-blue-500"
        label={`${prefix} মোট কাজ`}
        value={`${stats.count} টি`}
        hint={
          stats.returnedCount > 0
            ? `+ ${stats.returnedCount}টি ফেরত`
            : undefined
        }
      />
      <DayCard
        border="border-l-green-500"
        label={`${prefix} মোট বিল`}
        value={formatTaka(stats.bill)}
        valueClass="text-green-600"
        hint={billHint}
      />
      <DayCard
        border="border-l-red-500"
        label={`${prefix} মোট বাকি`}
        value={formatTaka(stats.due)}
        valueClass="text-red-600"
      />
      <DayCard
        border="border-l-orange-500"
        label={`${prefix} মোট খরচ`}
        value={formatTaka(stats.expense + stats.damageLoss)}
        valueClass="text-orange-600"
        hint={expenseHint || undefined}
      />
    </div>
  );
}
