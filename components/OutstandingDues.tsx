"use client";

import { Fragment } from "react";
import { Pencil, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactButtons } from "@/components/ContactButtons";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTaka, toBnDigits } from "@/lib/utils";
import { bengaliDateLabel, dhakaDateKey } from "@/lib/dhaka";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ServiceDTO } from "@/lib/types";

export interface DuesResponse {
  count: number;
  totalDue: number;
  /** Matching rows beyond the rendered page (list is capped server-side). */
  hasMore?: boolean;
  listed?: number;
  services: ServiceDTO[];
}

/** One customer visit: every unpaid device of the same groupId, one row/slip. */
interface DueVisit {
  key: string;
  date: string;
  customerName: string;
  phone: string;
  first: ServiceDTO;
  devices: ServiceDTO[];
  totalBill: number;
  totalAdvance: number;
  totalDue: number;
}

interface DueSection {
  date: string;
  visits: DueVisit[];
  totalDue: number;
}

/**
 * A visit is one bill for the customer. The API still returns one row per
 * device (so per-device money stays exact), and the list folds those rows back
 * into a single entry per visit — one receipt button, one visit total.
 */
function groupDueVisits(services: ServiceDTO[]): DueVisit[] {
  const groups = new Map<string, ServiceDTO[]>();
  for (const service of services) {
    const key = service.groupId
      ? `group:${service.groupId}`
      : `row:${service.id}`;
    const existing = groups.get(key);
    if (existing) existing.push(service);
    else groups.set(key, [service]);
  }
  return [...groups.entries()].map(([key, devices]) => {
    const first = devices[0];
    return {
      key,
      date: dhakaDateKey(first.serviceDate),
      customerName: first.customerName,
      phone: first.phone,
      first,
      devices,
      totalBill: devices.reduce((sum, d) => sum + d.totalBill, 0),
      totalAdvance: devices.reduce((sum, d) => sum + d.advance, 0),
      totalDue: devices.reduce((sum, d) => sum + d.due, 0),
    };
  });
}

/**
 * Newest day first, one section per date: the date is stated once per group
 * (with that day's due subtotal) instead of repeating down every row.
 */
function groupDueSections(visits: DueVisit[]): DueSection[] {
  const sorted = [...visits].sort((a, b) =>
    a.date === b.date
      ? b.first.id - a.first.id
      : a.date < b.date
        ? 1
        : -1
  );
  const out: DueSection[] = [];
  for (const visit of sorted) {
    const last = out[out.length - 1];
    if (last && last.date === visit.date) {
      last.visits.push(visit);
      last.totalDue += visit.totalDue;
    } else {
      out.push({ date: visit.date, visits: [visit], totalDue: visit.totalDue });
    }
  }
  return out;
}

