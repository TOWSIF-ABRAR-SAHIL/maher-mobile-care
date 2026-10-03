"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, ReceiptText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContactButtons } from "@/components/ContactButtons";
import { StatusBadge } from "@/components/StatusBadge";
import { formatTaka } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

interface SearchResponse {
  query: string;
  count: number;
  services: ServiceDTO[];
}

export function GlobalServiceSearch({
  refreshKey,
  onEdit,
  onReceipt,
}: {
  refreshKey: number;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const queryRef = useRef(query);
  queryRef.current = query;

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/services/search?q=${encodeURIComponent(trimmed)}`
      );
      const data = (await res.json().catch(
        () => null
      )) as SearchResponse | null;
      if (!res.ok || !data) throw new Error("খোঁজা যায়নি");
      setResult(data);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Data changes elsewhere (edit/save/restore) should refresh visible results.
  useEffect(() => {
    if (queryRef.current.trim().length >= 2) void search(queryRef.current);
  }, [refreshKey, search]);

  useEffect(() => {
    const t = setTimeout(() => void search(query), 350);
    return () => clearTimeout(t);
  }, [query, search]);

  return (
    <section
      data-testid="global-service-search"
      className="rounded-xl border bg-white p-4 shadow-md print:hidden"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold tracking-tight text-gray-800">
          🌍 সব তারিখে খুঁজুন
        </h2>
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            id="global-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="নাম, ফোন, মডেল, সমস্যা বা বিল নং…"
            className="pl-9"
          />
        </div>
      </div>
      {query.trim().length > 0 && query.trim().length < 2 ? (
        <p className="text-sm text-gray-500">কমপক্ষে ২ অক্ষর লিখুন।</p>
      ) : loading ? (
        <p className="py-4 text-center text-sm text-gray-500">খোঁজা হচ্ছে…</p>
      ) : result && result.services.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-sm text-gray-500">
          “{result.query}” দিয়ে কিছু পাওয়া যায়নি।
        </p>
      ) : result ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                <th className="p-2">তারিখ</th>
                <th className="p-2">কাস্টমার</th>
                <th className="p-2">মডেল / সমস্যা</th>
                <th className="p-2">অবস্থা</th>
                <th className="p-2">বাকি</th>
                <th className="p-2">যোগাযোগ</th>
                <th className="p-2 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody>
              {result.services.map((s) => (
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
                    <div className="max-w-48 truncate text-xs text-gray-500">
                      {s.problem}
                    </div>
                  </td>
                  <td className="p-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td
                    className={`whitespace-nowrap p-2 font-semibold tabular-nums ${
                      s.due > 0 ? "text-red-600" : "text-gray-500"
                    }`}
                  >
                    {formatTaka(s.due)}
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
        <p className="text-sm text-gray-500">
          পুরোনো কাস্টমার খুঁজতে এখানে লিখুন — তারিখ বদলাতে হবে না।
        </p>
      )}
    </section>
  );
}
