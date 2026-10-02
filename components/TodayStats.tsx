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
    <div className={`rounded-xl border border-l-4 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${border}`}>
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
}: {
  stats: DayStats | null;
  loading: boolean;
}) {
  if (loading || !stats) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <DayCard
        border="border-l-blue-500"
        label="আজকের মোট কাজ"
        value={`${stats.count} টি`}
      />
      <DayCard
        border="border-l-green-500"
        label="আজকের মোট বিল"
        value={formatTaka(stats.bill)}
        valueClass="text-green-600"
      />
      <DayCard
        border="border-l-red-500"
        label="আজকের মোট বাকি"
        value={formatTaka(stats.due)}
        valueClass="text-red-600"
      />
      <DayCard
        border="border-l-orange-500"
        label="আজকের মোট খরচ"
        value={formatTaka(stats.expense)}
        valueClass="text-orange-600"
        hint={stats.codeCount > 0 ? `+ ${stats.codeCount}টি কোড` : undefined}
      />
    </div>
  );
}
