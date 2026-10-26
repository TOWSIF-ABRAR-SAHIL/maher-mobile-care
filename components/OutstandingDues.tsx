"use client";

import { Pencil, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactButtons } from "@/components/ContactButtons";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTaka } from "@/lib/utils";
import { dhakaDateKey } from "@/lib/dhaka";
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

  return (
    <section
      data-testid="outstanding-dues"
      data-view={isDesktop ? "table" : "cards"}
      className="rounded-xl border border-red-200 bg-white p-4 print:hidden"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-gray-800">
          💰 বাকি তালিকা (সব তারিখ)
        </h2>
        <div className="text-right">
          <p className="text-sm text-gray-600">
            {loading || !dues
              ? "হিসাব হচ্ছে…"
              : `${dues.count}টি ডিভাইস বাকি • মোট ${formatTaka(dues.totalDue)}`}
          </p>
          {dues?.hasMore && !loading ? (
            <p className="text-xs text-amber-700">
              সবচেয়ে নতুন {dues.listed ?? dues.services.length}টি দেখানো হচ্ছে — বাকি{" "}
              {dues.count - (dues.listed ?? dues.services.length)}টির তালিকা নিচে নেই।
            </p>
          ) : null}
        </div>
      </div>
      {loading ? (
        <p className="py-6 text-center text-sm text-gray-500">তালিকা আসছে…</p>
      ) : !dues ? (
        <p className="py-6 text-center text-sm text-red-600">
          বাকি তালিকা আনা যায়নি — Sync করুন।
        </p>
      ) : dues.services.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-gray-500">
          কোনো বাকি নেই। সব টাকা উঠে গেছে। 🎉
        </p>
      ) : isDesktop ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-600">
                <th className="p-2">তারিখ</th>
                <th className="p-2">কাস্টমার</th>
                <th className="p-2">মডেল / অবস্থা</th>
                <th className="p-2">বিল / জমা / বাকি</th>
                <th className="p-2">যোগাযোগ</th>
                <th className="p-2 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody>
              {visits.map((visit) => {
                const multi = visit.devices.length > 1;
                return (
                  <tr
                    key={visit.key}
                    data-testid={`due-visit-${visit.first.id}`}
                    data-devices={visit.devices.length}
                    className="border-t"
                  >
                    <td className="whitespace-nowrap p-2 text-gray-600">
                      {visit.date}
                      <div className="font-mono text-xs text-gray-400">
                        #{visit.first.id}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{visit.customerName}</div>
                      <div className="text-xs text-gray-500">{visit.phone}</div>
                    </td>
                    <td className="p-2">
                      <div className="space-y-1">
                        {visit.devices.map((s) => (
                          <div key={s.id} className="flex items-start gap-1.5">
                            <div className="min-w-0">
                              <div className="font-medium">{s.model}</div>
                              <div className="mt-1">
                                <StatusBadge status={s.status} />
                              </div>
                            </div>
                            {multi ? (
                              <Button
                                variant="ghost"
                                size="icon"
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
                    <td className="whitespace-nowrap p-2 tabular-nums">
                      <div>বিল: {formatTaka(visit.totalBill)}</div>
                      <div className="text-green-700">
                        জমা: {formatTaka(visit.totalAdvance)}
                      </div>
                      <div className="font-semibold text-red-600">
                        বাকি: {formatTaka(visit.totalDue)}
                      </div>
                      {multi ? (
                        <div className="text-[11px] text-gray-500">
                          {visit.devices.length}টি ডিভাইসের মোট
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2">
                      <ContactButtons service={visit.first} />
                    </td>
                    <td className="p-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-700"
                          title="বিল প্রিন্ট"
                          onClick={() => onReceipt(visit.first)}
                        >
                          <ReceiptText />
                        </Button>
                        {multi ? null : (
                          <Button
                            variant="ghost"
                            size="icon"
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
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2" data-testid="dues-cards">
          {visits.map((visit) => {
            const multi = visit.devices.length > 1;
            return (
              <article
                key={visit.key}
                data-testid={`due-visit-card-${visit.first.id}`}
                data-devices={visit.devices.length}
                className="rounded-lg border border-red-100 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-gray-500">
                      {visit.date} •{" "}
                      <span className="font-mono">#{visit.first.id}</span>
                    </p>
                    <p
                      className="truncate font-medium text-gray-900"
                      title={visit.customerName}
                    >
                      {visit.customerName}
                    </p>
                    <p className="text-xs text-gray-500">{visit.phone}</p>
                  </div>
                  <div className="shrink-0">
                    {multi ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
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
                      className="flex items-start justify-between gap-2 rounded bg-gray-50 px-2 py-1"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm text-gray-800">
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

                <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-red-50 p-2 text-xs tabular-nums">
                  <div>
                    বিল
                    <div className="font-semibold">
                      {formatTaka(visit.totalBill)}
                    </div>
                  </div>
                  <div className="text-green-700">
                    জমা
                    <div className="font-semibold">
                      {formatTaka(visit.totalAdvance)}
                    </div>
                  </div>
                  <div className="text-red-600">
                    বাকি
                    <div className="font-semibold">
                      {formatTaka(visit.totalDue)}
                    </div>
                  </div>
                </div>
                {multi ? (
                  <p className="mt-1 text-right text-[11px] text-gray-500">
                    {visit.devices.length}টি ডিভাইসের মোট
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <ContactButtons service={visit.first} />
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-blue-700"
                      title="বিল প্রিন্ট"
                      onClick={() => onReceipt(visit.first)}
                    >
                      <ReceiptText />
                    </Button>
                    {multi ? null : (
                      <Button
                        variant="ghost"
                        size="icon"
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
        </div>
      )}
    </section>
  );
}
