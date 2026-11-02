"use client";

import { STATUS_BN, STATUSES, type ServiceStatus } from "@/lib/utils";

export type StatusFilter = "All" | ServiceStatus;

/**
 * The one status chip row, shared by the service list and the dues dialog so
 * both stay pixel-identical: rounded pills, colored dot, Bengali label and a
 * live count, navy fill for the pressed chip. Counts are visit-level — a visit
 * counts once for a status as soon as any of its devices is in that status.
 *
 * The markup is copied verbatim from the original service-list block (the
 * `div.mb-3` wrapper and `svc-status-tabs` testid are pinned by tests), so
 * swapping it in changes no DOM the contracts see.
 */
export function StatusChips({
  counts,
  value,
  onChange,
  testid,
  label = "অবস্থা দিয়ে ফিল্টার",
}: {
  /** Keyed by status, plus `All`; missing keys render as 0. */
  counts: Record<string, number>;
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
  /** `svc-status-tabs` (list) or `dues-status-tabs` (dues dialog). */
  testid: string;
  label?: string;
}) {
  return (
    <div className="relative mb-3">
      <div
        data-testid={testid}
        role="group"
        aria-label={label}
        className="-mx-1 overflow-x-auto px-1 print:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex w-max min-w-full items-center gap-1.5">
          {(["All", ...STATUSES] as const).map((st) => {
            const active = value === st;
            const dot =
              st === "All"
                ? "bg-maher-ink"
                : st === "Pending"
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
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                  active
                    ? "border-maher-navy bg-maher-navy text-white shadow-sm"
                    : "border-maher-border bg-white text-foreground hover:border-maher-navy/40 hover:bg-maher-surface/60 hover:text-maher-navy"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-white/80" : dot
                  }`}
                />
                <span>{st === "All" ? "সব" : STATUS_BN[st]}</span>
                {" "}
                <span
                  className={`tabular-nums ${
                    active ? "text-white/75" : "text-muted-foreground"
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
