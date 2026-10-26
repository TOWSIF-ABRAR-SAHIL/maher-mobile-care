import Link from "next/link";
import { AlarmClock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { dayLabel } from "@/lib/dhaka";
import {
  FLOW_STATUSES,
  STATUS_BN,
  cn,
  toBnDigits,
  type ServiceStatus,
} from "@/lib/utils";
import type { OverdueResponse, ServiceDTO, StatsResponse } from "@/lib/types";

const TONE: Record<
  (typeof FLOW_STATUSES)[number],
  { text: string; dot: string }
> = {
  Pending: { text: "text-maher-due", dot: "bg-maher-due" },
  "In-Progress": { text: "text-maher-navy", dot: "bg-maher-navy" },
  Completed: { text: "text-maher-done", dot: "bg-maher-done" },
  Delivered: { text: "text-maher-ink", dot: "bg-maher-border" },
};

/**
 * One compact row that answers "where is today's work?" before the table.
 * Stage counts are device rows from the selected day (Returned excluded), so
 * they always add up to the day total. Overdue is a separate cross-date
 * backlog and is labelled as such; it is not a fifth stage.
 */
export function ServiceStageLine({
  services,
  stats,
  date,
  overdue,
  overdueLoading,
  overdueError,
  loading,
  activeStatus,
  onRetryOverdue,
}: {
  services: ServiceDTO[];
  stats: StatsResponse | null;
  date: string;
  overdue: OverdueResponse | null;
  overdueLoading: boolean;
  overdueError: boolean;
  loading: boolean;
  activeStatus: "All" | ServiceStatus;
  onRetryOverdue: () => void;
}) {
  const counts: Record<ServiceStatus, number> = {
    Pending: 0,
    "In-Progress": 0,
    Completed: 0,
    Delivered: 0,
    Returned: 0,
  };
  const active = services.filter((service) => service.status !== "Returned");
  for (const service of active) {
    const status = service.status as ServiceStatus;
    if (status in counts) counts[status] += 1;
  }
  const total = FLOW_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const visits = new Set(
    active.map((service) =>
      service.groupId ? `g:${service.groupId}` : `r:${service.id}`
    )
  ).size;
  const returned = stats?.today.returnedCount ?? 0;
  const overdueCount = overdue?.count ?? 0;

  const overdueTitle = overdueError
    ? "ওভারডিউ তথ্য আনা যায়নি — আবার চেষ্টা করুন"
    : overdueLoading || !overdue
      ? "ওভারডিউ তথ্য আসছে"
      : overdue.count === 0
        ? "সব তারিখের মধ্যে কোনো বিলম্ব নেই"
        : overdue.oldestDeliveryDate
          ? `সব তারিখের মধ্যে ডেলিভারি তারিখ পেরিয়েছে · সর্বপ্রাচীন ${dayLabel(
              overdue.oldestDeliveryDate
            )}`
          : "সব তারিখের মধ্যে ডেলিভারি তারিখ পেরিয়েছে";

  return (
    <section
      data-testid="service-stage-line"
      aria-label="আজকের সার্ভিস ধাপের সারসংক্ষেপ"
      title={overdueTitle}
      className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-xl border border-maher-border bg-white px-3 py-2 text-[11px] print:hidden"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-maher-ink">
        <span
          aria-hidden
          className="h-3.5 w-[3px] rounded-full bg-maher-blue"
        />
        আজকের ধাপ
      </span>

      {loading ? (
        <>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </>
      ) : (
        <>
          <span
            data-testid="stage-total"
            className="text-muted-foreground"
          >
            মোট{" "}
            <strong className="font-bold tabular-nums text-maher-ink">
              {toBnDigits(total)}
            </strong>{" "}
            · {toBnDigits(visits)} ভিজিট
          </span>

          <span aria-hidden className="h-4 w-px bg-maher-border" />

          <ul className="flex flex-wrap items-center gap-0.5">
            {FLOW_STATUSES.map((status) => {
              const tone = TONE[status];
              const selected = activeStatus === status;
              return (
                <li key={status}>
                  <Link
                    href={`/service?date=${date}&status=${encodeURIComponent(
                      status
                    )}`}
                    data-testid={`stage-${status.toLowerCase()}`}
                    aria-current={selected ? "page" : undefined}
                    title={`${STATUS_BN[status]} সার্ভিস দেখুন`}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60",
                      selected
                        ? "border-maher-border bg-maher-surface"
                        : "border-transparent hover:bg-maher-surface/60"
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        counts[status] > 0 ? tone.dot : "bg-maher-border"
                      )}
                    />
                    <span className="font-semibold text-muted-foreground">
                      {STATUS_BN[status]}
                    </span>
                    <strong
                      className={cn(
                        "font-bold tabular-nums",
                        counts[status] > 0
                          ? tone.text
                          : "text-muted-foreground"
                      )}
                    >
                      {toBnDigits(counts[status])}
                    </strong>
                  </Link>
                </li>
              );
            })}
          </ul>

          {returned > 0 ? (
            <span
              data-testid="stage-returned"
              className="rounded-full border border-maher-money/30 bg-maher-money/10 px-2 py-0.5 text-[10px] font-semibold text-maher-money"
              title="ফেরত কাজ আজকের মোট সার্ভিসে ধরা হয়নি"
            >
              ফেরত {toBnDigits(returned)}টি
            </span>
          ) : null}

          <span className="ml-auto inline-flex items-center gap-1.5">
            <AlarmClock
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                overdueCount > 0 ? "text-maher-due" : "text-muted-foreground/60"
              )}
            />
            <span className="font-semibold text-muted-foreground">
              ওভারডিউ
            </span>
            {overdueLoading ? (
              <span
                data-testid="stage-overdue"
                aria-busy="true"
                className="font-bold tabular-nums text-muted-foreground"
              >
                …
              </span>
            ) : overdueError ? (
              <button
                type="button"
                data-testid="stage-overdue"
                onClick={onRetryOverdue}
                title="ওভারডিউ আবার লোড করুন"
                className="font-semibold text-maher-due underline-offset-2 hover:underline"
              >
                পাওয়া যায়নি · আবার
              </button>
            ) : (
              <span
                data-testid="stage-overdue"
                title={overdueTitle}
                className={cn(
                  "font-bold tabular-nums",
                  overdueCount > 0
                    ? "text-maher-due"
                    : "text-muted-foreground"
                )}
              >
                {toBnDigits(overdueCount)}
              </span>
            )}
          </span>
        </>
      )}
    </section>
  );
}
