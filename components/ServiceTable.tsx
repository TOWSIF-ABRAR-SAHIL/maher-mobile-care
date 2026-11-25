"use client";

import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Archive,
  BadgeCheck,
  CalendarDays,
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
  Truck,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ServiceAdjustDialog } from "@/components/ServiceAdjustDialog";
import { ServiceConditionDialog } from "@/components/ServiceConditionDialog";
import { ServiceDateNav } from "@/components/ServiceDateNav";
import {
  ServiceSolutionDialog,
  type SolutionDialogMode,
} from "@/components/ServiceSolutionDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { StatusChips, type StatusFilter } from "@/components/StatusChips";
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
import { useShopSettings } from "@/components/ShopSettingsProvider";
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
import {
  encodeShopExpenseAmount,
  isShopExpenseCode,
} from "@/lib/expense-code";
import { dhakaDateKey } from "@/lib/dhaka";
import { latinDateLabel } from "@/lib/format";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ListMode, ServiceDTO } from "@/lib/types";

/** Uniform, low-noise click targets for every row action. */
const ROW_ACTION =
  "h-8 w-8 rounded-md text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10";

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
  listMode = "day",
  listRange,
  listTotal = null,
  listHasMore = false,
  onLoadMore,
  onModeChange,
  onRangeChange,
  onEdit,
  onReceipt,
  onPayment,
  onSharePdf,
  onChanged,
  technicianFilter,
  onClearTechnician,
  onPrev,
  onNext,
  onDateChange,
  onToday,
  initialStatus,
  onNewEntry,
}: {
  services: ServiceDTO[];
  loading: boolean;
  date: string;
  /** Date scope of the list; `day` (default) keeps the legacy single-day view. */
  listMode?: ListMode;
  listRange?: { from: string; to: string };
  /** Server count() over the whole window, or null in day mode. */
  listTotal?: number | null;
  listHasMore?: boolean;
  onLoadMore?: () => void;
  onModeChange?: (mode: ListMode) => void;
  onRangeChange?: (from: string, to: string) => void;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
  /** Opens the "টাকা নিন" dialog for this customer. */
  onPayment: (service: ServiceDTO) => void;
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
  /** Deep-link from the Service stage line (`/service?status=Pending`); `Due`
   *  also filters by outstanding money without changing a row's status. */
  initialStatus?: StatusFilter;
  /** Empty state offers the one action that fills it: start a new entry. */
  onNewEntry?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ServiceDTO | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<ServiceDTO | null>(null);
  // Work-done note, written from the list at handover or edited later.
  const [solutionTarget, setSolutionTarget] = useState<{
    service: ServiceDTO;
    mode: SolutionDialogMode;
  } | null>(null);
  // Customer terms are read-only here — clicking the marker shows the text.
  const [conditionTarget, setConditionTarget] = useState<ServiceDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ServiceDTO[]>([]);
  const [archLoading, setArchLoading] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);
  // Privacy: the খরচ column always shows the saved code. The header's
  // universal eye reveals every row at once (no timer) while a per-row eye
  // reveals only that row's taka amount for 10 seconds.
  const { cipher, settings: shopSettings } = useShopSettings();
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
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
    // Same rule as /api/services/dues: unpaid, not returned. A visit counts
    // once as soon as any of its devices still owes money.
    c.Due = visitsAll.filter((v) =>
      v.devices.some((d) => d.due > 0 && !isReturned(d.status))
    ).length;
    return c;
  }, [visitsAll]);

  /**
   * Filtering is visit-level: a match on any device keeps the whole visit so no
   * device of the same customer disappears. `matched` records how many devices
   * actually matched so the list can say so instead of silently hiding detail.
   *
   * The archived view hides the status chips, so a leftover status filter must
   * not silently hide archived rows — there would be no control to undo it.
   * Status therefore only applies to the live list.
   */
  const searchActive = search.trim().length > 0;
  const statusActive = !showArchived && statusFilter !== "All";
  /** Any active filter forces groups open so every match stays visible. */
  const filterActive = searchActive || statusActive;
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out: Visit[] = [];
    for (const visit of visitsAll) {
      let matched = visit.devices;
      if (statusActive) {
        matched = matched.filter((d) =>
          statusFilter === "Due"
            ? d.due > 0 && !isReturned(d.status)
            : d.status === statusFilter
        );
      }
      if (q) {
        matched = matched.filter((d) =>
          [
            d.customerName,
            String(d.id),
            d.phone,
            d.model,
            d.problem,
            d.customerAddress ?? "",
            d.warranty ?? "",
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
        );
      }
      if (matched.length > 0) out.push({ ...visit, matched: matched.length });
    }
    return out;
  }, [visitsAll, search, statusFilter, statusActive]);

  /**
   * Multi-date view only: fold the visible visits under one header per day so
   * a range/all list stays scannable. Day mode returns null — its table and
   * cards render exactly as they always have.
   */
  const dateSections = useMemo(() => {
    if (listMode === "day" || showArchived) return null;
    type Section = {
      key: string;
      dateKey: string;
      visits: Visit[];
      devices: number;
      bill: number;
    };
    const out: Section[] = [];
    const deviceCount = (visit: Visit) => visit.devices.length;
    const visitBill = (visit: Visit) =>
      visit.devices.reduce((sum, d) => sum + d.totalBill, 0);
    for (const visit of filtered) {
      const dateKey = dhakaDateKey(visit.devices[0].serviceDate);
      const last = out[out.length - 1];
      if (last && last.key === dateKey) {
        last.visits.push(visit);
        last.devices += deviceCount(visit);
        last.bill += visitBill(visit);
      } else {
        out.push({
          key: dateKey,
          dateKey,
          visits: [visit],
          devices: deviceCount(visit),
          bill: visitBill(visit),
        });
      }
    }
    return out;
  }, [filtered, listMode, showArchived]);

  /** One shared header for the desktop group row and the mobile divider. */
  const dateSectionHeader = (sec: {
    dateKey: string;
    visits: Visit[];
    devices: number;
    bill: number;
  }) => (
    <div
      data-testid="svc-date-section"
      data-date={sec.dateKey}
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-y border-slate-200/90 bg-slate-100/80 px-3 py-1.5 text-xs font-semibold text-slate-700"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-500" />
        <span className="font-semibold text-slate-800">
          {latinDateLabel(sec.dateKey)}
        </span>
        <span aria-hidden className="text-slate-400">
          •
        </span>
        <span className="text-slate-600">
          <span className="font-semibold tabular-nums text-slate-800">
            {sec.visits.length}
          </span>{" "}
          ভিজিট
        </span>
        <span aria-hidden className="text-slate-400">
          •
        </span>
        <span className="text-slate-600">
          <span className="font-semibold tabular-nums text-slate-800">
            {sec.devices}
          </span>{" "}
          ডিভাইস
        </span>
      </span>
      <span className="shrink-0 font-bold tabular-nums text-slate-700">
        {formatTaka(sec.bill)}
      </span>
    </div>
  );

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
      // minmax(0, …) keeps those px as the *maximum*: under intrinsic sizing
      // the track floors at 0, so the spanning cell no longer raises the
      // whole table's minimum width (it used to pin the table at whatever it
      // measured once, and the table then refused to shrink with its
      // container → sideways scroll). With a definite width the tracks still
      // resolve to exactly these px, so the device lines stay aligned.
      const next = widths
        .map((w) => `minmax(0,${Math.round(w * 100) / 100}px)`)
        .join(" ");
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

  /** One-click handover: ask for the work-done note first, then deliver.
   *  The dialog also offers "deliver only", so this never blocks the desk. */
  const deliver = (s: ServiceDTO) => {
    if (showArchived || isReturned(s.status) || s.status === "Delivered") return;
    setSolutionTarget({ service: s, mode: "deliver" });
  };

  /** Standalone note editor — usable before or long after handover. */
  const editSolution = (s: ServiceDTO) => {
    if (showArchived) return;
    setSolutionTarget({ service: s, mode: "note" });
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
    <div className="min-w-0 max-w-full">
      <div className="flex flex-col gap-1 items-start min-w-0 max-w-full">
        <button
          onClick={() => void advanceStatus(s)}
          aria-label={`অবস্থা বদলান: ${STATUS_BN[s.status as ServiceStatus] ?? s.status}`}
          title={
            s.status === "Delivered"
              ? "ডেলিভারি সম্পন্ন"
              : "ক্লিক করলে পরের অবস্থায় যাবে"
          }
          className="cursor-pointer whitespace-nowrap rounded-full transition hover:opacity-75 active:scale-95"
        >
          <StatusBadge status={s.status} />
        </button>
        {s.damageLoss > 0 ? (
          <div
            className="mt-1 max-w-full whitespace-normal break-words leading-tight text-xs font-bold text-amber-700"
            title={`ড্যামেজ ক্ষতি: ${formatTaka(s.damageLoss)}`}
          >
            ⚠️ ড্যামেজ ক্ষতি
          </div>
        ) : null}
      </div>
      {s.status === "Delivered" && s.due > 0 && !isReturned(s.status) ? (
        <div className="mt-1 max-w-full whitespace-normal break-words leading-tight text-xs font-bold text-maher-due-ink">
          ⚠️ টাকা বাকি
        </div>
      ) : null}
      {!isReturned(s.status) && s.due === 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
          <span
            data-testid={`svc-paid-${s.id}`}
            className="inline-flex max-w-full items-center gap-0.5 whitespace-normal break-words rounded-full bg-maher-done/10 px-1 py-0.5 text-maher-done"
            title="বাকি নেই (জমা সম্পূর্ণ)"
          >
            <BadgeCheck className="h-3 w-3 shrink-0" />
            পরিশোধিত
          </span>
        </div>
      ) : null}
      {!showArchived && !isReturned(s.status) && s.status !== "Delivered" ? (
        <button
          type="button"
          onClick={() => void deliver(s)}
          data-testid={`svc-deliver-${s.id}`}
          title="সরাসরি ডেলিভারি দিন"
          className="mt-1 inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded text-[11px] font-semibold text-maher-navy underline-offset-2 transition hover:text-maher-navy-light hover:underline"
        >
          <Truck className="h-3 w-3 shrink-0" />
          ডেলিভারি দিন
        </button>
      ) : null}
    </div>
  );

  /** Expected handover date; turns red once the day has passed. The wording
   *  is fixed — only the presentation became a tone pill. */
  const renderDelivery = (s: ServiceDTO) => {
    if (s.deliveredAt) {
      return (
        <div className="mt-1 inline-flex whitespace-nowrap rounded bg-maher-done/10 px-1.5 py-0.5 text-[11px] font-semibold text-maher-done">
          ✅ ডেলিভারি: {dhakaDateKey(s.deliveredAt)}
        </div>
      );
    }
    if (!s.deliveryDate) return null;
    const key = dhakaDateKey(s.deliveryDate);
    const overdue = key < dhakaDateKey(new Date()) && !isReturned(s.status);
    return (
      <div
        className={`mt-1 inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${
          overdue
            ? "bg-maher-due/10 font-semibold text-maher-due"
            : "bg-maher-surface text-muted-foreground"
        }`}
        title={`ডেলিভারি: ${key}`}
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
        className="min-w-[7.5rem] space-y-0.5 rounded-md bg-white/70 px-1.5 py-1 tabular-nums shadow-[0_1px_1px_rgba(15,23,42,0.04)]"
      >
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">বিল:</span>
          <span className="text-[13px] font-semibold text-slate-900">
            {formatTaka(s.totalBill)}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-semibold text-slate-500">জমা:</span>
          <span className="text-[13px] font-semibold text-maher-done">
            {formatTaka(s.advance)}
          </span>
        </div>
        <div className="flex items-baseline gap-1.5 border-t border-dashed border-slate-200 pt-0.5">
          <span className="text-[10px] font-semibold text-slate-500">বাকি:</span>
          <span
            className={`text-[13px] font-semibold ${
              s.due > 0 ? "text-maher-due-ink" : "text-slate-600"
            }`}
          >
            {formatTaka(s.due)}
          </span>
        </div>
        {returned ? (
          <div className="flex items-baseline gap-1.5 text-[10px] text-maher-money">
            <span className="font-semibold">ফেরত:</span>
            <span className="font-semibold">{formatTaka(s.refundAmount)}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const renderCost = (s: ServiceDTO) => {
    // A device with itemized parts reports their sum as its repair cost; the
    // shop-expense code stays on the row for audit but never counts. Both are
    // internal money, so both hide behind the same reveal controls — a
    // parts-only row has no shopExpense string but still needs its eye + codes.
    const partsCost = s.partsCost ?? null;
    const hasParts = partsCost !== null;
    if (!s.shopExpense && !s.partsShop && !hasParts && s.damageLoss <= 0) {
      return <span className="text-muted-foreground">—</span>;
    }
    const amountVisible = showAllExpenses || !!revealedExpenses[s.id];
    const shownAmount = hasParts ? partsCost : s.expenseAmount;
    // Codes are safe to show; the decoded taka (parts total included) only
    // appears behind the row eye or the header's reveal-all toggle. Legacy
    // parts rows saved before price auto-encoding have no stored code — derive
    // the same canonical code from unitCost (as the backfill script does) so
    // the list always shows a code, never a raw legacy amount.
    const parts = s.parts ?? [];
    const partLines = parts.map((part) => {
      let code: string | null = null;
      if (part.priceCode && isShopExpenseCode(part.priceCode, cipher)) {
        code = part.priceCode;
      } else {
        try {
          code = encodeShopExpenseAmount(part.unitCost, cipher);
        } catch {
          code = null;
        }
      }
      return { part, code };
    });
    const partCodes = partLines
      .map((line) => line.code)
      .filter((code): code is string => !!code);
    const hasCostCode = !!s.shopExpense || hasParts;

    return (
      <div className="space-y-0.5">
        {hasParts ? (
          <div data-testid={`parts-block-${s.id}`} className="space-y-1">
            <span
              data-testid={`parts-cost-${s.id}`}
              className="inline-flex items-center gap-1 rounded bg-maher-navy/10 px-1.5 py-0.5 text-[10px] font-semibold text-maher-navy"
              title="এই ডিভাইসের পার্টস খরচ — রিপোর্টে যোগ হয়, রিসিটে নয়"
            >
              পার্টস{parts.length > 1 ? ` (${parts.length})` : ""}
              {amountVisible ? ` ${formatTaka(shownAmount)}` : " ••••"}
            </span>
            {/* More than one part used to spill out as a bare run of codes with
                no name or quantity, so the row was impossible to read. Give
                every part its own aligned line: name × quantity on the left,
                its safe price code on the right. Taka stays behind the eye. */}
            {parts.length > 1 ? (
              <ul
                data-testid={`parts-lines-${s.id}`}
                className="max-w-[12rem] space-y-0.5 rounded-md border border-maher-border/80 bg-maher-surface/50 px-1.5 py-1 text-left"
              >
                {partLines.map(({ part, code }, index) => (
                  <li
                    key={part.id ?? index}
                    data-testid={`parts-line-${s.id}-${index}`}
                    className="flex items-baseline justify-between gap-1.5 text-[10px] leading-tight"
                    title={part.name}
                  >
                    <span className="min-w-0 truncate text-muted-foreground">
                      {part.name}
                      {part.quantity > 1 ? ` ×${part.quantity}` : ""}
                    </span>
                    <span
                      data-testid={`parts-code-${s.id}-${index}`}
                      className="shrink-0 font-mono font-medium text-maher-navy"
                      title="পার্টসের দামের গোপন কোড"
                    >
                      {code ?? "৳••••"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {hasCostCode ? (
          <div className="flex flex-wrap items-center gap-1 font-medium">
            {s.shopExpense ? (
              /* A legacy plain number is the real amount, so never print it. */
              <span
                data-testid={`expense-code-${s.id}`}
                className="font-mono"
              >
                {isShopExpenseCode(s.shopExpense, cipher)
                  ? s.shopExpense
                  : "৳••••"}
              </span>
            ) : null}
            {parts.length <= 1
              ? partCodes.map((code, index) => (
                  <span
                    key={index}
                    data-testid={`parts-code-${s.id}-${index}`}
                    className="font-mono text-maher-navy"
                    title="পার্টসের দামের গোপন কোড"
                  >
                    {code}
                  </span>
                ))
              : null}
            {parts.length <= 1 && !s.shopExpense && partCodes.length === 0 ? (
              <span
                data-testid={`expense-code-${s.id}`}
                className="font-mono text-muted-foreground"
              >
                ৳••••
              </span>
            ) : null}
            {hasParts && s.shopExpense ? (
              <span
                className="rounded bg-maher-border px-1 py-0.5 text-[10px] font-semibold text-muted-foreground"
                title="খরচ হিসাবে পার্টস ধরা হবে; কোডটি শুধু অডিটে থাকবে"
              >
                বাদ
              </span>
            ) : null}
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
              className="rounded p-0.5 text-muted-foreground transition hover:bg-maher-border/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
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
                {formatTaka(shownAmount)}
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
    <div className="flex flex-wrap justify-end gap-1 lg:grid lg:grid-cols-[repeat(4,2rem)] lg:gap-1 min-[1400px]:flex min-[1400px]:flex-nowrap min-[1400px]:gap-1 print:hidden">
      {showArchived ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="ফিরিয়ে আনুন"
          className={ROW_ACTION}
          title="ফিরিয়ে আনুন"
          disabled={restoring === s.id}
          onClick={() => void restore(s.id)}
        >
          <RotateCcw />
        </Button>
      ) : (
        <>
          {s.due > 0 && !isReturned(s.status) ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="টাকা নিন"
              data-testid={`take-payment-${s.id}`}
              className={ROW_ACTION}
              title="টাকা নিন"
              onClick={() => onPayment(s)}
            >
              <Wallet />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            aria-label="বিল প্রিন্ট"
            className={ROW_ACTION}
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
              className={ROW_ACTION}
              title="WhatsApp (chat/call)"
            >
              <a
                href={whatsAppHref(s, shopSettings.shopName)}
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
              className={ROW_ACTION}
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
            className={ROW_ACTION}
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
            className={ROW_ACTION}
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
            className={ROW_ACTION}
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
            className={ROW_ACTION}
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
      // Returned devices keep their original figures for audit only; a fee
      // return's retained fee is the live bill and its advance is no longer
      // held. Mirror the receipt totals so the daily list never overstates a
      // group after a refund/transfer.
      const returned = device.status === "Returned";
      bill += returned ? device.inspectionFee ?? 0 : device.totalBill;
      advance += returned ? 0 : device.advance;
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
        এই ফিল্টারে {visit.matched}টি ডিভাইস মিলেছে
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
        tone: totals.due > 0 ? "text-maher-due-ink" : "text-muted-foreground",
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
      {s.due > 0 && !isReturned(s.status) ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label="টাকা নিন"
          data-testid={`take-payment-visit-${s.id}`}
          className={ROW_ACTION}
          title="টাকা নিন"
          onClick={() => onPayment(s)}
        >
          <Wallet />
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label="বিল প্রিন্ট"
        className={ROW_ACTION}
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
          className={ROW_ACTION}
          title="WhatsApp (chat/call)"
        >
          <a
            href={whatsAppHref(s, shopSettings.shopName)}
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
          className={ROW_ACTION}
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
        className={ROW_ACTION}
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
          className={ROW_ACTION}
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
            className={ROW_ACTION}
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
            className={ROW_ACTION}
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
            className={ROW_ACTION}
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
      {visit.devices.length}টি ডিভাইস
    </span>
  );

  /** Device position inside the visit: "ডিভাইস ১", "ডিভাইস ২" … */
  const deviceLabel = (index: number, id: number) => (
    <span
      data-testid={`visit-dev-num-${id}`}
      className="text-[11px] font-medium text-muted-foreground"
    >
      ডিভাইস {index + 1}
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

  /** Tiny internal markers: the work-done note is now tappable (write it at
   *  handover, or edit it later), while visit terms stay read-only. In a
   *  grouped visit every device has its own button; `deviceNumber` puts the
   *  1-based device index on the chip so they cannot be confused. */
  const noteMarkers = (s: ServiceDTO, deviceNumber?: number) => {
    const numbered = typeof deviceNumber === "number" && deviceNumber > 0;
    const which = numbered ? `ডিভাইস ${deviceNumber} · ` : "";
    const chip = s.solution
      ? `সমাধান${numbered ? ` ${deviceNumber}` : ""}`
      : `+ সমাধান${numbered ? ` ${deviceNumber}` : ""}`;
    return s.solution || s.condition || !showArchived ? (
      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-semibold">
        {showArchived ? (
          s.solution ? (
            <span
              data-testid={`svc-solution-marker-${s.id}`}
              data-marker="solution"
              title={s.solution}
              className="rounded-full border border-maher-navy/25 bg-maher-blue-soft px-1.5 py-0.5 text-maher-navy"
            >
              {chip}
            </span>
          ) : null
        ) : (
          <button
            type="button"
            data-testid={`svc-solution-marker-${s.id}`}
            data-marker="solution"
            title={
              s.solution
                ? `${which}সমাধান: ${s.solution} — এডিট করতে ক্লিক করুন`
                : `${which}কী করা হলো (সমাধান) লিখুন`
            }
            aria-label={
              s.solution
                ? `সমাধান এডিট করুন: ${which}${s.customerName} (${s.model})`
                : `সমাধান লিখুন: ${which}${s.customerName} (${s.model})`
            }
            onClick={() => editSolution(s)}
            className="rounded-full border border-maher-navy/25 bg-maher-blue-soft px-1.5 py-0.5 text-maher-navy transition-colors hover:border-maher-navy/50 hover:bg-maher-navy/10 print:hidden"
          >
            {chip}
          </button>
        )}
        {s.condition ? (
          <button
            type="button"
            data-testid={`svc-condition-marker-${s.id}`}
            data-marker="condition"
            title={`শর্ত: ${s.condition} — দেখতে ক্লিক করুন`}
            aria-label={`কাস্টমারের শর্ত দেখুন: ${s.customerName} (${s.model})`}
            onClick={() => setConditionTarget(s)}
            className="rounded-full border border-maher-border bg-maher-surface px-1.5 py-0.5 text-muted-foreground transition-colors hover:border-maher-navy/35 hover:bg-maher-blue-soft hover:text-maher-navy print:hidden"
          >
            শর্ত আছে
          </button>
        ) : null}
      </div>
    ) : null;
  };

  const renderSingleRow = (s: ServiceDTO) => (
    <TableRow
      key={s.id}
      data-tone={rowTone(s)}
      className={`group ${toneWash(rowTone(s))}`}
    >
      {/* Every cell hangs from the top edge: money/cost already did, so the
          four-line model cell used to pull the status and customer columns
          out of line with their own money column. */}
      <TableCell
        className={`align-top font-mono text-[13px] font-semibold tabular-nums ${toneEdge(
          rowTone(s)
        )}`}
      >
        <div>{s.id}</div>
        {/* Kept for screen readers and row text; visually hidden so the ID
            column sizes to the id itself, not to a badge. */}
        <div className="sr-only">{groupBadge(s)}</div>
      </TableCell>
      {showArchived ? (
        <TableCell className="whitespace-nowrap align-top text-sm text-muted-foreground">
          {dhakaDateKey(s.serviceDate)}
        </TableCell>
      ) : null}
      <TableCell className="align-top">
        <div
          className="max-w-[8.5rem] truncate text-[13px] font-semibold text-foreground"
          title={s.customerName}
        >
          {s.customerName}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {s.phone}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="text-[13px] font-medium text-maher-ink">{s.model}</div>
        <div
          className="max-w-44 truncate text-xs text-muted-foreground"
          title={s.problem}
        >
          {s.problem}
        </div>
        {noteMarkers(s)}
        {/* Searchable-only context: both fields can drive the list filter
            without widening the measured single-row grid. */}
        {s.customerAddress || s.warranty ? (
          <span className="sr-only">
            {s.customerAddress ?? ""} {s.warranty ?? ""}
          </span>
        ) : null}
        {renderDelivery(s)}
      </TableCell>
      <TableCell className="align-top">{renderStatus(s)}</TableCell>
      <TableCell className="whitespace-nowrap align-top text-sm">
        {renderMoney(s)}
      </TableCell>
      <TableCell className="align-top">{renderCost(s)}</TableCell>
      <TableCell className="sticky right-0 z-10 align-top border-l border-maher-border bg-card px-0.5 group-hover:bg-maher-surface print:hidden">
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
          {/* Same device-count badge, screen-reader only: it used to set the
              width of the ID column for grouped visits. */}
          <div className="sr-only">{deviceCountBadge(visit)}</div>
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
            {/* Sticky like the single-row action cell: the device grid spans
                the whole table, so without this the grouped actions would
                scroll away while single rows keep theirs pinned. */}
            {showArchived ? (
              <div className="px-2 py-1" />
            ) : (
              <div className="sticky right-0 z-10 bg-card px-2 py-1 group-hover:bg-maher-surface">
                {renderVisitActions(first)}
              </div>
            )}
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
                    {noteMarkers(
                      d,
                      visit.devices.length > 1 ? index + 1 : undefined
                    )}
                    {/* Searchable-only visit context: keeps the 340px panel
                        and the measured grid completely unchanged. */}
                    {d.customerAddress || d.warranty ? (
                      <span className="sr-only">
                        {d.customerAddress ?? ""} {d.warranty ?? ""}
                      </span>
                    ) : null}
                    {renderDelivery(d)}
                  </div>
                  <div className="px-1">{renderStatus(d)}</div>
                  <div className="min-w-0 px-2">{deviceMoney(d)}</div>
                  <div className="px-2">{renderCost(d)}</div>
                  <div className="sticky right-0 z-10 bg-card px-2 group-hover:bg-maher-surface">
                    {renderDeviceActions(d)}
                  </div>
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
        {noteMarkers(s)}
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
              s.due > 0 ? "text-maher-due-ink" : "text-muted-foreground"
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
                    {noteMarkers(
                      d,
                      visit.devices.length > 1 ? index + 1 : undefined
                    )}
                    {/* Searchable-only visit context: keeps the 340px panel
                        and the measured grid completely unchanged. */}
                    {d.customerAddress || d.warranty ? (
                      <span className="sr-only">
                        {d.customerAddress ?? ""} {d.warranty ?? ""}
                      </span>
                    ) : null}
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
      data-mode={listMode}
      className="overflow-hidden rounded-xl border border-maher-border bg-card shadow-card sheen"
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
              {!showArchived ? (
                <>
                  <span className="font-medium text-foreground/80">
                    {listMode === "day"
                      ? latinDateLabel(date)
                      : listMode === "all"
                        ? "সব তারিখ"
                        : `${latinDateLabel(listRange?.from ?? date)} – ${latinDateLabel(listRange?.to ?? date)}`}
                  </span>
                  <span aria-hidden className="h-3 w-px bg-maher-border" />
                  <span>
                    <span className="font-semibold tabular-nums text-maher-ink">
                      {visitsAll.length}
                    </span>
                    টি ভিজিট
                  </span>
                  <span aria-hidden className="h-3 w-px bg-maher-border" />
                  <span>
                    <span className="font-semibold tabular-nums text-maher-ink">
                      {techFiltered.length}
                    </span>
                    টি ডিভাইস
                  </span>
                  {listMode !== "day" && listTotal != null ? (
                    <>
                      <span aria-hidden className="h-3 w-px bg-maher-border" />
                      <span>
                        মোট{" "}
                        <span className="font-semibold tabular-nums text-maher-ink">
                          {listTotal}
                        </span>
                        টি
                      </span>
                    </>
                  ) : null}
                  {filterActive ? (
                    <>
                      <span aria-hidden className="h-3 w-px bg-maher-border" />
                      <span
                        data-testid="filter-count"
                        className="font-medium text-maher-navy"
                      >
                        দেখানো{" "}
                        <span className="font-semibold tabular-nums">
                          {filtered.length}/{visitsAll.length}
                        </span>{" "}
                        ভিজিট,{" "}
                        <span className="font-semibold tabular-nums">
                          {filtered.reduce((sum, v) => sum + v.matched, 0)}/
                          {visitsAll.reduce(
                            (sum, v) => sum + v.devices.length,
                            0
                          )}
                        </span>{" "}
                        ডিভাইস
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
          {!showArchived && onPrev && onNext && onDateChange && onToday ? (
            <div className="flex min-w-0 flex-col items-start gap-1.5 lg:items-end print:hidden">
              <div
                data-testid="svc-date-mode"
                role="group"
                aria-label="তারিখ দেখার মোড"
                className="inline-flex h-10 max-w-full flex-nowrap items-center rounded-lg border border-slate-200/80 bg-white p-0.5 shadow-sm"
              >
                {(
                  [
                    ["day", "একদিন"],
                    ["range", "তারিখ রেঞ্জ"],
                    ["all", "সব তারিখ"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={listMode === mode}
                    onClick={() => onModeChange?.(mode)}
                    className={`h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10 ${
                      listMode === mode
                        ? "bg-maher-navy text-white shadow-sm"
                        : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex h-10 w-full min-w-0 items-center justify-end gap-1.5 print:hidden">
                {listMode === "day" ? (
                  <ServiceDateNav
                    date={date}
                    onPrev={onPrev}
                    onNext={onNext}
                    onDateChange={onDateChange}
                    onToday={onToday}
                    isToday={date === dhakaDateKey(new Date())}
                  />
                ) : listMode === "range" ? (
                  <div
                    data-testid="svc-range-inputs"
                    className="flex h-10 items-center gap-1.5"
                  >
                    <label className="sr-only" htmlFor="svc-range-from">
                      শুরুর তারিখ
                    </label>
                    <Input
                      id="svc-range-from"
                      data-testid="svc-range-from"
                      type="date"
                      aria-label="শুরুর তারিখ"
                      value={listRange?.from ?? ""}
                      max={listRange?.to}
                      onChange={(e) =>
                        e.target.value &&
                        onRangeChange?.(e.target.value, listRange?.to ?? e.target.value)
                      }
                      className="h-9 w-[148px] rounded-lg border-slate-200/80 bg-white text-xs text-slate-700 shadow-sm focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
                    />
                    <span aria-hidden className="text-muted-foreground">
                      –
                    </span>
                    <label className="sr-only" htmlFor="svc-range-to">
                      শেষের তারিখ
                    </label>
                    <Input
                      id="svc-range-to"
                      data-testid="svc-range-to"
                      type="date"
                      aria-label="শেষের তারিখ"
                      value={listRange?.to ?? ""}
                      min={listRange?.from}
                      onChange={(e) =>
                        e.target.value &&
                        onRangeChange?.(listRange?.from ?? e.target.value, e.target.value)
                      }
                      className="h-9 w-[148px] rounded-lg border-slate-200/80 bg-white text-xs text-slate-700 shadow-sm focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
                    />
                  </div>
                ) : (
                  <div className="flex h-10 items-center gap-1.5 text-xs font-medium text-slate-500">
                    <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                    সব তারিখের এন্ট্রি একসাথে দেখানো হচ্ছে
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {/* Never hard-code `bg-white` on a toggle whose variant flips to
                `default`: the white background wins over the navy fill, and
                white text on white made the pressed button look vanished. */}
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
              className="h-9 print:hidden focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
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
              className="h-9 print:hidden focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
            >
              <Archive className="mr-1 h-4 w-4" />
              {showArchived ? "তালিকায় ফিরুন" : "আর্কাইভ দেখুন"}
            </Button>
          </div>
          <div className="relative w-full sm:w-72 print:hidden">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="svc-search"
              data-scope="local"
              aria-label="এই তালিকার মধ্যে খুঁজুন (লোকাল ফিল্টার)"
              title="শুধু এই তালিকায় দেখা এন্ট্রি খুঁজবে — নাম, আইডি, ফোন, মডেল বা সমস্যা | সব তারিখের জন্য উপরের হেডার সার্চ ব্যবহার করুন"
              placeholder="এই তালিকায় খুঁজুন..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-lg border-slate-200/80 bg-white pl-9 pr-9 text-slate-700 shadow-sm placeholder:text-slate-400 focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10"
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
            <StatusChips
              testid="svc-status-tabs"
              counts={counts}
              value={statusFilter}
              onChange={setStatusFilter}
            />
          ) : null}
          {!showArchived && listMode !== "day" && listTotal != null ? (
            <div
              data-testid="list-cap-notice"
              className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-maher-border bg-maher-surface/40 px-3 py-2 text-xs text-muted-foreground print:hidden"
            >
              <span>
                মোট <b className="tabular-nums text-foreground">{listTotal}</b> · দেখানো{" "}
                <b className="tabular-nums text-foreground">{services.length}</b>
                {listMode === "all" ? " (সব তারিখ)" : " (এই রেঞ্জে)"}
              </span>
              {listHasMore && onLoadMore ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 bg-white"
                  onClick={onLoadMore}
                  disabled={loading}
                >
                  আরও দেখুন
                </Button>
              ) : null}
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 py-12 text-center shadow-sm">
              <ClipboardList className="h-6 w-6 text-slate-300" aria-hidden />
              {technicianFilter || showArchived || filterActive ? (
                <p className="font-semibold text-slate-700">
                  {technicianFilter
                    ? showArchived
                      ? `${technicianFilter} এর কোনো আর্কাইভ করা কাজ নেই।`
                      : `আজ ${technicianFilter} এর কোনো কাজ নেই।`
                    : showArchived
                      ? filterActive
                        ? "খোঁজের সাথে মিলে এমন কোন সার্ভিস এন্ট্রি নেই।"
                        : "আর্কাইভ খালি।"
                      : searchActive && statusActive
                        ? "খোঁজ ও অবস্থার সাথে মিলে এমন কোন সার্ভিস এন্ট্রি নেই।"
                        : statusActive
                          ? "এই ফিল্টারে কোন সার্ভিস এন্ট্রি নেই।"
                          : "খোঁজের সাথে মিলে এমন কোন সার্ভিস এন্ট্রি নেই।"}
                </p>
              ) : (
                <button
                  type="button"
                  data-testid="empty-new-entry"
                  onClick={onNewEntry}
                  className="max-w-sm rounded px-2 py-1 text-sm font-medium leading-relaxed text-slate-600 underline-offset-4 transition-colors hover:text-slate-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10"
                >
                  কোন সার্ভিস এন্ট্রি পাওয়া যায়নি — বাম পাশের ফর্ম থেকে নতুন সার্ভিস এন্ট্রি করুন।
                </button>
              )}
              {filterActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="empty-clear-filters"
                  title="খোঁজ ও অবস্থার ফিল্টার সরিয়ে সব এন্ট্রি দেখুন"
                  onClick={clearFilters}
                >
                  <X className="mr-1 h-4 w-4" />
                  ফিল্টার সরান
                </Button>
              ) : null}
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
                  <TableHead className="sticky right-0 z-10 border-l border-maher-border bg-maher-surface px-0.5 text-right print:hidden">
                    অ্যাকশন
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dateSections
                  ? dateSections.map((sec) => (
                      <Fragment key={sec.key}>
                        <TableRow
                          data-testid="svc-date-row"
                          data-date={sec.dateKey}
                          className="hover:bg-transparent"
                        >
                          {/* 7 live columns; the archived view never groups. */}
                          <TableCell
                            colSpan={7}
                            className="border-b-maher-border bg-maher-surface/70 p-0"
                          >
                            {dateSectionHeader(sec)}
                          </TableCell>
                        </TableRow>
                        {sec.visits.map((visit) =>
                          visit.devices.length > 1
                            ? renderVisitRow(visit)
                            : renderSingleRow(visit.devices[0])
                        )}
                      </Fragment>
                    ))
                  : filtered.map((visit) =>
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
              {dateSections
                ? dateSections.map((sec) => (
                    <Fragment key={sec.key}>
                      <div className="rounded-lg border border-maher-border bg-maher-surface/70 md:col-span-2">
                        {dateSectionHeader(sec)}
                      </div>
                      {sec.visits.map((visit) =>
                        visit.devices.length > 1
                          ? renderVisitCard(visit)
                          : renderSingleCard(visit.devices[0])
                      )}
                    </Fragment>
                  ))
                : filtered.map((visit) =>
                    visit.devices.length > 1
                      ? renderVisitCard(visit)
                      : renderSingleCard(visit.devices[0])
                  )}
            </div>
          )}
        </>
      )}
      </div>

      {solutionTarget ? (
        <ServiceSolutionDialog
          key={`${solutionTarget.service.id}-${solutionTarget.mode}`}
          service={solutionTarget.service}
          mode={solutionTarget.mode}
          // A closing dialog can fire onOpenChange(false) a tick late. Only
          // clear the state if it still belongs to *this* dialog, otherwise
          // opening another row immediately afterwards would close it too.
          onClose={() =>
            setSolutionTarget((prev) =>
              prev?.service.id === solutionTarget.service.id &&
              prev.mode === solutionTarget.mode
                ? null
                : prev
            )
          }
          onChanged={onChanged}
        />
      ) : null}

      {conditionTarget ? (
        <ServiceConditionDialog
          key={conditionTarget.id}
          service={conditionTarget}
          onClose={() =>
            setConditionTarget((prev) =>
              prev?.id === conditionTarget.id ? null : prev
            )
          }
        />
      ) : null}

      {adjustTarget ? (
        <ServiceAdjustDialog
          key={adjustTarget.id}
          service={adjustTarget}
          productLines={
            (adjustTarget.entryKind === "PRODUCT"
              ? (adjustTarget.saleItems ?? [])
              : services.find(
                  (s) =>
                    s.groupId === adjustTarget.groupId &&
                    s.entryKind === "PRODUCT" &&
                    !s.archived
                )?.saleItems ?? []
            ).map((line) => ({ id: line.id, name: line.name }))
          }
          siblings={
            !adjustTarget.groupId
              ? []
              : services
                  .filter(
                    (s) =>
                      s.id !== adjustTarget.id &&
                      s.groupId === adjustTarget.groupId &&
                      !s.archived &&
                      s.entryKind !== "PRODUCT" &&
                      !isReturned(s.status)
                  )
                  .map((s) => ({
                    id: s.id,
                    model: s.model,
                    advance: s.advance,
                    due: s.due,
                  }))
          }
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
