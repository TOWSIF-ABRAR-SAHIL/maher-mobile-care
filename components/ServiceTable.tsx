"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ClipboardList,
  Eye,
  EyeOff,
  Pencil,
  ReceiptText,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
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
import { formatTaka, STATUS_BN, STATUSES, type ServiceStatus } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

export function ServiceTable({
  services,
  loading,
  date,
  onEdit,
  onReceipt,
  onChanged,
  technicianFilter,
  onClearTechnician,
}: {
  services: ServiceDTO[];
  loading: boolean;
  date: string;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
  onChanged: () => void;
  /** v1.1: show only this technician's rows, or null for everyone. */
  technicianFilter?: string | null;
  onClearTechnician?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ServiceDTO[]>([]);
  const [archLoading, setArchLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  // Privacy: খরচ column starts hidden — eye click reveals it per session.
  const [showExpense, setShowExpense] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"All" | ServiceStatus>("All");

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

  /** One tap on the badge moves the job to the next stage. */
  const advanceStatus = async (s: ServiceDTO) => {
    const order = [...STATUSES];
    const i = order.indexOf(s.status as ServiceStatus);
    if (i === -1 || i === order.length - 1) {
      toast.info("এটা ডেলিভারি হয়ে গেছে");
      return;
    }
    const next = order[i + 1] as ServiceStatus;
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
            variant="outline"
            size="sm"
            onClick={() => setShowExpense((v) => !v)}
            title={showExpense ? "খরচ লুকান" : "খরচ দেখুন"}
            className="print:hidden"
          >
            {showExpense ? (
              <Eye className="mr-1 h-4 w-4" />
            ) : (
              <EyeOff className="mr-1 h-4 w-4" />
            )}
            খরচ
          </Button>
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
              <TableHead>হিসাব (বিল/জমা/বাকি)</TableHead>
              {showExpense ? <TableHead>খরচ</TableHead> : null}
              <TableHead className="text-right print:hidden">অ্যাকশন</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => (
              <TableRow
                key={s.id}
                className={s.due > 0 ? "bg-red-50/60 hover:bg-red-50" : ""}
              >
                <TableCell className="font-mono font-semibold">{s.id}</TableCell>
                {showArchived ? (
                  <TableCell className="whitespace-nowrap text-sm text-gray-600">
                    {s.serviceDate.slice(0, 10)}
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
                  {s.status === "Delivered" && s.due > 0 ? (
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
                  <div className={s.due > 0 ? "text-red-600" : "text-gray-500"}>
                    বাকি: <span className="font-semibold">{formatTaka(s.due)}</span>
                  </div>
                </TableCell>
                {showExpense ? (
                <TableCell>
                  {s.shopExpense ? (
                    <span className="font-medium">{s.shopExpense}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                ) : null}
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
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="এডিট"
                          onClick={() => onEdit(s)}
                        >
                          <Pencil />
                        </Button>
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
