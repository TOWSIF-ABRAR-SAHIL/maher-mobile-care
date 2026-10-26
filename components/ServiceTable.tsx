"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
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
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ServiceAdjustDialog } from "@/components/ServiceAdjustDialog";
import { ServiceDateNav } from "@/components/ServiceDateNav";
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
  toBnDigits,
  type ServiceStatus,
} from "@/lib/utils";
import { isShopExpenseCode } from "@/lib/expense-code";
import { dhakaDateKey, bengaliDateLabel } from "@/lib/dhaka";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ServiceDTO } from "@/lib/types";

/**
 * One customer visit: either a plain single-device job or every device row that
 * shares a `groupId`. The daily list renders one entry per visit so a customer
 * who brought three phones does not fill three rows.
 */
type Visit = {
  key: string;
  customerName: string;
  phone: string;
  devices: ServiceDTO[];
  /** Devices that matched the active status filter/search (all when unfiltered). */
  matched: number;
};

/** Rows arrive grouped already (same groupId sits together), so a single pass in
 *  source order keeps the list stable while collecting each visit's devices. */
function groupVisits(rows: ServiceDTO[]): Visit[] {
  const visits: Visit[] = [];
  const byGroup = new Map<string, Visit>();
  for (const row of rows) {
    if (!row.groupId) {
      visits.push({
        key: `row-${row.id}`,
        customerName: row.customerName,
        phone: row.phone,
        devices: [row],
        matched: 1,
      });
      continue;
    }
    const existing = byGroup.get(row.groupId);
    if (existing) {
      existing.devices.push(row);
      existing.matched += 1;
      continue;
    }
    const visit: Visit = {
      key: `group-${row.groupId}`,
      customerName: row.customerName,
      phone: row.phone,
      devices: [row],
      matched: 1,
    };
    byGroup.set(row.groupId, visit);
    visits.push(visit);
  }
  return visits;
}

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
  onPrev,
  onNext,
  onDateChange,
  onToday,
  initialStatus,
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
  /** Date navigation lives in this list header, not in the app chrome. */
  onPrev?: () => void;
  onNext?: () => void;
  onDateChange?: (date: string) => void;
  onToday?: () => void;
  /** Deep-link from the Service stage line (`/service?status=Pending`). */
  initialStatus?: "All" | ServiceStatus;
}) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ServiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ServiceDTO[]>([]);
  const [archLoading, setArchLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  // Privacy: the খরচ column always shows the saved code. The header's
  // universal eye reveals every row at once (no timer) while a per-row eye
  // reveals only that row's taka amount for 10 seconds.
  const [showAllExpenses, setShowAllExpenses] = useState(false);
  const [revealedExpenses, setRevealedExpenses] = useState<
    Record<number, boolean>
  >({});
  const revealTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>(
    {}
  );
  const clearRevealTimer = (id: number) => {
    const timer = revealTimers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete revealTimers.current[id];
    }
  };
  const hideRowExpense = (id: number) => {
    clearRevealTimer(id);
    setRevealedExpenses((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const toggleRowExpense = (id: number) => {
    if (showAllExpenses) return;
    if (revealedExpenses[id]) {
      hideRowExpense(id);
      return;
    }
    clearRevealTimer(id);
    setRevealedExpenses((prev) => ({ ...prev, [id]: true }));
    revealTimers.current[id] = setTimeout(() => {
      hideRowExpense(id);
    }, 10_000);
  };
  /** One click shows every row; the next click hides every row. Partial
   *  per-row reveals do not affect this decision. */
  const toggleAllExpenses = () => {
    if (showAllExpenses) {
      setShowAllExpenses(false);
      return;
    }
    Object.keys(revealTimers.current).forEach((key) => {
      clearRevealTimer(Number(key));
    });
    setRevealedExpenses({});
    setShowAllExpenses(true);
  };
  useEffect(() => {
    // A new day means new rows; never leak a reveal/timer across dates.
    Object.keys(revealTimers.current).forEach((key) => {
      clearRevealTimer(Number(key));
    });
    setRevealedExpenses({});
  }, [date]);
  useEffect(
    () => () => {
      Object.keys(revealTimers.current).forEach((key) => {
        const timer = revealTimers.current[Number(key)];
        if (timer) clearTimeout(timer);
      });
      revealTimers.current = {};
    },
    []
  );
  const [statusFilter, setStatusFilter] = useState<"All" | ServiceStatus>(
    initialStatus ?? "All"
  );
  useEffect(() => {
    setStatusFilter(initialStatus ?? "All");
  }, [initialStatus]);
  // Multi-device visits can be folded to their summary strip. Keyed by the
  // stable visit key (group id / row id) so an edit or a refresh keeps the
  // choice. A search or status filter always expands, otherwise a matching
  // device could exist in the list while staying invisible.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [sharingId, setSharingId] = useState<number | null>(null);
  const sharingRef = useRef(false);
  // Desktop table is the default so the existing desktop test suites see it
  // immediately; on phones/tablets the effect switches to the card list.
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // A multi-device visit lives inside ONE colSpan cell, so it cannot inherit
  // the table's column widths the way a normal row does. The inner grid copies
  // the measured header widths, otherwise the device lines drift away from
  // their column titles (status/money/cost ended up ~50-100px off).
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [deviceCols, setDeviceCols] = useState("");
  /** Fallback tracks for the very first paint, before measurement lands. */
  const DEVICE_GRID_FALLBACK =
    "grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]";
  const deviceGridStyle = deviceCols
    ? { gridTemplateColumns: deviceCols }
    : undefined;

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

  const visitsAll = useMemo(() => groupVisits(techFiltered), [techFiltered]);

  /**
   * Counts describe entries, not devices: clicking "ডেলিভারি (২)" must show two
   * visits, even if one of them carries three devices. A visit counts once for
   * a status as soon as any of its devices is in that status.
   */
  const counts = useMemo(() => {
    const c: Record<string, number> = { All: visitsAll.length };
    for (const st of STATUSES) {
      c[st] = visitsAll.filter((v) =>
        v.devices.some((d) => d.status === st)
      ).length;
    }
    return c;
  }, [visitsAll]);

  /**
   * Filtering is visit-level: a match on any device keeps the whole visit so no
   * device of the same customer disappears. `matched` records how many devices
   * actually matched so the list can say so instead of silently hiding detail.
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Visit[] = [];
    for (const visit of visitsAll) {
      let matched = visit.devices;
      if (statusFilter !== "All") {
        matched = matched.filter((d) => d.status === statusFilter);
      }
      if (q) {
        matched = matched.filter((d) =>
          [d.customerName, String(d.id), d.phone, d.model, d.problem]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }
      if (matched.length > 0) out.push({ ...visit, matched: matched.length });
    }
    return out;
  }, [visitsAll, search, statusFilter]);

  /** Any active filter forces groups open so every match stays visible. */
  const filterActive = search.trim().length > 0 || statusFilter !== "All";
  const isCollapsed = (visit: Visit) =>
    !filterActive && visit.devices.length > 1 && !!collapsed[visit.key];
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Auto table layout re-distributes columns whenever the visible row set
  // changes, so re-measure then and on container resizes; the px template is
  // what keeps each device line under its own column title.
  const rowCount = filtered.length;
  useLayoutEffect(() => {
    if (!isDesktop) return;
    const table = tableRef.current;
    if (!table) return;
    const measure = () => {
      const headerRow = table.querySelector("thead tr");
      if (!headerRow) return;
      // ID + (তারিখ) + কাস্টমার stay outside the spanning cell.
      const offset = showArchived ? 3 : 2;
      const widths = [...headerRow.children]
        .slice(offset)
        .map((cell) => cell.getBoundingClientRect().width);
      if (widths.length !== 5 || widths.some((w) => w <= 0)) return;
      // Fixed px tracks: fractional units take their minimum from the content,
      // so a wide badge/date would widen one column and shift the rest.
      const next = widths.map((w) => `${Math.round(w * 100) / 100}px`).join(" ");
      setDeviceCols((prev) => (prev === next ? prev : next));
    };
    measure();
    // Observe the header cells themselves: switching the template can nudge
    // the auto layout, so keep re-measuring until the columns settle.
    const observer = new ResizeObserver(measure);
    for (const th of table.querySelectorAll("thead th")) observer.observe(th);
    return () => observer.disconnect();
  }, [isDesktop, showArchived, rowCount]);

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

  /** Status is a tappable badge plus the two warnings shown in both views. */
  const renderStatus = (s: ServiceDTO) => (
    <div>
      <button
        onClick={() => void advanceStatus(s)}
        aria-label={`অবস্থা বদলান: ${STATUS_BN[s.status as ServiceStatus] ?? s.status}`}
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
          className="mt-1 whitespace-nowrap text-xs font-bold text-maher-money"
          title={`ড্যামেজ ক্ষতি: ${formatTaka(s.damageLoss)}`}
        >
          ⚠️ ড্যামেজ ক্ষতি
        </div>
      ) : null}
      {s.status === "Delivered" && s.due > 0 && !isReturned(s.status) ? (
        <div className="mt-1 whitespace-nowrap text-xs font-bold text-maher-due">
          ⚠️ টাকা বাকি
        </div>
      ) : null}
    </div>
  );

  /** Expected handover date; turns red once the day has passed. */
  const renderDelivery = (s: ServiceDTO) => {
    if (s.deliveredAt) {
      return (
        <div className="mt-0.5 whitespace-nowrap text-[11px] font-medium text-maher-done">
          ✅ ডেলিভারি: {dhakaDateKey(s.deliveredAt)}
        </div>
      );
    }
    if (!s.deliveryDate) return null;
    const key = dhakaDateKey(s.deliveryDate);
    const overdue = key < dhakaDateKey(new Date()) && !isReturned(s.status);
    return (
      <div
        className={`mt-0.5 whitespace-nowrap text-[11px] ${
          overdue ? "font-semibold text-maher-due" : "text-muted-foreground"
        }`}
      >
        {overdue ? "⚠️ " : ""}ডেলিভারি: {key}
      </div>
    );
  };

  const groupBadge = (s: ServiceDTO) =>
    s.groupId ? (
      <span
        data-testid={`group-badge-${s.id}`}
        title="একই কাস্টমারের একাধিক ডিভাইস — বিল প্রিভিউতে সব ডিভাইস একসাথে দেখা যাবে"
        className="rounded bg-maher-surface px-1 py-0.5 text-[10px] font-semibold text-maher-navy"
      >
        👥 গ্রুপ
      </span>
    ) : null;

  /**
   * Each row prints like a receipt line: the bill is the headline figure, the
   * deposit and the balance sit on a ruled second line. All figures use
   * tabular numerals so a column can be scanned down without wobble.
   */
  const renderMoney = (s: ServiceDTO) => {
    const returned = isReturned(s.status);
    return (
      <div
        data-testid={`svc-money-${s.id}`}
        className="min-w-[7.5rem] tabular-nums"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[10px] font-medium text-muted-foreground">
            বিল
          </span>
          <span className="text-[13px] font-semibold text-foreground">
            {formatTaka(s.totalBill)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-dashed border-maher-border/80 pt-1 text-[11px]">
          <span className="text-maher-done">
            জমা{" "}
            <span className="font-semibold">{formatTaka(s.advance)}</span>
          </span>
          {returned ? (
            <span className="font-semibold text-maher-money">
              ফেরত {formatTaka(s.refundAmount)}
            </span>
          ) : (
            <span
              className={`font-semibold ${
                s.due > 0 ? "text-maher-due" : "text-muted-foreground"
              }`}
            >
              বাকি {formatTaka(s.due)}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderCost = (s: ServiceDTO) => {
    if (!s.shopExpense && !s.partsShop && s.damageLoss <= 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    const amountVisible = showAllExpenses || !!revealedExpenses[s.id];

    return (
      <div className="space-y-0.5">
        {s.shopExpense ? (
          <div className="flex flex-wrap items-center gap-1 font-medium">
            {/* Codes are safe to show. A legacy plain number is the real
                amount, so the list never prints it. */}
            <span
              data-testid={`expense-code-${s.id}`}
              className="font-mono"
            >
              {isShopExpenseCode(s.shopExpense)
                ? s.shopExpense
                : "৳••••"}
            </span>
            {s.expenseWrittenOff ? (
              <span
                data-testid={`expense-written-off-${s.id}`}
                className="rounded bg-maher-border px-1 py-0.5 text-[10px] font-semibold text-muted-foreground"
                title="ফেরতের সময় খরচ বাদ দেওয়া হয়েছে — রিপোর্টে যোগ হয় না"
              >
                বাতিল
              </span>
            ) : null}
            <button
              type="button"
              data-testid={`expense-reveal-${s.id}`}
              aria-label={
                showAllExpenses
                  ? "সব খরচ দেখা হচ্ছে"
                  : amountVisible
                    ? "খরচের টাকা লুকান"
                    : "খরচের টাকা দেখুন"
              }
              aria-pressed={amountVisible}
              disabled={showAllExpenses}
              title={
                showAllExpenses
                  ? "সব খরচ দেখা হচ্ছে"
                  : amountVisible
                    ? "এখনই লুকান (১০ সেকেন্ড পর নিজে থেকেও লুকাবে)"
                    : "১০ সেকেন্ডের জন্য টাকা দেখুন"
              }
              onClick={() => toggleRowExpense(s.id)}
              className="rounded p-0.5 text-muted-foreground transition hover:bg-maher-border/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {amountVisible ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
            {amountVisible ? (
              <span
                data-testid={`expense-amount-${s.id}`}
                className="text-xs font-semibold text-maher-money"
              >
                {formatTaka(s.expenseAmount)}
              </span>
            ) : null}
          </div>
        ) : null}
        {s.partsShop ? (
          <div
            className="max-w-40 truncate text-xs text-maher-navy"
            title={s.partsShop}
          >
            {s.partsShop}
          </div>
        ) : null}
        {s.damageLoss > 0 ? (
          <div
            className="whitespace-nowrap text-xs font-semibold text-maher-money"
            title={s.damageNote ?? "ড্যামেজ ক্ষতি"}
          >
            ক্ষতি: {formatTaka(s.damageLoss)}
          </div>
        ) : null}
      </div>
    );
  };

  const renderActions = (s: ServiceDTO) => (
    <div className="flex flex-wrap justify-end gap-1 lg:grid lg:grid-cols-[repeat(3,1.5rem)] lg:gap-0.5 min-[1400px]:flex min-[1400px]:flex-nowrap min-[1400px]:gap-1 print:hidden">
      {showArchived ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="ফিরিয়ে আনুন"
          className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
            aria-label="বিল প্রিন্ট"
            className="h-10 w-10 text-maher-navy lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
              className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
              aria-label="ফোন নম্বর নেই"
              className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
              title="ফোন নম্বর নেই"
              disabled
            >
              <MessageCircle />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="PDF শেয়ার"
            className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
            aria-label={
              isReturned(s.status)
                ? "ড্যামেজ ক্ষতি"
                : "ফেরত / ড্যামেজ ক্ষতি"
            }
            className="h-10 w-10 text-maher-money lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title={
              isReturned(s.status)
                ? "ড্যামেজ ক্ষতি"
                : "ফেরত / ড্যামেজ ক্ষতি"
            }
            onClick={() => setAdjustTarget(s)}
          >
            <Scale />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="এডিট"
            className="h-10 w-10 lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title={
              isReturned(s.status)
                ? "এডিট (বিল/জমা/অবস্থা লক থাকবে)"
                : "এডিট"
            }
            onClick={() => onEdit(s)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="ডিলিট"
            className="h-10 w-10 text-maher-due lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title="ডিলিট"
            onClick={() => setDeleteTarget(s)}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );

  /** Visit totals: one combined figure for the whole customer drop-off. */
  const visitTotals = (devices: ServiceDTO[]) => {
    let bill = 0;
    let advance = 0;
    let due = 0;
    let refund = 0;
    for (const device of devices) {
      bill += device.totalBill;
      advance += device.advance;
      due += device.due;
      refund += device.refundAmount;
    }
    return { bill, advance, due, refund };
  };

  /** A filtered visit keeps every device, so say how many actually matched. */
  const filterHint = (visit: Visit) =>
    visit.matched < visit.devices.length ? (
      <p
        data-testid="visit-filter-hint"
        className="mt-0.5 text-[11px] font-medium text-maher-money"
      >
        এই ফিল্টারে {toBnDigits(visit.matched)}টি ডিভাইস মিলেছে
      </p>
    ) : null;

  /**
   * Group rows stay neutral so the device lines read as the content. Only a
   * thin left accent survives the status/due colouring — enough to spot a
   * returned job or an unpaid visit when scanning the list.
   */
  const visitTone = (visit: Visit) =>
    visit.devices.some((d) => isReturned(d.status))
      ? "returned"
      : visit.devices.some((d) => d.due > 0)
        ? "due"
        : "normal";

  /** Ledger tone for one device row. */
  const rowTone = (s: ServiceDTO) =>
    isReturned(s.status) ? "returned" : s.due > 0 ? "due" : "normal";

  const toneEdge = (tone: string) =>
    tone === "returned"
      ? "border-l-[3px] border-l-maher-money"
      : tone === "due"
        ? "border-l-[3px] border-l-maher-due"
        : "border-l-[3px] border-l-transparent";

  const toneWash = (tone: string) =>
    tone === "returned"
      ? "bg-maher-money/5 hover:bg-maher-money/10"
      : tone === "due"
        ? "bg-maher-due/5 hover:bg-maher-due/10"
        : "hover:bg-maher-surface/70";

  /** Cards sit on the grey page, so the neutral tone needs its own paper. */
  const toneCard = (tone: string) =>
    tone === "returned"
      ? "bg-maher-money/5 hover:bg-maher-money/10"
      : tone === "due"
        ? "bg-maher-due/5 hover:bg-maher-due/10"
        : "bg-card hover:bg-maher-surface/70";

  const visitAccent = (visit: Visit) => toneEdge(visitTone(visit));

  const visitRowTint = () => "hover:bg-maher-surface/70";

  const visitCardTint = (visit: Visit) =>
    `border-maher-border bg-card ${visitAccent(visit)}`;

  /** One cell of the mobile receipt strip. */
  const moneyCell = (label: string, value: string, tone: string) => (
    <div className="min-w-0 px-2 py-1.5">
      <div className="text-[10px] font-medium text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-xs font-semibold tabular-nums ${tone}`}
      >
        {value}
      </div>
    </div>
  );

  /** The customer's money, printed once at the top of the visit block. */
  const visitMoney = (visit: Visit, layout: "stack" | "columns" = "stack") => {
    const totals = visitTotals(visit.devices);
    const rows = [
      { label: "বিল", value: totals.bill, tone: "text-foreground" },
      { label: "জমা", value: totals.advance, tone: "text-maher-done" },
      ...(totals.refund > 0
        ? [{ label: "ফেরত", value: totals.refund, tone: "text-maher-money" }]
        : []),
      {
        label: "বাকি",
        value: totals.due,
        tone: totals.due > 0 ? "text-maher-due" : "text-muted-foreground",
      },
    ];
    return (
      <div
        data-testid={
          layout === "columns"
            ? `money-strip-${visit.devices[0].id}`
            : `visit-total-${visit.devices[0].id}`
        }
        className={
          layout === "columns"
            ? `grid ${
                totals.refund > 0 ? "grid-cols-4" : "grid-cols-3"
              } divide-x divide-maher-border overflow-hidden rounded-lg border border-maher-border bg-maher-surface/40 tabular-nums`
            : "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs tabular-nums"
        }
      >
        {rows.map((row) =>
          layout === "columns" ? (
            <div key={row.label} className="min-w-0 px-2 py-1.5">
              <div className="text-[10px] font-medium text-muted-foreground">
                {row.label}
              </div>
              <div
                className={`mt-0.5 truncate text-xs font-semibold ${row.tone}`}
              >
                {formatTaka(row.value)}
              </div>
            </div>
          ) : (
            <div key={row.label} className={row.tone}>
              {row.label}{" "}
              <span className="font-semibold">{formatTaka(row.value)}</span>
            </div>
          )
        )}
      </div>
    );
  };

  /** One set of customer-level actions per visit: one bill, one chat, one PDF. */
  const renderVisitActions = (s: ServiceDTO) => (
    <div className="flex flex-wrap justify-end gap-1 print:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label="বিল প্রিন্ট"
        className="h-10 w-10 text-maher-navy lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
          className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
          aria-label="ফোন নম্বর নেই"
          className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
          title="ফোন নম্বর নেই"
          disabled
        >
          <MessageCircle />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="PDF শেয়ার"
        className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
    </div>
  );

  /** Per-device maintenance stays on each device line. */
  const renderDeviceActions = (s: ServiceDTO) => (
    <div className="flex flex-wrap justify-end gap-1 print:hidden">
      {showArchived ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="ফিরিয়ে আনুন"
          className="h-10 w-10 text-maher-done lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
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
            aria-label={
              isReturned(s.status) ? "ড্যামেজ ক্ষতি" : "ফেরত / ড্যামেজ ক্ষতি"
            }
            className="h-10 w-10 text-maher-money lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title={
              isReturned(s.status) ? "ড্যামেজ ক্ষতি" : "ফেরত / ড্যামেজ ক্ষতি"
            }
            onClick={() => setAdjustTarget(s)}
          >
            <Scale />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="এডিট"
            className="h-10 w-10 lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title={
              isReturned(s.status)
                ? "এডিট (বিল/জমা/অবস্থা লক থাকবে)"
                : "এডিট"
            }
            onClick={() => onEdit(s)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="ডিলিট"
            className="h-10 w-10 text-maher-due lg:h-6 lg:w-6 min-[1400px]:h-8 min-[1400px]:w-8"
            title="ডিলিট"
            onClick={() => setDeleteTarget(s)}
          >
            <Trash2 />
          </Button>
        </>
      )}
    </div>
  );

  const deviceCountBadge = (visit: Visit) => (
    <span
      data-testid={`visit-badge-${visit.devices[0].id}`}
      title="একই কাস্টমারের একাধিক ডিভাইস — বিল প্রিভিউতে সব ডিভাইস একসাথে দেখা যাবে"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-maher-surface px-1 py-0.5 font-sans text-[10px] font-semibold text-maher-navy"
    >
      <Users aria-hidden className="h-3 w-3 shrink-0" />
      {toBnDigits(visit.devices.length)}টি ডিভাইস
    </span>
  );

  /** Device position inside the visit: "ডিভাইস ১", "ডিভাইস ২" … */
  const deviceLabel = (index: number, id: number) => (
    <span
      data-testid={`visit-dev-num-${id}`}
      className="text-[11px] font-medium text-muted-foreground"
    >
      ডিভাইস {toBnDigits(index + 1)}
    </span>
  );

  /** Fold/unfold a multi-device visit. A filter pins it open and says why. */
  const collapseToggle = (visit: Visit) => {
    const open = !isCollapsed(visit);
    const id = visit.devices[0].id;
    return (
      <button
        type="button"
        data-testid={`visit-toggle-${id}`}
        aria-expanded={open}
        aria-controls={`visit-devices-${id}`}
        aria-label={open ? "ডিভাইসগুলো লুকান" : "ডিভাইসগুলো দেখান"}
        title={
          filterActive
            ? "ফিল্টার চলছে — সব ডিভাইস খোলা আছে"
            : open
              ? "ডিভাইসগুলো লুকান"
              : "ডিভাইসগুলো দেখান"
        }
        disabled={filterActive}
        onClick={() => toggleCollapsed(visit.key)}
        className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
    );
  };

  /** Each device keeps its own bill/paid/due, set small so the visit total
   *  above stays the headline figure. */
  const deviceMoney = (d: ServiceDTO) => (
    <div
      data-testid={`visit-dev-money-${d.id}`}
      className="text-[11px] leading-tight tabular-nums"
    >
      {renderMoney(d)}
    </div>
  );

  const renderSingleRow = (s: ServiceDTO) => (
    <TableRow
      key={s.id}
      data-tone={rowTone(s)}
      className={`group ${toneWash(rowTone(s))}`}
    >
      <TableCell
        className={`font-mono text-[13px] font-semibold tabular-nums ${toneEdge(
          rowTone(s)
        )}`}
      >
        <div>{s.id}</div>
        {groupBadge(s)}
      </TableCell>
      {showArchived ? (
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {dhakaDateKey(s.serviceDate)}
        </TableCell>
      ) : null}
      <TableCell>
        <div
          className="max-w-[8.5rem] truncate font-semibold text-foreground"
          title={s.customerName}
        >
          {s.customerName}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {s.phone}
        </div>
      </TableCell>
      <TableCell>
        <div className="font-medium">{s.model}</div>
        <div
          className="max-w-44 truncate text-xs text-muted-foreground"
          title={s.problem}
        >
          {s.problem}
        </div>
        {renderDelivery(s)}
      </TableCell>
      <TableCell>{renderStatus(s)}</TableCell>
      <TableCell className="whitespace-nowrap align-top text-sm">
        {renderMoney(s)}
      </TableCell>
      <TableCell className="align-top">{renderCost(s)}</TableCell>
      <TableCell className="sticky right-0 z-10 border-l border-maher-border bg-card px-1 group-hover:bg-maher-surface print:hidden">
        {renderActions(s)}
      </TableCell>
    </TableRow>
  );

  /**
   * One row per visit: a customer group header (ID, name, phone, device count,
   * fold control) with the visit's money, then one indented line per device so
   * each job keeps its own status, bill and balance.
   */
  const renderVisitRow = (visit: Visit) => {
    const first = visit.devices[0];
    const gridClass = deviceCols ? "" : DEVICE_GRID_FALLBACK;
    const open = !isCollapsed(visit);
    return (
      <TableRow
        key={visit.key}
        data-testid={`visit-row-${first.id}`}
        data-customer={visit.customerName}
        data-devices={visit.devices.length}
        data-tone={visitTone(visit)}
        className={`group ${visitRowTint()}`}
      >
        <TableCell
          className={`align-top font-mono font-semibold ${visitAccent(visit)}`}
        >
          <div className="flex items-center gap-1">
            <div data-testid={`visit-id-${first.id}`}>#{first.id}</div>
            {collapseToggle(visit)}
          </div>
          <div className="mt-0.5">{deviceCountBadge(visit)}</div>
        </TableCell>
        {showArchived ? (
          <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
            {dhakaDateKey(first.serviceDate)}
          </TableCell>
        ) : null}
        <TableCell className="align-top">
          <div
            className="max-w-[8.5rem] truncate font-medium"
            title={visit.customerName}
          >
            {visit.customerName}
          </div>
          <div className="text-xs text-muted-foreground">{visit.phone}</div>
          {filterHint(visit)}
        </TableCell>
        <TableCell colSpan={5} className="p-0 align-top">
          <div
            data-testid={`visit-summary-${first.id}`}
            className={`grid items-center border-b border-maher-border bg-maher-surface/40 ${gridClass}`}
            style={deviceGridStyle}
          >
            <div className="col-span-2 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
              ভিজিটের মোট
            </div>
            <div className="px-2 py-1.5">{visitMoney(visit)}</div>
            <div className="px-2 py-1" />
            <div className="px-2 py-1">
              {showArchived ? null : renderVisitActions(first)}
            </div>
          </div>
          {open ? (
            <div
              id={`visit-devices-${first.id}`}
              className={`grid ${gridClass}`}
              style={deviceGridStyle}
            >
              {visit.devices.map((d, index) => (
                <div
                  key={d.id}
                  data-testid={`visit-device-${d.id}`}
                  className={`col-span-full grid items-start border-b border-maher-border/60 bg-background/40 py-1.5 last:border-b-0 ${gridClass}`}
                  style={deviceGridStyle}
                >
                  <div className="min-w-0 px-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {deviceLabel(index, d.id)}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        #{d.id}
                      </span>
                      <span className="font-medium">{d.model}</span>
                    </div>
                    <div
                      className="mt-0.5 max-w-44 truncate text-xs text-muted-foreground"
                      title={d.problem}
                    >
                      {d.problem}
                    </div>
                    {renderDelivery(d)}
                  </div>
                  <div className="px-2">{renderStatus(d)}</div>
                  <div className="min-w-0 px-2">{deviceMoney(d)}</div>
                  <div className="px-2">{renderCost(d)}</div>
                  <div className="px-2">{renderDeviceActions(d)}</div>
                </div>
              ))}
            </div>
          ) : null}
        </TableCell>
      </TableRow>
    );
  };

  const renderSingleCard = (s: ServiceDTO) => (
    <article
      key={s.id}
      data-testid={`service-card-${s.id}`}
      data-customer={s.customerName}
      data-tone={rowTone(s)}
      className={`rounded-lg border p-3 ${toneEdge(rowTone(s))} ${toneCard(
        rowTone(s)
      )}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
              #{s.id}
            </span>
            {groupBadge(s)}
            {showArchived ? <span>{dhakaDateKey(s.serviceDate)}</span> : null}
          </div>
          <p
            className="mt-0.5 truncate text-[15px] font-semibold text-foreground"
            title={s.customerName}
          >
            {s.customerName}
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{s.phone}</p>
        </div>
        <div className="shrink-0 text-right">{renderStatus(s)}</div>
      </div>

      <div className="mt-2">
        <p className="break-words text-sm font-medium text-foreground">
          {s.model}
        </p>
        <p className="break-words text-xs text-muted-foreground">{s.problem}</p>
        {renderDelivery(s)}
      </div>

      <div
        data-testid={`money-strip-${s.id}`}
        className="mt-2 grid grid-cols-3 divide-x divide-maher-border overflow-hidden rounded-lg border border-maher-border bg-maher-surface/40"
      >
        {moneyCell("বিল", formatTaka(s.totalBill), "text-foreground")}
        {moneyCell("জমা", formatTaka(s.advance), "text-maher-done")}
        {isReturned(s.status)
          ? moneyCell("ফেরত", formatTaka(s.refundAmount), "text-maher-money")
          : moneyCell(
              "বাকি",
              formatTaka(s.due),
              s.due > 0 ? "text-maher-due" : "text-muted-foreground"
            )}
      </div>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs">
        <span className="text-[10px] font-medium text-muted-foreground">
          খরচ / পার্টস দোকান
        </span>
        <div className="min-w-0 text-right">{renderCost(s)}</div>
      </div>

      <div className="mt-2 border-t border-dashed border-maher-border pt-2">
        {renderActions(s)}
      </div>
    </article>
  );

  /** One mobile card per visit, same information order as the table row. */
  const renderVisitCard = (visit: Visit) => {
    const first = visit.devices[0];
    return (
      <article
        key={visit.key}
        data-testid={`visit-card-${first.id}`}
        data-customer={visit.customerName}
        data-devices={visit.devices.length}
        data-tone={visitTone(visit)}
        className={`rounded-lg border p-3 ${visitCardTint(visit)}`}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            data-testid={`visit-id-${first.id}`}
            className="font-mono font-semibold text-foreground"
          >
            #{first.id}
          </span>
          {collapseToggle(visit)}
          {deviceCountBadge(visit)}
          {showArchived ? <span>{dhakaDateKey(first.serviceDate)}</span> : null}
        </div>
        <p
          className="truncate font-semibold text-foreground"
          title={visit.customerName}
        >
          {visit.customerName}
        </p>
        <p className="text-xs text-muted-foreground">{visit.phone}</p>
        {filterHint(visit)}

        <div data-testid={`visit-summary-${first.id}`} className="mt-2">
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
            ভিজিটের মোট
          </p>
          {visitMoney(visit, "columns")}
        </div>

        {isCollapsed(visit) ? null : (
          <div id={`visit-devices-${first.id}`} className="mt-2">
            {visit.devices.map((d, index) => (
              <div
                key={d.id}
                data-testid={`visit-device-${d.id}`}
                className="border-t border-dashed border-maher-border pt-2 pb-1.5 first:border-t-0 first:pt-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {deviceLabel(index, d.id)}
                      <span className="font-mono text-[11px] text-muted-foreground">
                        #{d.id}
                      </span>
                      <span className="break-words text-sm font-medium text-foreground">
                        {d.model}
                      </span>
                    </div>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {d.problem}
                    </p>
                    {renderDelivery(d)}
                  </div>
                  <div className="shrink-0 text-right">{renderStatus(d)}</div>
                </div>
                <div className="mt-1">{deviceMoney(d)}</div>
                <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                  <div className="text-xs">{renderCost(d)}</div>
                  {renderDeviceActions(d)}
                </div>
              </div>
            ))}
          </div>
        )}

        {showArchived ? null : (
          <div className="mt-2 border-t border-maher-border pt-2">
            {renderVisitActions(first)}
          </div>
        )}
      </article>
    );
  };

  return (
    <section
      data-testid="daily-services"
      data-view={isDesktop ? "table" : "cards"}
      data-date={date}
      className="overflow-hidden rounded-xl border border-maher-border bg-card"
    >
      <div className="border-b border-maher-border px-4 py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-maher-ink">
              {showArchived ? (
                <>
                  <Archive className="h-4 w-4 text-muted-foreground" />
                  আর্কাইভ (মুছে ফেলা এন্ট্রি)
                </>
              ) : (
                <>
                  <ClipboardList className="h-4 w-4 text-maher-navy" />
                  সার্ভিস তালিকা
                </>
              )}
            </h2>
            <div
              data-testid="service-list-facts"
              className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              {showArchived ? (
                <span>আর্কাইভ করা সব তারিখের এন্ট্রি — ফিরিয়ে আনা যাবে।</span>
              ) : (
                <>
                  <span className="font-medium text-foreground/80">
                    {bengaliDateLabel(date)}
                  </span>
                  <span aria-hidden className="h-3 w-px bg-maher-border" />
                  <span>
                    <span className="font-semibold tabular-nums text-maher-ink">
                      {toBnDigits(visitsAll.length)}
                    </span>
                    টি ভিজিট
                  </span>
                  <span aria-hidden className="h-3 w-px bg-maher-border" />
                  <span>
                    <span className="font-semibold tabular-nums text-maher-ink">
                      {toBnDigits(techFiltered.length)}
                    </span>
                    টি ডিভাইস
                  </span>
                </>
              )}
            </div>
          </div>
          {!showArchived && onPrev && onNext && onDateChange && onToday ? (
            <ServiceDateNav
              date={date}
              onPrev={onPrev}
              onNext={onNext}
              onDateChange={onDateChange}
              onToday={onToday}
              isToday={date === dhakaDateKey(new Date())}
            />
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={showAllExpenses ? "default" : "outline"}
              size="sm"
              data-testid="expense-toggle"
              aria-pressed={showAllExpenses}
              aria-label={
                showAllExpenses ? "সব খরচ লুকান" : "সব খরচের টাকা দেখান"
              }
              title={
                showAllExpenses
                  ? "সব খরচ আবার লুকান"
                  : "এক ক্লিকে সব খরচের টাকা দেখান"
              }
              onClick={toggleAllExpenses}
              className="h-8 bg-white print:hidden"
            >
              {showAllExpenses ? (
                <EyeOff className="mr-1 h-4 w-4" />
              ) : (
                <Eye className="mr-1 h-4 w-4" />
              )}
              {showAllExpenses ? "খরচ লুকান" : "খরচ দেখান"}
            </Button>
            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              onClick={() => setShowArchived((v) => !v)}
              className="h-8 bg-white print:hidden"
            >
              <Archive className="mr-1 h-4 w-4" />
              {showArchived ? "তালিকায় ফিরুন" : "আর্কাইভ দেখুন"}
            </Button>
          </div>
          <div className="relative w-full sm:w-72 print:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="svc-search"
              placeholder="নাম, আইডি, ফোন বা মডেল খুঁজুন..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`h-9 bg-white pl-9 ${search ? "pr-9" : ""}`}
            />
            {search ? (
              <button
                type="button"
                data-testid="svc-search-clear"
                aria-label="খোঁজা মুছুন"
                title="খোঁজা মুছুন"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:bg-maher-surface-strong hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 py-3">
      {/* v1.1 filter notice. Deliberately NOT inside a `div.mb-3`: laneA's chip
          helper selects `div.mb-3 button` inside this section, so a status chip
          look-alike here would break that suite. */}
      {technicianFilter ? (
        <div
          data-testid="tech-filter-notice"
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-maher-border bg-maher-surface/40 px-3 py-2 text-sm text-maher-navy print:hidden"
        >
          <span className="flex items-center gap-1.5">
            <Search className="h-4 w-4 shrink-0" />
            শুধু <strong>{technicianFilter}</strong> এর কাজ দেখানো হচ্ছে
          </span>
          <Button size="sm" variant="outline" onClick={onClearTechnician}>
            ফিল্টার সরান
          </Button>
        </div>
      ) : null}

      {busy ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          {!showArchived ? (
            <div className="relative mb-3">
              <div
                data-testid="svc-status-tabs"
                className="-mx-1 overflow-x-auto px-1 print:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
              <div className="flex w-max min-w-full items-center gap-1.5">
                {(["All", ...STATUSES] as const).map((st) => {
                  const active = statusFilter === st;
                  const dot =
                    st === "All"
                      ? "bg-maher-ink"
                      : st === "Pending"
                        ? "bg-maher-due"
                        : st === "In-Progress"
                          ? "bg-maher-navy"
                          : st === "Completed"
                            ? "bg-maher-done"
                            : st === "Delivered"
                              ? "bg-slate-400"
                              : "bg-maher-money";
                  return (
                    <button
                      key={st}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setStatusFilter(st)}
                      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition ${
                        active
                          ? "border-maher-navy bg-maher-navy text-white shadow-sm"
                          : "border-maher-border bg-white text-foreground hover:border-maher-navy/40 hover:bg-maher-surface/60 hover:text-maher-navy"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`h-1.5 w-1.5 rounded-full ${
                          active ? "bg-white/80" : dot
                        }`}
                      />
                      <span>{st === "All" ? "সব" : STATUS_BN[st]}</span>
                      {" "}
                      <span
                        className={`tabular-nums ${
                          active ? "text-white/75" : "text-muted-foreground"
                        }`}
                      >
                        ({counts[st] ?? 0})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent sm:hidden"
              />
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-maher-border bg-maher-surface/30 py-12 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-maher-navy/10 text-maher-navy">
                <ClipboardList className="h-5 w-5" />
              </span>
              <p className="font-semibold text-foreground">
                {technicianFilter
                  ? showArchived
                    ? `${technicianFilter} এর কোনো আর্কাইভ করা কাজ নেই।`
                    : `আজ ${technicianFilter} এর কোনো কাজ নেই।`
                  : showArchived
                    ? "আর্কাইভ খালি।"
                    : "কোন সার্ভিস এন্ট্রি নেই। নতুন এন্ট্রি যোগ করুন।"}
              </p>
            </div>
          ) : isDesktop ? (
            <Table ref={tableRef}>
              <TableHeader>
                <TableRow className="border-y border-maher-border bg-maher-surface/60 hover:bg-maher-surface/60 [&_th]:h-9 [&_th]:whitespace-nowrap [&_th]:text-[11px] [&_th]:font-semibold [&_th]:text-muted-foreground">
                  <TableHead>ID</TableHead>
                  {showArchived ? <TableHead>তারিখ</TableHead> : null}
                  <TableHead>কাস্টমার</TableHead>
                  <TableHead>মডেল ও সমস্যা</TableHead>
                  <TableHead>অবস্থা</TableHead>
                  <TableHead>হিসাব (বিল/জমা/বাকি/ফেরত)</TableHead>
                  <TableHead>খরচ / পার্টস দোকান</TableHead>
                  <TableHead className="sticky right-0 z-10 border-l border-maher-border bg-maher-surface px-1 text-right print:hidden">
                    অ্যাকশন
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((visit) =>
                  visit.devices.length > 1
                    ? renderVisitRow(visit)
                    : renderSingleRow(visit.devices[0])
                )}
              </TableBody>
            </Table>
          ) : (
            <div
              className="grid grid-cols-1 items-start gap-2 md:grid-cols-2"
              data-testid="service-cards"
            >
              {filtered.map((visit) =>
                visit.devices.length > 1
                  ? renderVisitCard(visit)
                  : renderSingleCard(visit.devices[0])
              )}
            </div>
          )}
        </>
      )}
      </div>

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
                <span className="mt-2 block font-medium text-maher-due">
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
              className="bg-maher-due text-white hover:bg-maher-due-light"
            >
              {deleting ? "হচ্ছে…" : "আর্কাইভ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
