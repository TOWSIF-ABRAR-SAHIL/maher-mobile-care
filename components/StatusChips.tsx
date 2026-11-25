"use client";

import { STATUS_BN, STATUSES, type ServiceStatus } from "@/lib/utils";

/** `Due` is a virtual chip: it filters by outstanding money, not by status.
 *  Mirrors /api/services/dues (`due > 0`, never a Returned row). */
export type StatusFilter = "All" | ServiceStatus | "Due";

/**
 * The one status chip row, shared by the service list and the dues dialog so
 * both stay pixel-identical: rounded pills, colored dot, Bengali label and a
 * live count, navy fill for the pressed chip. Counts are visit-level — a visit
 * counts once for a status as soon as any of its devices is in that status.
 *
 * The markup is copied verbatim from the original service-list block (the
 * `div.mb-3` wrapper and `svc-status-tabs` testid are pinned by tests), so
 * swapping it in changes no DOM the contracts see. `Due` is appended last so
 * the first six chips keep their pinned positions; the dues dialog opts out
 * because every row it shows is already unpaid.
 */
export function StatusChips({
  counts,
  value,
  onChange,
  testid,
  label = "অবস্থা দিয়ে ফিল্টার",
  includeDue = true,
}: {
  /** Keyed by status, plus `All` and optionally `Due`; missing keys render 0. */
  counts: Record<string, number>;
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
  /** `svc-status-tabs` (list) or `dues-status-tabs` (dues dialog). */
  testid: string;
  label?: string;
  /** The dues dialog passes false — its rows are all due by definition. */
  includeDue?: boolean;
}) {
  const chips: StatusFilter[] = includeDue
    ? ["All", ...STATUSES, "Due"]
    : ["All", ...STATUSES];
  return (
    <div className="relative mb-3">
      <div
        data-testid={testid}
        role="group"
        aria-label={label}
        className="-mx-1 overflow-x-auto px-1 print:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max min-w-full items-center gap-1.5">
          {chips.map((st) => {
            const active = value === st;
            const dot =
              st === "All"
                ? "bg-maher-ink"
                : st === "Pending" || st === "Due"
                  ? "bg-maher-due"
                  : st === "In-Progress"
                    ? "bg-maher-navy"
                    : st === "Completed"
                      ? "bg-maher-done"
                      : st === "Delivered"
                        ? "bg-slate-400"
                        : "bg-maher-money";
            return (
              <button
                key={st}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(st)}
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10 ${
                  active
                    ? "border-maher-navy bg-maher-navy text-white"
                    : "border-slate-200/80 bg-white text-slate-700 hover:border-slate-400 hover:text-slate-900"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    active ? "bg-white/80" : dot
                  }`}
                />
                <span>
                  {st === "All"
                    ? "সব"
                    : st === "Due"
                      ? "বাকি"
                      : STATUS_BN[st]}
                </span>
                {" "}
                <span
                  className={`tabular-nums rounded-full px-1.5 py-0.5 text-[11px] leading-none ${
                    active ? "bg-white/15 text-white/90" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  ({counts[st] ?? 0})
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
      />
    </div>
  );
}
