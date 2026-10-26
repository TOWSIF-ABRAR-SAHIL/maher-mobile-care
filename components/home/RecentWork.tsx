"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ClipboardList,
  ReceiptText,
} from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { dayLabel, dhakaDateKey } from "@/lib/dhaka";
import { cn, formatTaka, toBnDigits } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

interface Visit {
  key: string;
  first: ServiceDTO;
  devices: ServiceDTO[];
  newestId: number;
}

function groupVisits(rows: ServiceDTO[]): Visit[] {
  const order: string[] = [];
  const map = new Map<string, Visit>();
  for (const row of rows) {
    const key = row.groupId ? `g:${row.groupId}` : `r:${row.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.devices.push(row);
      existing.newestId = Math.max(existing.newestId, row.id);
      continue;
    }
    order.push(key);
    map.set(key, {
      key,
      first: row,
      devices: [row],
      newestId: row.id,
    });
  }
  return order
    .map((key) => map.get(key)!)
    .sort((a, b) => b.newestId - a.newestId)
    .map((visit) => ({
      ...visit,
      devices: [...visit.devices].sort((a, b) => a.id - b.id),
    }));
}

function deliveryInfo(service: ServiceDTO, today: string) {
  if (service.deliveredAt) {
    return {
      text: `ডেলিভারি ${dayLabel(dhakaDateKey(service.deliveredAt))}`,
      overdue: false,
    };
  }
  if (!service.deliveryDate || service.status === "Returned") return null;
  const key = dhakaDateKey(service.deliveryDate);
  return { text: `ডেলিভারি ${dayLabel(key)}`, overdue: key < today };
}

/** One thin status edge per visit, so the list can be scanned without reading
 *  every badge. A mixed visit gets the selection blue instead of a false single
 *  status. */
function barTone(devices: ServiceDTO[]): string {
  const statuses = new Set(devices.map((device) => device.status));
  if (statuses.size > 1) return "bg-maher-blue";
  switch (devices[0]?.status) {
    case "Pending":
      return "bg-maher-due";
    case "In-Progress":
      return "bg-maher-navy";
    case "Completed":
      return "bg-maher-done";
    case "Returned":
      return "bg-maher-warning";
    default:
      return "bg-maher-border";
  }
}

function StatusSummary({ devices }: { devices: ServiceDTO[] }) {
  const counts = new Map<string, number>();
  for (const device of devices) {
    counts.set(device.status, (counts.get(device.status) ?? 0) + 1);
  }
  const entries = [...counts.entries()];

  return (
    <div className="flex flex-wrap items-center gap-1">
      {entries.slice(0, 2).map(([status, count]) => (
        <span key={status} className="inline-flex items-center gap-0.5">
          <StatusBadge status={status} />
          {count > 1 ? (
            <span className="text-[10px] font-semibold text-muted-foreground">
              ×{toBnDigits(count)}
            </span>
          ) : null}
        </span>
      ))}
      {entries.length > 2 ? (
        <span className="text-[10px] font-semibold text-muted-foreground">
          +{toBnDigits(entries.length - 2)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Today's visits, grouped by customer. A multi-device visit is one parent row;
 * expanding it reveals each device with its own status, due and delivery date.
 * Customer-level totals stay on the parent and are never repeated on children.
 */
export function RecentWork({
  services,
  date,
  loading,
}: {
  services: ServiceDTO[];
  date: string;
  loading: boolean;
}) {
  const baseId = useId();
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const allVisits = groupVisits(services);
  const visits = allVisits.slice(0, 6);

  const toggle = (key: string) => {
    setOpenKeys((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key]
    );
  };

  return (
    <section
      data-testid="home-recent"
      aria-labelledby="home-recent-title"
      className="overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-3.5 w-[3px] rounded-full bg-maher-blue"
          />
          <h2
            id="home-recent-title"
            className="text-[13px] font-semibold tracking-tight text-maher-ink"
          >
            আজকের সাম্প্রতিক কাজ
          </h2>
          {allVisits.length > 0 ? (
            <span className="rounded-full bg-maher-surface-strong px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {toBnDigits(allVisits.length)}টি ভিজিট
            </span>
          ) : null}
        </div>
        <Link
          href={`/service?date=${date}`}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-maher-navy transition-colors hover:text-maher-blue"
        >
          সব দেখুন
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2 p-3">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : visits.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <ClipboardList className="mx-auto h-7 w-7 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-semibold text-maher-ink">
            আজ এখনো কোনো কাজ নেই
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            নতুন সার্ভিস এন্ট্রি করলে এখানেই দেখা যাবে।
          </p>
          <Link
            href={`/service?date=${date}&mode=service`}
            className="mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-maher-blue hover:bg-maher-blue-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
          >
            প্রথম সার্ভিস এন্ট্রি করুন
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ) : (
        <ol className="divide-y divide-maher-border">
          {visits.map(({ key, first, devices }) => {
            const expanded = openKeys.includes(key);
            const panelId = `recent-${baseId.replace(
              /[^a-zA-Z0-9_-]/g,
              ""
            )}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
            const due = devices.reduce((sum, device) => sum + device.due, 0);
            const models = devices
              .map((device) => device.model)
              .filter(Boolean);
            const pendingDelivery = devices
              .filter(
                (device) =>
                  !device.deliveredAt &&
                  device.deliveryDate &&
                  device.status !== "Returned"
              )
              .sort((a, b) =>
                (a.deliveryDate ?? "").localeCompare(b.deliveryDate ?? "")
              )[0];
            const nextDelivery = pendingDelivery
              ? deliveryInfo(pendingDelivery, date)
              : null;
            const anyOverdue = devices.some(
              (device) => deliveryInfo(device, date)?.overdue
            );

            return (
              <li key={key} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-y-0 left-0 w-[3px]",
                    barTone(devices)
                  )}
                />
                <div className="flex items-start gap-2 px-4 py-3">
                  {devices.length > 1 ? (
                    <button
                      type="button"
                      data-testid={`recent-toggle-${key}`}
                      aria-expanded={expanded}
                      aria-controls={panelId}
                      aria-label={
                        expanded
                          ? `${first.customerName}: ডিভাইস লুকান`
                          : `${first.customerName}: ${toBnDigits(devices.length)}টি ডিভাইস দেখুন`
                      }
                      onClick={() => toggle(key)}
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-maher-border hover:bg-white hover:text-maher-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          expanded && "rotate-180"
                        )}
                      />
                    </button>
                  ) : (
                    <span aria-hidden className="w-1 shrink-0" />
                  )}

                  <Link
                    href={`/service?date=${date}&edit=${first.id}`}
                    className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[13px] font-semibold text-maher-ink hover:text-maher-blue">
                        {first.customerName}
                      </span>
                      <span className="font-mono text-[10px] font-semibold text-muted-foreground">
                        #{toBnDigits(first.id)}
                        {devices.length > 1
                          ? ` +${toBnDigits(devices.length - 1)}`
                          : ""}
                      </span>
                      {devices.length > 1 ? (
                        <span className="rounded bg-maher-surface-strong px-1.5 py-0.5 text-[10px] font-semibold text-maher-navy">
                          {toBnDigits(devices.length)}টি ডিভাইস
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{first.phone}</span>
                      {models.length > 0 ? ` · ${models.join(" • ")}` : ""}
                    </span>
                    {first.problem ? (
                      <span className="mt-0.5 block truncate text-[11px] text-maher-ink/75">
                        {first.problem}
                      </span>
                    ) : null}
                    <span className="mt-1.5 block">
                      <StatusSummary devices={devices} />
                    </span>
                  </Link>

                  <div className="flex min-w-[64px] shrink-0 flex-col items-end gap-1">
                    <p
                      className={cn(
                        "text-[13px] font-bold tabular-nums",
                        due > 0 ? "text-maher-due" : "text-muted-foreground"
                      )}
                    >
                      {due > 0 ? formatTaka(due) : "পরিশোধিত"}
                    </p>
                    {nextDelivery ? (
                      <p
                        className={cn(
                          "whitespace-nowrap text-[10px]",
                          anyOverdue
                            ? "font-semibold text-maher-due"
                            : "text-muted-foreground"
                        )}
                      >
                        {anyOverdue ? "⚠️ " : ""}
                        {nextDelivery.text}
                      </p>
                    ) : null}
                    <Link
                      href={`/service?date=${date}&receipt=${first.id}`}
                      aria-label={`${first.customerName}: রিসিট দেখুন`}
                      title="রিসিট দেখুন"
                      className="inline-flex items-center gap-1 rounded-md text-[10px] font-semibold text-maher-navy transition-colors hover:text-maher-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                    >
                      <ReceiptText className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">রিসিট</span>
                    </Link>
                  </div>
                </div>

                {devices.length > 1 && expanded ? (
                  <ul
                    id={panelId}
                    className="border-t border-dashed border-maher-border bg-maher-surface/60"
                  >
                    {devices.map((device) => {
                      const info = deliveryInfo(device, date);
                      return (
                        <li
                          key={device.id}
                          data-testid={`recent-device-${device.id}`}
                          className="flex items-start gap-2 border-b border-dashed border-maher-border px-4 py-2.5 pl-12 last:border-b-0 sm:pl-14"
                        >
                          <span className="w-9 shrink-0 pt-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                            #{toBnDigits(device.id)}
                          </span>
                          <Link
                            href={`/service?date=${date}&edit=${device.id}`}
                            className="min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                          >
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-[11px] font-semibold text-maher-ink hover:text-maher-blue">
                                {device.model || "মডেল লেখা হয়নি"}
                              </span>
                              <StatusBadge status={device.status} />
                            </span>
                            {device.problem ? (
                              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                                {device.problem}
                              </span>
                            ) : null}
                            {info ? (
                              <span
                                className={cn(
                                  "mt-0.5 block text-[10px]",
                                  info.overdue
                                    ? "font-semibold text-maher-due"
                                    : "text-muted-foreground"
                                )}
                              >
                                {info.overdue ? "⚠️ " : ""}
                                {info.text}
                              </span>
                            ) : null}
                          </Link>
                          <div className="flex shrink-0 flex-col items-end gap-0.5">
                            <span
                              className={cn(
                                "text-[11px] font-semibold tabular-nums",
                                device.due > 0
                                  ? "text-maher-due"
                                  : "text-muted-foreground"
                              )}
                            >
                              {device.due > 0
                                ? formatTaka(device.due)
                                : "পরিশোধিত"}
                            </span>
                            <Link
                              href={`/service?date=${date}&receipt=${device.id}`}
                              aria-label={`${device.model || first.customerName}: রিসিট দেখুন`}
                              title="রিসিট দেখুন"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-maher-navy transition-colors hover:text-maher-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
                            >
                              <ReceiptText className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">রিসিট</span>
                            </Link>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
