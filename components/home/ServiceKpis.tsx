import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  CircleCheckBig,
  ClipboardList,
  Clock,
  PackageCheck,
  Wrench,
} from "lucide-react";
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

const FLOW_HINT: Record<(typeof FLOW_STATUSES)[number], string> = {
  Pending: "কাস্টমার অপেক্ষা",
  "In-Progress": "বেঞ্চে চলছে",
  Completed: "হস্তান্তরের প্রস্তুতি",
  Delivered: "কাস্টমারকে দেওয়া",
};

const FLOW_TONE: Record<
  (typeof FLOW_STATUSES)[number],
  { text: string; dot: string; bar: string }
> = {
  Pending: {
    text: "text-maher-due",
    dot: "bg-maher-due",
    bar: "bg-maher-due",
  },
  "In-Progress": {
    text: "text-maher-navy",
    dot: "bg-maher-navy",
    bar: "bg-maher-navy",
  },
  Completed: {
    text: "text-maher-done",
    dot: "bg-maher-done",
    bar: "bg-maher-done",
  },
  Delivered: {
    text: "text-maher-ink",
    dot: "bg-maher-border",
    bar: "bg-maher-border",
  },
};

const FLOW_ICON = {
  Pending: Clock,
  "In-Progress": Wrench,
  Completed: CircleCheckBig,
  Delivered: PackageCheck,
} as const;

function visitKey(service: ServiceDTO): string {
  return service.groupId ? `g:${service.groupId}` : `r:${service.id}`;
}

/**
 * Today's work as one ledger sheet rather than six competing cards. The four
 * workflow stages are a real sequence, so they read left to right with a thin
 * share rail beneath. Each stage still counts service rows (one repair per
 * device), which is why the four stages add up to the total. A multi-device
 * visit is summarised separately as "visits" instead of inflating the job
 * total. Overdue is cross-date and deliberately not a link: no all-date
 * filtered Service view exists yet.
 *
 * Phones show the two headline numbers (total, overdue) side by side and give
 * the full width to the workflow rail underneath, so the all-date dues card
 * stays close to the top of the page.
 */
