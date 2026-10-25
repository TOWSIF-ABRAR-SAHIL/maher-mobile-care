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
              : `${dues.count}টি বাকি • মোট ${formatTaka(dues.totalDue)}`}
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
              {dues.services.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="whitespace-nowrap p-2 text-gray-600">
                    {dhakaDateKey(s.serviceDate)}
                    <div className="font-mono text-xs text-gray-400">
                      #{s.id}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{s.customerName}</div>
                    <div className="text-xs text-gray-500">{s.phone}</div>
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{s.model}</div>
                    <div className="mt-1">
                      <StatusBadge status={s.status} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap p-2 tabular-nums">
                    <div>বিল: {formatTaka(s.totalBill)}</div>
                    <div className="text-green-700">
                      জমা: {formatTaka(s.advance)}
                    </div>
                    <div className="font-semibold text-red-600">
                      বাকি: {formatTaka(s.due)}
                    </div>
                  </td>
                  <td className="p-2">
                    <ContactButtons service={s} />
                  </td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-blue-700"
                        title="বিল প্রিন্ট"
                        onClick={() => onReceipt(s)}
                      >
                        <ReceiptText />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="এডিট"
                        onClick={() => onEdit(s)}
                      >
                        <Pencil />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-2" data-testid="dues-cards">
          {dues.services.map((s) => (
            <article key={s.id} className="rounded-lg border border-red-100 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-gray-500">
                    {dhakaDateKey(s.serviceDate)} •{" "}
                    <span className="font-mono">#{s.id}</span>
                  </p>
                  <p
                    className="truncate font-medium text-gray-900"
                    title={s.customerName}
                  >
                    {s.customerName}
                  </p>
                  <p className="text-xs text-gray-500">{s.phone}</p>
                </div>
                <div className="shrink-0">
                  <StatusBadge status={s.status} />
                </div>
              </div>

              <p className="mt-2 break-words text-sm text-gray-800">{s.model}</p>

              <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-red-50 p-2 text-xs tabular-nums">
                <div>
                  বিল
                  <div className="font-semibold">{formatTaka(s.totalBill)}</div>
                </div>
                <div className="text-green-700">
                  জমা
                  <div className="font-semibold">{formatTaka(s.advance)}</div>
                </div>
                <div className="text-red-600">
                  বাকি
                  <div className="font-semibold">{formatTaka(s.due)}</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <ContactButtons service={s} />
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-blue-700"
                    title="বিল প্রিন্ট"
                    onClick={() => onReceipt(s)}
                  >
                    <ReceiptText />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    title="এডিট"
                    onClick={() => onEdit(s)}
                  >
                    <Pencil />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
