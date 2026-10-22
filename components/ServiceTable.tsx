"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ClipboardList,
  Eye,
  EyeOff,
  Loader2,
  MessageCircle,
  Pencil,
  ReceiptText,
  RotateCcw,
  Scale,
  Search,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ServiceAdjustDialog } from "@/components/ServiceAdjustDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { whatsAppHref } from "@/lib/contact";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FLOW_STATUSES,
  formatTaka,
  isReturned,
  STATUS_BN,
  STATUSES,
  type ServiceStatus,
} from "@/lib/utils";
import { isShopExpenseCode } from "@/lib/expense-code";
import { dhakaDateKey } from "@/lib/dhaka";
import type { ServiceDTO } from "@/lib/types";

export function ServiceTable({
  services,
  loading,
  date,
  onEdit,
  onReceipt,
  onSharePdf,
  onChanged,
  technicianFilter,
  onClearTechnician,
}: {
  services: ServiceDTO[];
  loading: boolean;
  date: string;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
  onSharePdf: (service: ServiceDTO) => Promise<void>;
  onChanged: () => void;
  /** v1.1: show only this technician's rows, or null for everyone. */
  technicianFilter?: string | null;
  onClearTechnician?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ServiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ServiceDTO[]>([]);
  const [archLoading, setArchLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  // Privacy: the খরচ column always shows the saved code. A per-row eye
  // reveals only that row's taka amount, so a customer cannot link the code
  // to a price by looking at the list.
  const [revealedExpenses, setRevealedExpenses] = useState<Record<number, boolean>>({});
  const [statusFilter, setStatusFilter] = useState<"All" | ServiceStatus>("All");
  const [sharingId, setSharingId] = useState<number | null>(null);
  const sharingRef = useRef(false);

  const loadArchived = async () => {
    setArchLoading(true);
    try {
      const res = await fetch("/api/services?archived=true");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("আর্কাইভ লোড করা যায়নি");
      setArchived(data.services ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "আর্কাইভ লোড করা যায়নি");
    } finally {
      setArchLoading(false);
    }
  };

  useEffect(() => {
    if (showArchived) void loadArchived();
  }, [showArchived]);

  const source = showArchived ? archived : services;
  const busy = showArchived ? archLoading : loading;

  /**
   * Client-side roster filter. Applied BEFORE the status chips and the search
   * box so their counts describe the filtered view, and matched
   * case-insensitively to stay consistent with /api/stats.
   */
  const techFiltered = useMemo(() => {
    const tech = technicianFilter?.trim().toUpperCase();
    if (!tech) return source;
    return source.filter(
      (s) => (s.technician ?? "").trim().toUpperCase() === tech
    );
  }, [source, technicianFilter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { All: techFiltered.length };
    for (const st of STATUSES) {
      c[st] = techFiltered.filter((s) => s.status === st).length;
    }
    return c;
  }, [techFiltered]);

  const filtered = useMemo(() => {
    const byStatus =
      statusFilter === "All"
        ? techFiltered
        : techFiltered.filter((s) => s.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter((s) =>
      [s.customerName, String(s.id), s.phone, s.model, s.problem]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [techFiltered, search, statusFilter]);

  /** Rapid taps must not fire overlapping PUTs — the state update alone
   *  arrives a tick too late, so a ref guards the window synchronously. */
  const advancingRef = useRef(false);

  /** One tap on the badge moves the job to the next stage. */
  const advanceStatus = async (s: ServiceDTO) => {
    if (advancingRef.current) return;
    if (s.status === "Returned") {
      toast.info("এই কাজ ফেরত দেওয়া হয়েছে");
      return;
    }
    const order = [...FLOW_STATUSES];
    const i = order.indexOf(s.status as (typeof FLOW_STATUSES)[number]);
    if (i === -1 || i === order.length - 1) {
      toast.info("এটা ডেলিভারি হয়ে গেছে");
      return;
    }
    const next = order[i + 1] as ServiceStatus;
    advancingRef.current = true;
    try {
      const res = await fetch(`/api/services/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error("অবস্থা বদলানো যায়নি");
      toast.success(`অবস্থা: ${STATUS_BN[next]}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "অবস্থা বদলানো যায়নি");
    } finally {
      advancingRef.current = false;
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/services/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("আর্কাইভ করা যায়নি");
      toast.success("আর্কাইভ হয়েছে");
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "আর্কাইভ করা যায়নি");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const restore = async (id: number) => {
    setRestoring(id);
    try {
      const res = await fetch(`/api/services/${id}/restore`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("ফিরিয়ে আনা যায়নি");
      toast.success("ফিরিয়ে আনা হয়েছে");
      await loadArchived();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফিরিয়ে আনা যায়নি");
    } finally {
      setRestoring(null);
    }
  };

  const sharePdf = async (service: ServiceDTO) => {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharingId(service.id);
    try {
      await onSharePdf(service);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "PDF তৈরি করা যায়নি"
      );
    } finally {
      sharingRef.current = false;
      setSharingId(null);
    }
  };

  return (
    <section
      data-testid="daily-services"
      className="rounded-xl border bg-white p-4 shadow-md"
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold tracking-tight text-gray-800">
          {showArchived ? (
            <>🗃️ আর্কাইভ (মুছে ফেলা এন্ট্রি)</>
          ) : (
            <>📋 সার্ভিস তালিকা ({date})</>
          )}
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            variant={showArchived ? "default" : "outline"}
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
            className="print:hidden"
          >
            <Archive className="mr-1 h-4 w-4" />
            {showArchived ? "তালিকায় ফিরুন" : "আর্কাইভ দেখুন"}
          </Button>
          <div className="relative sm:w-72 print:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              id="svc-search"
              placeholder="🔍 নাম, আইডি, ফোন বা মডেল খুঁজুন..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* v1.1 filter notice. Deliberately NOT inside a `div.mb-3`: laneA's chip
          helper selects `div.mb-3 button` inside this section, so a status chip
          look-alike here would break that suite. */}
      {technicianFilter ? (
        <div
          data-testid="tech-filter-notice"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm text-blue-900 print:hidden"
        >
          <span>
            🔍 শুধু <strong>{technicianFilter}</strong> এর কাজ দেখানো হচ্ছে
          </span>
          <Button size="sm" variant="outline" onClick={onClearTechnician}>
            ✕ ফিল্টার সরান
          </Button>
        </div>
      ) : null}

      {busy ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : (
        <>
          {!showArchived ? (
            <div className="mb-3 flex flex-wrap gap-1.5 print:hidden">
              {(["All", ...STATUSES] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    statusFilter === st
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-700"
                  }`}
                >
                  {st === "All" ? "সব" : STATUS_BN[st]} ({counts[st] ?? 0})
                </button>
              ))}
            </div>
          ) : null}
          {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <ClipboardList className="h-8 w-8 text-gray-400" />
          <p className="font-medium text-gray-700">
            {technicianFilter
              ? showArchived
                ? `${technicianFilter} এর কোনো আর্কাইভ করা কাজ নেই।`
                : `আজ ${technicianFilter} এর কোনো কাজ নেই।`
              : showArchived
                ? "আর্কাইভ খালি।"
                : "কোন সার্ভিস এন্ট্রি নেই। নতুন এন্ট্রি যোগ করুন।"}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50 [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wider">
              <TableHead>ID</TableHead>
              {showArchived ? <TableHead>তারিখ</TableHead> : null}
              <TableHead>কাস্টমার</TableHead>
              <TableHead>মডেল ও সমস্যা</TableHead>
              <TableHead>অবস্থা</TableHead>
              <TableHead>হিসাব (বিল/জমা/বাকি/ফেরত)</TableHead>
              <TableHead>খরচ / পার্টস দোকান</TableHead>
              <TableHead className="text-right print:hidden">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow
                key={s.id}
                className={
                  isReturned(s.status)
                    ? "bg-amber-50/50 hover:bg-amber-50"
                    : s.due > 0
                      ? "bg-red-50/60 hover:bg-red-50"
                      : ""
                }
              >
                <TableCell className="font-mono font-semibold">{s.id}</TableCell>
                {showArchived ? (
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    {dhakaDateKey(s.serviceDate)}
                  </TableCell>
                ) : null}
                <TableCell>
                  <div className="font-medium">{s.customerName}</div>
                  <div className="text-xs text-gray-500">{s.phone}</div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{s.model}</div>
                  <div className="max-w-44 truncate text-xs text-gray-500" title={s.problem}>
                    {s.problem}
                  </div>
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => void advanceStatus(s)}
                    title={
                      s.status === "Delivered"
                        ? "ডেলিভারি সম্পন্ন"
                        : "ক্লিক করলে পরের অবস্থায় যাবে"
                    }
                    className="cursor-pointer rounded-full transition hover:opacity-75 active:scale-95"
                  >
                    <StatusBadge status={s.status} />
                  </button>
                  {s.damageLoss > 0 ? (
                    <div
                      className="mt-1 whitespace-nowrap text-xs font-bold text-orange-700"
                      title={`ড্যামেজ ক্ষতি: ${formatTaka(s.damageLoss)}`}
                    >
                      ⚠️ ড্যামেজ ক্ষতি
                    </div>
                  ) : null}
                  {s.status === "Delivered" && s.due > 0 && !isReturned(s.status) ? (
                    <div className="mt-1 whitespace-nowrap text-xs font-bold text-red-600">
                      ⚠️ টাকা বাকি
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm tabular-nums">
                  <div>
                    বিল: <span className="font-semibold">{formatTaka(s.totalBill)}</span>
                  </div>
                  <div className="text-green-700">
                    জমা: <span className="font-semibold">{formatTaka(s.advance)}</span>
                  </div>
                  {isReturned(s.status) ? (
                    <div className="text-amber-700">
                      ফেরত:{" "}
                      <span className="font-semibold">
                        {formatTaka(s.refundAmount)}
                      </span>
                    </div>
                  ) : (
                    <div className={s.due > 0 ? "text-red-600" : "text-gray-500"}>
                      বাকি:{" "}
                      <span className="font-semibold">{formatTaka(s.due)}</span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="align-top">
                  {s.shopExpense || s.partsShop || s.damageLoss > 0 ? (
                    <div className="space-y-0.5">
                      {s.shopExpense ? (
                        <div className="flex flex-wrap items-center gap-1 font-medium">
                          {/* Codes are safe to show. A legacy plain number is
                              the real amount, so the list never prints it. */}
                          <span
                            data-testid={`expense-code-${s.id}`}
                            className="font-mono"
                          >
                            {isShopExpenseCode(s.shopExpense)
                              ? s.shopExpense
                              : "৳••••"}
                          </span>
                          <button
                            type="button"
                            data-testid={`expense-reveal-${s.id}`}
                            aria-label={
                              revealedExpenses[s.id]
                                ? "খরচের টাকা লুকান"
                                : "খরচের টাকা দেখুন"
                            }
                            aria-pressed={!!revealedExpenses[s.id]}
                            title={
                              revealedExpenses[s.id]
                                ? "খরচের টাকা লুকান"
                                : "খরচের টাকা দেখুন"
                            }
                            onClick={() =>
                              setRevealedExpenses((prev) => ({
                                ...prev,
                                [s.id]: !prev[s.id],
                              }))
                            }
                            className="rounded p-0.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                          >
                            {revealedExpenses[s.id] ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                          {revealedExpenses[s.id] ? (
                            <span
                              data-testid={`expense-amount-${s.id}`}
                              className="text-xs font-semibold text-emerald-700"
                            >
                              {formatTaka(s.expenseAmount)}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {s.partsShop ? (
                        <div
                          className="max-w-40 truncate text-xs text-blue-700"
                          title={s.partsShop}
                        >
                          {s.partsShop}
                        </div>
                      ) : null}
                      {s.damageLoss > 0 ? (
                        <div
                          className="whitespace-nowrap text-xs font-semibold text-orange-700"
                          title={s.damageNote ?? "ড্যামেজ ক্ষতি"}
                        >
                          ক্ষতি: {formatTaka(s.damageLoss)}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell className="print:hidden">
                  <div className="flex justify-end gap-1">
                    {showArchived ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-green-700"
                        title="ফিরিয়ে আনুন"
                        disabled={restoring === s.id}
                        onClick={() => void restore(s.id)}
                      >
                        <RotateCcw />
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-700"
                          title="বিল প্রিন্ট"
                          onClick={() => onReceipt(s)}
                        >
                          <ReceiptText />
                        </Button>
                        {s.phone.trim() ? (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-700"
                            title="WhatsApp (chat/call)"
                          >
                            <a
                              href={whatsAppHref(s)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`WhatsApp: ${s.customerName}`}
                            >
                              <MessageCircle />
                            </a>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-700"
                            title="ফোন নম্বর নেই"
                            disabled
                          >
                            <MessageCircle />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-green-700"
                          title="PDF শেয়ার"
                          disabled={!s.phone.trim() || sharingId !== null}
                          onClick={() => void sharePdf(s)}
                        >
                          {sharingId === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Share2 />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-amber-700"
                          title={
                            isReturned(s.status)
                              ? "ড্যামেজ ক্ষতি"
                              : "ফেরত / ড্যামেজ ক্ষতি"
                          }
                          onClick={() => setAdjustTarget(s)}
                        >
                          <Scale />
                        </Button>
                        {!isReturned(s.status) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="এডিট"
                            onClick={() => onEdit(s)}
                          >
                            <Pencil />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600"
                          title="ডিলিট"
                          onClick={() => setDeleteTarget(s)}
                        >
                          <Trash2 />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
          )}
        </>
      )}

      {adjustTarget ? (
        <ServiceAdjustDialog
          key={adjustTarget.id}
          service={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onChanged={onChanged}
        />
      ) : null}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>আর্কাইভ করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `ID ${deleteTarget.id} — ${deleteTarget.customerName} (${deleteTarget.model}) তালিকা ও হিসাব থেকে বাদ যাবে। পরে "আর্কাইভ দেখুন" থেকে ফিরিয়ে আনা যাবে।`
                : ""}
              {deleteTarget &&
              isReturned(deleteTarget.status) &&
              (deleteTarget.refundAmount > 0 ||
                deleteTarget.expenseAmount > 0 ||
                deleteTarget.damageLoss > 0) ? (
                <span className="mt-2 block font-medium text-red-700">
                  ⚠️ এই ফেরত কাজের রিফান্ড, খরচ ও ড্যামেজ ক্ষতিও সব রিপোর্ট ও
                  লাভের হিসাব থেকে বাদ যাবে। আর্কাইভ থেকে ফিরিয়ে আনলে আবার
                  হিসাবে যোগ হবে।
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? "হচ্ছে…" : "আর্কাইভ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