export function OutstandingDues({
  dues,
  loading,
  onEdit,
  onReceipt,
}: {
  dues: DuesResponse | null;
  loading: boolean;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const visits = dues ? groupDueVisits(dues.services) : [];
  const sections = groupDueSections(visits);

  /** Group divider — same markup in the table (inside a colSpan cell) and on cards. */
  const sectionHeader = (section: DueSection, testid: string) => (
    <div
      data-testid={testid}
      data-date={section.date}
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-2 py-1.5 text-xs"
    >
      <span className="flex items-center gap-2">
        <span className="font-semibold text-maher-ink">
          {bengaliDateLabel(section.date)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {section.date}
        </span>
      </span>
      <span className="text-muted-foreground">
        {toBnDigits(section.visits.length)}টি বাকি •{" "}
        <b className="tabular-nums text-maher-due-ink">
          {formatTaka(section.totalDue)}
        </b>
      </span>
    </div>
  );

  return (
    <section
      data-testid="outstanding-dues"
      data-view={isDesktop ? "table" : "cards"}
      className="rounded-xl border border-maher-due/25 bg-white p-4 shadow-card print:hidden"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-maher-ink">
          💰 বাকি তালিকা (সব তারিখ)
        </h2>
        <div className="text-right">
          <p className="text-sm text-muted-foreground">
            {loading || !dues
              ? "হিসাব হচ্ছে…"
              : `${dues.count}টি ডিভাইস বাকি • মোট ${formatTaka(dues.totalDue)}`}
          </p>
          {dues?.hasMore && !loading ? (
            <p className="text-xs text-maher-money">
              সবচেয়ে নতুন {dues.listed ?? dues.services.length}টি দেখানো হচ্ছে — বাকি{" "}
              {dues.count - (dues.listed ?? dues.services.length)}টির তালিকা নিচে নেই।
            </p>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">তালিকা আসছে…</p>
      ) : !dues ? (
        <p className="py-6 text-center text-sm text-maher-due-ink">
          বাকি তালিকা আনা যায়নি — Sync করুন।
        </p>
      ) : dues.services.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          কোনো বাকি নেই। সব টাকা উঠে গেছে। 🎉
        </p>
      ) : isDesktop ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-maher-surface text-left text-xs font-semibold text-muted-foreground">
                <th className="p-2">তারিখ</th>
                <th className="p-2">কাস্টমার</th>
                <th className="p-2">মডেল / অবস্থা</th>
                <th className="p-2">বিল / জমা / বাকি</th>
                <th className="p-2">যোগাযোগ</th>
                <th className="p-2 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <Fragment key={section.date}>
                  <tr
                    data-testid="due-date-section"
                    data-date={section.date}
                    className="bg-maher-surface/80 hover:bg-maher-surface/80"
                  >
                    <td colSpan={6} className="p-0">
                      {sectionHeader(section, "due-date-section-row")}
                    </td>
                  </tr>
                  {section.visits.map((visit) => {
                    const multi = visit.devices.length > 1;
                    return (
                      <tr
                        key={visit.key}
                        data-testid={`due-visit-${visit.first.id}`}
                        data-devices={visit.devices.length}
                        className="border-t align-top"
                      >
                        <td className="whitespace-nowrap px-2 py-1.5 text-[13px] tabular-nums text-muted-foreground">
                          {visit.date}
                          <div className="font-mono text-xs text-muted-foreground/75">
                            #{visit.first.id}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="text-[13px] font-semibold text-foreground">
                            {visit.customerName}
                          </div>
                          <div className="text-xs tabular-nums text-muted-foreground">
                            {visit.phone}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="space-y-1">
                            {visit.devices.map((s) => (
                              <div key={s.id} className="flex items-start gap-1.5">
                                <div className="min-w-0">
                                  <div className="text-[13px] font-medium">
                                    {s.model}
                                  </div>
                                  <div className="mt-1">
                                    <StatusBadge status={s.status} />
                                  </div>
                                </div>
                                {multi ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`এডিট (${s.model})`}
                                    className="h-7 w-7 shrink-0"
                                    title={`এডিট (${s.model})`}
                                    onClick={() => onEdit(s)}
                                  >
                                    <Pencil />
                                  </Button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </td>
                        {/* Label/value pairs keep the exact text «বিল: ৳X»
                            while the three figures align in one column. */}
                        <td className="whitespace-nowrap px-2 py-1.5 text-[13px] tabular-nums">
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="text-muted-foreground">{"বিল: "}</span>
                            <span className="font-medium text-foreground">
                              {formatTaka(visit.totalBill)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-4">
                            <span className="text-maher-done/80">{"জমা: "}</span>
                            <span className="font-semibold text-maher-done">
                              {formatTaka(visit.totalAdvance)}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-baseline justify-between gap-4 border-t border-dashed border-maher-due/30 pt-0.5">
                            <span className="font-semibold text-maher-due-ink">
                              {"বাকি: "}
                            </span>
                            <span className="font-bold text-maher-due-ink">
                              {formatTaka(visit.totalDue)}
                            </span>
                          </div>
                          {multi ? (
                            <div className="mt-0.5 text-right text-[11px] text-muted-foreground">
                              {visit.devices.length}টি ডিভাইসের মোট
                            </div>
                          ) : null}
                        </td>
                        <td className="px-2 py-1.5">
                          <ContactButtons service={visit.first} />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="বিল প্রিন্ট করুন"
                              className="h-8 w-8 text-maher-navy"
                              title="বিল প্রিন্ট"
                              onClick={() => onReceipt(visit.first)}
                            >
                              <ReceiptText />
                            </Button>
                            {multi ? null : (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="এন্ট্রি এডিট করুন"
                                className="h-8 w-8"
                                title="এডিট"
                                onClick={() => onEdit(visit.first)}
                              >
                                <Pencil />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2" data-testid="dues-cards">
          {sections.map((section) => (
            <Fragment key={section.date}>
              <div className="rounded-lg bg-maher-surface">
                {sectionHeader(section, "due-date-section-card")}
              </div>
              {section.visits.map((visit) => {
                const multi = visit.devices.length > 1;
                return (
                  <article
                    key={visit.key}
                    data-testid={`due-visit-card-${visit.first.id}`}
                    data-devices={visit.devices.length}
                    className="rounded-lg border border-maher-due/25 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {visit.date} •{" "}
                          <span className="font-mono">#{visit.first.id}</span>
                        </p>
                        <p
                          className="truncate font-medium text-foreground"
                          title={visit.customerName}
                        >
                          {visit.customerName}
                        </p>
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {visit.phone}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {multi ? (
                          <span className="rounded bg-maher-due/10 px-1.5 py-0.5 text-[11px] font-semibold text-maher-due-ink">
                            {visit.devices.length}টি ডিভাইস
                          </span>
                        ) : (
                          <StatusBadge status={visit.first.status} />
                        )}
                      </div>
                    </div>

                    <div className="mt-2 space-y-1">
                      {visit.devices.map((s) => (
                        <div
                          key={s.id}
                          className="flex items-start justify-between gap-2 rounded bg-maher-surface px-2 py-1"
                        >
                          <div className="min-w-0">
                            <p className="break-words text-sm text-maher-ink">
                              {s.model}
                            </p>
                            <div className="mt-0.5">
                              <StatusBadge status={s.status} />
                            </div>
                          </div>
                          {multi ? (
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`এডিট (${s.model})`}
                              className="h-7 w-7 shrink-0"
                              title={`এডিট (${s.model})`}
                              onClick={() => onEdit(s)}
                            >
                              <Pencil />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-maher-due/10 p-2 text-xs tabular-nums">
                      <div>
                        বিল
                        <div className="font-semibold">
                          {formatTaka(visit.totalBill)}
                        </div>
                      </div>
                      <div className="text-maher-done">
                        জমা
                        <div className="font-semibold">
                          {formatTaka(visit.totalAdvance)}
                        </div>
                      </div>
                      <div className="text-maher-due-ink">
                        বাকি
                        <div className="font-semibold">
                          {formatTaka(visit.totalDue)}
                        </div>
                      </div>
                    </div>
                    {multi ? (
                      <p className="mt-1 text-right text-[11px] text-muted-foreground">
                        {visit.devices.length}টি ডিভাইসের মোট
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <ContactButtons service={visit.first} />
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="বিল প্রিন্ট করুন"
                          className="h-8 w-8 text-maher-navy"
                          title="বিল প্রিন্ট"
                          onClick={() => onReceipt(visit.first)}
                        >
                          <ReceiptText />
                        </Button>
                        {multi ? null : (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="এন্ট্রি এডিট করুন"
                            className="h-8 w-8"
                            title="এডিট"
                            onClick={() => onEdit(visit.first)}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}
    </section>
  );
}
