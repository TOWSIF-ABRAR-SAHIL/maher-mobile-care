import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { TechStat } from "@/lib/types";

/**
 * Deterministic colour per technician name. The roster is dynamic now, so a
 * fixed name→class map would leave every new employee grey; hashing the name
 * keeps colours stable across reloads without hardcoding anyone.
 */
const PALETTE = [
  "text-blue-600",
  "text-green-600",
  "text-purple-600",
  "text-orange-600",
  "text-rose-600",
  "text-teal-600",
  "text-indigo-600",
  "text-amber-600",
];

function nameColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function TechnicianStats({
  stats,
  loading,
  selected,
  onSelect,
}: {
  stats: TechStat[];
  loading: boolean;
  /** Currently filtered technician name, or null for "everyone". */
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  return (
    <section
      data-testid="technician-stats"
      className="rounded-xl border bg-white p-3 shadow-md"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-gray-800">
          👤 টেকনিশিয়ান অনুযায়ী দৈনিক কাজের হিসাব
        </h2>
        <p className="text-xs text-gray-500">
          কার্ডে ক্লিক করে শুধু ওই টেকনিশিয়ানের কাজ দেখুন
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        {loading
          ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)
          : stats.map((t) => {
              const isSelected = selected === t.technician;
              return (
                <button
                  key={t.technician}
                  type="button"
                  data-testid="tech-card"
                  data-technician={t.technician}
                  data-active={t.isActive ? "true" : "false"}
                  aria-pressed={isSelected}
                  onClick={() =>
                    onSelect(isSelected ? null : t.technician)
                  }
                  title={
                    isSelected
                      ? `${t.technician} — ফিল্টার সরাতে ক্লিক করুন`
                      : `${t.technician}-এর কাজ দেখুন`
                  }
                  className={cn(
                    "rounded-xl border bg-gray-50 p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                    // A technician who left the shop stays visible (greyed) when
                    // they still have work on this date, so the day's totals add up.
                    !t.isActive && "border-dashed bg-gray-100 opacity-70",
                    isSelected && "ring-2 ring-blue-500 bg-blue-50"
                  )}
                >
                  <p
                    className={cn(
                      "flex items-center gap-1 font-bold",
                      t.isActive ? nameColor(t.technician) : "text-gray-500"
                    )}
                  >
                    {t.technician}
                    {!t.isActive ? (
                      <span className="rounded bg-gray-200 px-1 py-0.5 text-[10px] font-medium text-gray-600">
                        নিষ্ক্রিয়
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="text-[11px] font-semibold text-blue-700">
                        ✓ নির্বাচিত
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-gray-700">
                    কাজ করেছে:{" "}
                    <span className="font-semibold">{t.count} টি</span>
                  </p>
                  <p className="text-sm text-gray-700">
                    মোট বিল:{" "}
                    <span className="font-semibold">{formatTaka(t.bill)}</span>
                  </p>
                </button>
              );
            })}
      </div>
    </section>
  );
}
