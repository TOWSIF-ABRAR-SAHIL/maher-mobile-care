import { BarChart3, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { dayLabel } from "@/lib/dhaka";
import { formatTaka } from "@/lib/utils";
import type { MonthlySummary, RangeMode } from "@/lib/types";

const PRESETS: { mode: RangeMode; label: string }[] = [
  { mode: "rolling30", label: "বিগত ৩০ দিন" },
  { mode: "thisMonth", label: "এই মাস" },
  { mode: "lastMonth", label: "গত মাস" },
];

/** Card label prefix follows the active window mode. */
function unitLabel(mode: RangeMode, kind: string): string {
  if (mode === "thisMonth" || mode === "lastMonth") return `মাসে মোট ${kind}`;
  if (mode === "custom") return `মোট ${kind}`;
  return `৩০ দিনে মোট ${kind}`;
}

export function MonthlySummary({
  summary,
  range,
  mode,
  onPreset,
  onCustom,
  loading,
}: {
  summary: MonthlySummary | null;
  range: { from: string; to: string };
  mode: RangeMode;
  onPreset: (mode: RangeMode) => void;
  onCustom: (from: string, to: string) => void;
  loading: boolean;
}) {
  return (
    <section className="rounded-xl border border-maher-border bg-card p-3 shadow-card sheen sm:p-4 print:bg-white print:text-black">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground sm:text-base print:text-black">
        <BarChart3 className="h-4 w-4 text-maher-navy print:text-gray-600" />
        ওভারঅল রিপোর্ট (Monthly Summary)
      </h2>
      <p className="mb-3 text-xs text-muted-foreground print:text-gray-600">
        {dayLabel(range.from)} – {dayLabel(range.to)}
      </p>
      <div className="mb-3 flex flex-col gap-2 print:hidden sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.mode}
              onClick={() => onPreset(p.mode)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                mode === p.mode
                  ? "border-maher-navy bg-maher-navy text-white"
                  : "border-maher-border bg-white text-muted-foreground hover:border-maher-navy/40 hover:bg-maher-blue-soft/50 hover:text-maher-navy"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <Input
            type="date"
            value={range.from}
            onChange={(e) => {
              if (e.target.value) onCustom(e.target.value, range.to);
            }}
            className="h-8 w-full min-w-0 border-input bg-white text-xs text-foreground sm:w-auto"
          />
          <span className="hidden sm:inline">–</span>
          <Input
            type="date"
            value={range.to}
            onChange={(e) => {
              if (e.target.value) onCustom(range.from, e.target.value);
            }}
            className="h-8 w-full min-w-0 border-input bg-white text-xs text-foreground sm:w-auto"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading || !summary ? (
          [0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))
        ) : (
          <>
            <div className="rounded-lg border border-maher-border bg-maher-surface/60 p-3 text-center print:border-gray-300 print:bg-white">
              <p className="text-sm text-muted-foreground print:text-gray-600">{unitLabel(mode, "কাজ")}</p>
              <p className={`mt-1 text-xl font-bold ${
                summary.count > 0
                  ? "text-maher-navy print:text-blue-700"
                  : "text-muted-foreground print:text-gray-500"
              }`}>
                {summary.count} টি
              </p>
              {summary.returnedCount > 0 ? (
                <p className="mt-0.5 text-xs text-maher-money print:text-amber-700">
                  + {summary.returnedCount}টি ফেরত
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-maher-border bg-maher-surface/60 p-3 text-center print:border-gray-300 print:bg-white">
              <p className="text-sm text-muted-foreground print:text-gray-600">{unitLabel(mode, "বিল")}</p>
              <p className={`mt-1 text-xl font-bold ${
                summary.bill > 0
                  ? "text-maher-done print:text-green-700"
                  : "text-muted-foreground print:text-gray-500"
              }`}>
                {formatTaka(summary.bill)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground print:text-gray-600">
                জমা {formatTaka(summary.advance)}
                {summary.refund > 0
                  ? ` • ফেরত ${formatTaka(summary.refund)}`
                  : ""}
              </p>
            </div>
            <div className="rounded-lg border border-maher-border bg-maher-surface/60 p-3 text-center print:border-gray-300 print:bg-white">
              <p className="text-sm text-muted-foreground print:text-gray-600">{unitLabel(mode, "খরচ")}</p>
              <p className={`mt-1 text-xl font-bold ${
                summary.expense + summary.damageLoss > 0
                  ? "text-maher-money print:text-orange-700"
                  : "text-muted-foreground print:text-gray-500"
              }`}>
                {formatTaka(summary.expense + summary.damageLoss)}
              </p>
              {summary.damageLoss > 0 ? (
                <p className="mt-0.5 text-xs text-maher-money print:text-orange-700">
                  এর মধ্যে ক্ষতি {formatTaka(summary.damageLoss)}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border border-maher-border bg-maher-surface/60 p-3 text-center print:border-gray-300 print:bg-white">
              <p className="text-sm text-muted-foreground print:text-gray-600">{unitLabel(mode, "বাকি")}</p>
              <p className={`mt-1 text-xl font-bold ${
                summary.due > 0
                  ? "text-maher-due-ink print:text-red-700"
                  : "text-muted-foreground print:text-gray-500"
              }`}>
                {formatTaka(summary.due)}
              </p>
            </div>
            <div className="rounded-lg border border-maher-border bg-maher-surface/60 p-3 text-center print:border-gray-300 print:bg-white">
              <p className="text-sm text-muted-foreground print:text-gray-600">{unitLabel(mode, "লাভ (Profit)")}</p>
              <p className={`mt-1 text-xl font-bold ${
                summary.profit > 0
                  ? "text-maher-done print:text-green-700"
                  : summary.profit < 0
                    ? "text-maher-due-ink print:text-red-700"
                    : "text-muted-foreground print:text-gray-500"
              }`}>
                {formatTaka(summary.profit)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground print:text-gray-600">
                বিল − খরচ − ক্ষতি
              </p>
            </div>
          </>
        )}
      </div>
      {summary && summary.refund > 0 ? (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-maher-money print:text-amber-800">
          <RotateCcw className="h-3.5 w-3.5 shrink-0" />
          <span>
            ফেরত {formatTaka(summary.refund)} ({summary.returnedCount}টি কাজ,
            কাজের তারিখ অনুযায়ী) — বিল থেকে বাদ, তাই লাভ থেকে আলাদা বাদ হয়নি।
          </span>
        </p>
      ) : null}
    </section>
  );
}
