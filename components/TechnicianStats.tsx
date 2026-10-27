import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { TechStat } from "@/lib/types";

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
      className="rounded-xl border border-maher-border bg-card p-3 shadow-card sm:p-4"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
          <Users className="h-4 w-4 text-muted-foreground" />
          টেকনিশিয়ান অনুযায়ী দৈনিক কাজের হিসাব
        </h2>
        <p className="text-xs text-muted-foreground">
          কার্ডে ক্লিক করে শুধু ওই টেকনিশিয়ানের কাজ দেখুন
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
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
                    "rounded-xl border border-maher-border p-2.5 text-left transition hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:transform-none focus:outline-none focus-visible:ring-2 focus-visible:ring-maher-navy",
                    // A technician who left the shop stays visible (greyed) when
                    // they still have work on this date, so the day's totals add up.
                    !t.isActive && "border-dashed bg-maher-surface/40 opacity-70",
                    t.isActive && "bg-maher-surface/40 hover:bg-white hover:border-maher-navy/30",
                    isSelected && "ring-2 ring-maher-navy bg-maher-navy/5"
                  )}
                >
                  <p
                    className={cn(
                      "flex flex-wrap items-center gap-1 break-words font-bold",
                      // Colour here encodes employment state, not identity:
                      // every active technician reads the same.
                      t.isActive ? "text-maher-navy" : "text-muted-foreground"
                    )}
                  >
                    {t.technician}
                    {!t.isActive ? (
                      <span className="rounded bg-maher-border px-1 py-0.5 text-xs font-medium text-muted-foreground">
                        নিষ্ক্রিয়
                      </span>
                    ) : null}
                    {isSelected ? (
                      <span className="text-xs font-semibold text-maher-navy">
                        ✓ নির্বাচিত
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    কাজ করেছে:{" "}
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        t.count > 0 ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {t.count} টি
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    মোট বিল:{" "}
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        t.bill > 0 ? "text-maher-done" : "text-muted-foreground"
                      )}
                    >
                      {formatTaka(t.bill)}
                    </span>
                  </p>
                </button>
              );
            })}
      </div>
    </section>
  );
}