export function ServiceKpis({
  services,
  stats,
  date,
  overdue,
  loading,
}: {
  services: ServiceDTO[];
  stats: StatsResponse | null;
  date: string;
  overdue: OverdueResponse | null;
  loading: boolean;
}) {
  const active = services.filter((service) => service.status !== "Returned");
  const counts: Record<ServiceStatus, number> = {
    Pending: 0,
    "In-Progress": 0,
    Completed: 0,
    Delivered: 0,
    Returned: 0,
  };
  for (const service of active) {
    const status = service.status as ServiceStatus;
    if (status in counts) counts[status] += 1;
  }
  const total = FLOW_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const visits = new Set(active.map(visitKey)).size;
  const returned = stats?.today.returnedCount ?? counts.Returned;
  const hasOverdue = !!overdue && overdue.count > 0;

  return (
    <section
      data-testid="home-kpis"
      aria-labelledby="home-kpis-title"
      className="overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-3.5 w-[3px] rounded-full bg-maher-blue"
          />
          <h2
            id="home-kpis-title"
            className="text-[13px] font-semibold tracking-tight text-maher-ink"
          >
            সার্ভিস ওভারভিউ
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {returned > 0 ? (
            <span
              className="rounded-full border border-maher-money/30 bg-maher-money/10 px-2 py-0.5 font-semibold text-maher-money"
              title="ফেরত কাজ আজকের মোট সার্ভিসে ধরা হয়নি"
            >
              ফেরত {toBnDigits(returned)}টি
            </span>
          ) : null}
          <span>আজকের কাজ</span>
        </div>
      </div>

      {loading || !stats ? (
        <div className="grid grid-cols-2 xl:grid-cols-[minmax(210px,250px)_minmax(0,1fr)_minmax(190px,230px)]">
          <div className="border-b border-r border-maher-border p-3 sm:p-4 xl:col-start-1 xl:row-start-1 xl:border-b-0">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
          <div className="border-b border-maher-border p-3 sm:p-4 xl:col-start-3 xl:row-start-1 xl:border-b-0">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-10" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
          <div className="col-span-2 p-3 sm:p-4 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:border-r xl:border-maher-border">
            <Skeleton className="h-3 w-16" />
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <div key={index}>
                  <Skeleton className="h-2.5 w-14" />
                  <Skeleton className="mt-2 h-6 w-8" />
                  <Skeleton className="mt-2 h-2.5 w-16" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 xl:grid-cols-[minmax(210px,250px)_minmax(0,1fr)_minmax(190px,230px)]">
          <Link
            href={`/service?date=${date}`}
            data-testid="kpi-total"
            title="আজকের সব সার্ভিস দেখুন"
            className="group flex flex-col justify-between gap-3 border-b border-r border-maher-border p-3 transition-colors hover:bg-maher-blue-soft/40 sm:p-4 xl:col-start-1 xl:row-start-1 xl:border-b-0"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">
                মোট সার্ভিস
              </span>
              <ClipboardList className="h-4 w-4 shrink-0 text-maher-blue" />
            </span>
            <div>
              <p className="text-[38px] font-extrabold leading-[0.9] tracking-tight tabular-nums text-maher-blue sm:text-[42px]">
                {toBnDigits(total)}
              </p>
              <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
                {toBnDigits(visits)}টি কাস্টমার ভিজিট
              </span>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-maher-blue">
              সব কাজ দেখুন
              <ArrowRight className="h-3 w-3" />
            </span>
          </Link>

          <div
            data-testid="kpi-overdue"
            title={
              overdue
                ? "সব তারিখের মধ্যে ডেলিভারি তারিখ পেরিয়ে গেছে কিন্তু হস্তান্তর হয়নি"
                : "ওভারডিউ তথ্য লোড হয়নি"
            }
            aria-label={`ওভারডিউ ${overdue ? toBnDigits(overdue.count) : "লোড হয়নি"}`}
            className={cn(
              "flex flex-col justify-between gap-3 border-b border-maher-border p-3 sm:p-4 xl:col-start-3 xl:row-start-1 xl:border-b-0",
              hasOverdue && "bg-red-50/60"
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <AlarmClock
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    hasOverdue ? "text-maher-due" : "text-muted-foreground/60"
                  )}
                />
                ওভারডিউ
              </span>
              <span className="text-[10px] text-muted-foreground">
                সব তারিখের মধ্যে
              </span>
            </div>
            <div>
              <p
                className={cn(
                  "text-[26px] font-extrabold leading-none tracking-tight tabular-nums sm:text-[30px]",
                  hasOverdue ? "text-maher-due" : "text-muted-foreground"
                )}
              >
                {overdue ? toBnDigits(overdue.count) : "—"}
              </p>
              <span className="mt-1.5 block text-[10px] leading-snug text-muted-foreground sm:text-[11px]">
                {!overdue
                  ? "তথ্য পাওয়া যায়নি"
                  : overdue.count === 0
                    ? "কোনো বিলম্ব নেই"
                    : overdue.oldestDeliveryDate
                      ? `সর্বপ্রাচীন ${dayLabel(overdue.oldestDeliveryDate)}`
                      : "ডেলিভারি তারিখ পেরিয়েছে"}
              </span>
            </div>
          </div>

          <div className="col-span-2 p-3 sm:p-4 xl:col-span-1 xl:col-start-2 xl:row-start-1 xl:border-r xl:border-maher-border">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-muted-foreground">
                কাজের ধাপ
              </span>
              <span className="text-[10px] text-muted-foreground">
                পেন্ডিং → ডেলিভারি
              </span>
            </div>

            <ol className="mt-3 grid grid-cols-2 gap-y-3 sm:grid-cols-4">
              {FLOW_STATUSES.map((status, index) => {
                const Icon = FLOW_ICON[status];
                const tone = FLOW_TONE[status];
                const activeTone = counts[status] > 0;
                return (
                  <li
                    key={status}
                    className={cn(
                      "border-maher-border",
                      index % 2 === 0
                        ? "border-l-0 pl-0"
                        : "border-l pl-3",
                      index === 0
                        ? "sm:border-l-0 sm:pl-0"
                        : "sm:border-l sm:pl-3"
                    )}
                  >
                    <Link
                      href={`/service?date=${date}&status=${encodeURIComponent(status)}`}
                      data-testid={`kpi-${status.toLowerCase()}`}
                      title={`আজকের ${STATUS_BN[status]} সার্ভিস দেখুন`}
                      className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            activeTone ? tone.dot : "bg-maher-border"
                          )}
                        />
                        <span className="text-[10px] font-semibold text-muted-foreground">
                          {STATUS_BN[status]}
                        </span>
                        <Icon
                          className={cn(
                            "ml-auto h-3.5 w-3.5",
                            activeTone
                              ? tone.text
                              : "text-muted-foreground/50"
                          )}
                        />
                      </span>
                      <p
                        className={cn(
                          "mt-1 text-[22px] font-bold leading-none tracking-tight tabular-nums",
                          activeTone ? tone.text : "text-muted-foreground"
                        )}
                      >
                        {toBnDigits(counts[status])}
                      </p>
                      <span className="mt-1 block text-[10px] leading-tight text-muted-foreground">
                        {FLOW_HINT[status]}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>

            <div
              aria-hidden
              className="mt-3 flex h-1 overflow-hidden rounded-full bg-maher-surface-strong"
            >
              {FLOW_STATUSES.map((status) =>
                counts[status] > 0 ? (
                  <span
                    key={status}
                    className={FLOW_TONE[status].bar}
                    style={{
                      width: `${(counts[status] / Math.max(total, 1)) * 100}%`,
                    }}
                  />
                ) : null
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
