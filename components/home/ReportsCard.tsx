import { ArrowRight, BarChart3 } from "lucide-react";
import { dayLabel } from "@/lib/dhaka";
import { cn, formatTaka } from "@/lib/utils";
import type { MonthlySummary, RangeMode } from "@/lib/types";

const PERIOD_LABEL: Record<RangeMode, string> = {
  rolling30: "শেষ ৩০ দিন",
  thisMonth: "এই মাস",
  lastMonth: "গত মাস",
  custom: "কাস্টম সময়",
};

/** The same rolling-30-day report the desk already uses, kept compact here. */
export function ReportsCard({
  report,
  range,
  mode,
  loading,
  onOpen,
}: {
  report: MonthlySummary | null;
  range: { from: string; to: string };
  mode: RangeMode;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <section
      data-testid="home-report"
      aria-labelledby="home-report-title"
      className="flex h-full flex-col overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex items-start justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-maher-navy" />
          <div>
            <h2
              id="home-report-title"
              className="text-[13px] font-semibold tracking-tight text-maher-ink"
            >
              রিপোর্ট
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {PERIOD_LABEL[mode]}
            </p>
          </div>
        </div>
        <span className="shrink-0 text-right text-[10px] text-muted-foreground">
          {dayLabel(range.from)} – {dayLabel(range.to)}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <dl className="grid grid-cols-3 divide-x divide-maher-border">
          <div className="pr-3">
            <dt className="text-[10px] font-medium text-muted-foreground">
              বিল
            </dt>
            <dd className="mt-1 truncate text-[18px] font-bold leading-none tabular-nums text-maher-navy">
              {report ? formatTaka(report.bill) : loading ? "…" : "—"}
            </dd>
          </div>
          <div className="px-3">
            <dt className="text-[10px] font-medium text-muted-foreground">
              লাভ
            </dt>
            <dd
              className={cn(
                "mt-1 truncate text-[18px] font-bold leading-none tabular-nums",
                report && report.profit > 0
                  ? "text-maher-done"
                  : report && report.profit < 0
                    ? "text-maher-due"
                    : "text-muted-foreground"
              )}
            >
              {report ? formatTaka(report.profit) : loading ? "…" : "—"}
            </dd>
          </div>
          <div className="pl-3">
            <dt className="text-[10px] font-medium text-muted-foreground">
              বাকি
            </dt>
            <dd className="mt-1 truncate text-[18px] font-bold leading-none tabular-nums text-maher-due">
              {report ? formatTaka(report.due) : loading ? "…" : "—"}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          data-testid="open-report"
          onClick={onOpen}
          className="mt-4 inline-flex items-center justify-between border-t border-maher-border pt-2.5 text-[11px] font-semibold text-maher-navy transition-colors hover:text-maher-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
        >
          পূর্ণ রিপোর্ট
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </section>
  );
}
