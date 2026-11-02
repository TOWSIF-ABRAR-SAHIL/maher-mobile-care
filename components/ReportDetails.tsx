"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { bengaliDateLabel, dhakaDateKey, dayLabel } from "@/lib/dhaka";
import { formatTaka, toBnDigits } from "@/lib/utils";
import type { ListMode, ServiceDTO } from "@/lib/types";

const PAGE = 300;

/**
 * The report's customer-level detail: one row per device entry for exactly the
 * window the summary cards describe (একদিন / তারিখ রেঞ্জ / সব তারিখ). Money
 * stays auditable — a Returned row keeps its bill/advance, shows 0 বাকি and its
 * refund with the return date, mirroring the ledger rules.
 *
 * The table scrolls inside itself so the dialog never widens the page on a
 * phone; the wrapper is a plain `div` (lane tests pin the first `<section>` of
 * the report dialog to the summary card).
 */
export function ReportDetails({
  rows,
  loading,
  dateMode,
  day,
  range,
}: {
  rows: ServiceDTO[] | null;
  loading: boolean;
  dateMode: ListMode;
  day: string;
  range: { from: string; to: string };
}) {
  const [visible, setVisible] = useState(PAGE);
  useEffect(() => {
    setVisible(PAGE);
  }, [rows]);

  const list = rows ?? [];
  const shown = list.slice(0, visible);
  const label =
    dateMode === "all"
      ? "সব তারিখ"
      : dateMode === "day"
        ? dayLabel(day)
        : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  const remaining = list.length - shown.length;

  return (
    <div
      data-testid="report-details"
      data-rows={list.length}
      className="min-w-0 w-full"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-maher-ink">
          কাস্টমার ডিটেইল রিপোর্ট
        </h3>
        <p className="text-xs text-muted-foreground">
          {label} •{" "}
          {loading
            ? "তৈরি হচ্ছে…"
            : `${toBnDigits(list.length)}টি সার্ভিস রো`}
        </p>
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full rounded" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
          এই তারিখে কোনো সার্ভিস এন্ট্রি নেই।
        </p>
      ) : (
        <>
          <div className="min-w-0 overflow-x-auto rounded-lg border border-maher-border">
            <table
              className="w-full min-w-[860px] text-xs"
              data-testid="report-detail-table"
            >
              <thead>
                <tr className="bg-maher-surface text-left text-[11px] font-semibold text-muted-foreground">
                  <th className="whitespace-nowrap px-2 py-2">তারিখ</th>
                  <th className="whitespace-nowrap px-2 py-2">বিল নং</th>
                  <th className="whitespace-nowrap px-2 py-2">কাস্টমার</th>
                  <th className="whitespace-nowrap px-2 py-2">ফোন</th>
                  <th className="whitespace-nowrap px-2 py-2">মডেল</th>
                  <th className="whitespace-nowrap px-2 py-2">সমস্যা</th>
                  <th className="whitespace-nowrap px-2 py-2">টেকনিশিয়ান</th>
                  <th className="whitespace-nowrap px-2 py-2">অবস্থা</th>
                  <th className="whitespace-nowrap px-2 py-2 text-right">বিল</th>
                  <th className="whitespace-nowrap px-2 py-2 text-right">জমা</th>
                  <th className="whitespace-nowrap px-2 py-2 text-right">বাকি</th>
                  <th className="whitespace-nowrap px-2 py-2 text-right">ফেরত</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const returned = s.status === "Returned";
                  const key = dhakaDateKey(s.serviceDate);
                  return (
                    <tr
                      key={s.id}
                      data-testid={`report-row-${s.id}`}
                      className={`border-t align-top ${
                        returned ? "bg-maher-money/[0.04]" : ""
                      }`}
                    >
                      <td
                        className="whitespace-nowrap px-2 py-1.5 font-mono text-[11px] tabular-nums text-muted-foreground"
                        title={bengaliDateLabel(key)}
                      >
                        {key}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                        #{s.id}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block max-w-[9rem] truncate font-medium text-foreground">
                          {s.customerName}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-muted-foreground">
                        {s.phone}
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block max-w-[8rem] truncate" title={s.model}>
                          {s.model}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span
                          className="block max-w-[11rem] truncate text-muted-foreground"
                          title={s.problem}
                        >
                          {s.problem}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {s.technician}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <StatusBadge status={s.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {formatTaka(s.totalBill)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-maher-done">
                        {formatTaka(s.advance)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right font-semibold tabular-nums text-maher-due-ink">
                        {formatTaka(s.due)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">
                        {returned && s.refundAmount > 0 ? (
                          <span className="text-maher-money">
                            {formatTaka(s.refundAmount)}
                            {s.returnedAt ? (
                              <span className="block text-[10px] text-muted-foreground">
                                {dhakaDateKey(s.returnedAt)}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {remaining > 0 ? (
            <div className="mt-2 flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="report-rows-more"
                className="h-7 bg-white"
                onClick={() => setVisible((v) => v + PAGE)}
              >
                <ChevronDown className="mr-1 h-3.5 w-3.5" />
                আরও দেখুন ({toBnDigits(remaining)}টি বাকি)
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
