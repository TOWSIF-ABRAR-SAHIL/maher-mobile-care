"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContactButtons } from "@/components/ContactButtons";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTaka } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

interface DuesResponse {
  count: number;
  totalDue: number;
  /** Matching rows beyond the rendered page (list is capped server-side). */
  hasMore?: boolean;
  listed?: number;
  services: ServiceDTO[];
}

export function OutstandingDues({
  refreshKey,
  onEdit,
  onReceipt,
}: {
  refreshKey: number;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
}) {
  const [dues, setDues] = useState<DuesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services/dues");
      const data = (await res.json().catch(() => null)) as DuesResponse | null;
      if (!res.ok || !data) throw new Error("বাকি তালিকা আসেনি");
      setDues(data);
    } catch {
      setDues(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section
      data-testid="outstanding-dues"
      className="rounded-xl border border-red-200 bg-white p-4 shadow-md print:hidden"
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
      {loading || !dues ? (
        <p className="py-6 text-center text-sm text-gray-500">তালিকা আসছে…</p>
      ) : dues.services.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-gray-500">
          কোনো বাকি নেই। সব টাকা উঠে গেছে। 🎉
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-600">
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
                    {s.serviceDate.slice(0, 10)}
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
      )}
    </section>
  );
}
