"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadPartShopNames,
  mergePartShopNames,
  savePartShopName,
} from "@/lib/part-shops";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { ClipboardList, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAppHeader } from "@/components/AppChrome";
import { MonthlySummary } from "@/components/MonthlySummary";
import { PaymentDialog } from "@/components/PaymentDialog";
import { Receipt, ReceiptBundle, ReceiptDialog } from "@/components/Receipt";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { ServiceForm } from "@/components/ServiceForm";
import { ServiceTable } from "@/components/ServiceTable";
import { ShopFooter } from "@/components/ShopFooter";
import { dhakaDateKey, dayLabel, monthContaining, shiftDateKey, shiftMonth } from "@/lib/dhaka";
import { cn, formatTaka, STATUSES, type ServiceStatus } from "@/lib/utils";
import type {
  ListMode,
  MonthlyResponse,
  RangeMode,
  ServiceDTO,
  ServicesListResponse,
  StatsResponse,
} from "@/lib/types";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "লোড করা যায়নি");
  return data as T;
}

type MobileTab = "list" | "form";

export function ServiceWorkspace({
  initialDate,
  initialEditId,
  initialReceiptId,
  initialStatus,
  initialProductMode,
  initialServiceMode,
}: {
  initialDate?: string;
  initialEditId?: number;
  initialReceiptId?: number;
  initialStatus?: string;
  initialProductMode?: boolean;
  initialServiceMode?: boolean;
}) {
  const { settings: shopSettings } = useShopSettings();
  const [date, setDate] = useState(
    () => initialDate || dhakaDateKey(new Date())
  );
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [receipt, setReceipt] = useState<ServiceDTO | null>(null);
  const [receiptGroup, setReceiptGroup] = useState<ServiceDTO[] | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<ServiceDTO | null>(null);
  const receiptGroupReq = useRef(0);
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [partsShops, setPartsShops] = useState<string[]>([]);
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // Deep links that explicitly open the entry form land on the form tab on
  // phones instead of showing the list first.
  const [mobileTab, setMobileTab] = useState<MobileTab>(
    initialProductMode || initialServiceMode ? "form" : "list"
  );
  const formRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef(date);
  const paramsConsumed = useRef(false);
  const reqId = useRef(0);
  const monthlyReq = useRef(0);
  const loadedOnce = useRef(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dateRef.current = date;
  }, [date]);

  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling30");
  const [range, setRange] = useState(() => {
    const start = initialDate || dhakaDateKey(new Date());
    return { from: shiftDateKey(start, -29), to: start };
  });
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  /**
   * Report scope — deliberately independent of the list's scope. It starts on
   * তারিখ রেঞ্জ (the report has always opened there); একদিন and সব তারিখ are
   * chosen inside the dialog and never move the list beside it.
   */
  const [reportMode, setReportMode] = useState<ListMode>("range");
  const reportModeRef = useRef(reportMode);
  useEffect(() => {
    reportModeRef.current = reportMode;
  }, [reportMode]);

  const computeRange = (mode: RangeMode, day: string) => {
    if (mode === "thisMonth") return monthContaining(day);
    if (mode === "lastMonth") return monthContaining(shiftMonth(day, -1));
    return { from: shiftDateKey(day, -29), to: day };
  };

  const applyDate = (nextDate: string, mode: RangeMode = rangeMode) => {
    setDate(nextDate);
    setTechFilter(null);
    if (mode !== "custom") setRange(computeRange(mode, nextDate));
  };

  /* ------------------------------------------------------------------
   * List date scope. `day` (default) is the untouched single-day desk;
   * `range` opens a from/to window (starts at one day, widens freely);
   * `all` shows the whole ledger, grouped by date. Kept separate from the
   * report's `range` so report presets never move the list.
   * ------------------------------------------------------------------ */
  const LIST_PAGE = 300;
  const [listMode, setListMode] = useState<ListMode>("day");
  const [listRange, setListRange] = useState(() => {
    const anchor = initialDate || dhakaDateKey(new Date());
    return { from: anchor, to: anchor }; // starts as one day; widened freely
  });
  const [listTotal, setListTotal] = useState<number | null>(null);
  const [listHasMore, setListHasMore] = useState(false);
  const listModeRef = useRef(listMode);
  const listRangeRef = useRef(listRange);
  const servicesRef = useRef<ServiceDTO[]>([]);
  useEffect(() => {
    listModeRef.current = listMode;
  }, [listMode]);
  useEffect(() => {
    listRangeRef.current = listRange;
  }, [listRange]);
  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  const listUrl = useCallback((day: string, offset = 0) => {
    const page = `limit=${LIST_PAGE}${offset ? `&offset=${offset}` : ""}`;
    if (listModeRef.current === "all") return `/api/services?all=1&${page}`;
    if (listModeRef.current === "range") {
      const { from, to } = listRangeRef.current;
      return `/api/services?from=${from}&to=${to}&${page}`;
    }
    return `/api/services?date=${day}`;
  }, []);

  const statsUrl = useCallback((day: string) => {
    if (listModeRef.current === "all") return "/api/stats?all=1";
    if (listModeRef.current === "range") {
      const { from, to } = listRangeRef.current;
      return `/api/stats?from=${from}&to=${to}`;
    }
    return `/api/stats?date=${day}`;
  }, []);

  const loadTechnicians = useCallback(async () => {
    try {
      const res = await fetch("/api/technicians");
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.technicians)) {
        setTechnicians(
          data.technicians
            .filter((t: { isActive: boolean }) => t.isActive)
            .map((t: { name: string }) => t.name)
        );
      }
    } catch {
      /* the form falls back to its built-in list */
    }
  }, []);

  const loadPartsShops = useCallback(async () => {
    try {
      const res = await fetch("/api/parts-shops");
      const data = await res.json().catch(() => ({}));
      const remote =
        res.ok && Array.isArray(data.shops)
          ? data.shops.filter((s: unknown) => typeof s === "string")
          : [];
      setPartsShops(mergePartShopNames(loadPartShopNames(), remote));
    } catch {
      setPartsShops(loadPartShopNames());
    }
  }, []);

  /** Called from a new entry's parts row so shops can be added while entering. */
  const addPartShop = useCallback((name: string) => {
    const stored = savePartShopName(name);
    setPartsShops((current) => mergePartShopNames(stored, current));
    toast.success(`“${name}” দোকান তালিকায় যোগ হয়েছে`);
  }, []);

  const load = useCallback(async (day: string, showSkeleton: boolean) => {
    const my = ++reqId.current;
    if (showSkeleton) {
      setLoading(true);
    } else {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        setRefreshing(true);
      }, 150);
    }
    try {
      const [svc, st] = await Promise.all([
        getJSON<ServicesListResponse>(listUrl(day)),
        getJSON<StatsResponse>(statsUrl(day)),
      ]);
      if (reqId.current !== my) return;
      setServices(svc.services);
      setListTotal(svc.total ?? null);
      setListHasMore(!!svc.hasMore);
      setStats(st);
    } catch (e) {
      if (reqId.current !== my) return;
      toast.error(e instanceof Error ? e.message : "লোড করা যায়নি");
    } finally {
      if (reqId.current === my) {
        loadedOnce.current = true;
        if (refreshTimer.current) {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = null;
        }
        setRefreshing(false);
        setLoading(false);
      }
    }
  }, [listUrl, statsUrl]);

  const fetchMonthly = useCallback(
    async (w: { from: string; to: string } | null) => {
      const my = ++monthlyReq.current;
      try {
        const mo = await getJSON<MonthlyResponse>(
          w
            ? `/api/stats/monthly?from=${w.from}&to=${w.to}`
            : `/api/stats/monthly?all=1`
        );
        if (monthlyReq.current !== my) return;
        setMonthly(mo);
      } catch (e) {
        if (monthlyReq.current !== my) return;
        toast.error(e instanceof Error ? e.message : "লোড করা যায়নি");
      }
    },
    []
  );

  /**
   * The window the REPORT is showing: একদিন = the selected day, তারিখ রেঞ্জ =
   * the report range, সব তারিখ = null (no bounds at all). Reads refs so every
   * caller stays a stable callback.
   */
  const currentWindow = useCallback((): { from: string; to: string } | null => {
    const mode = reportModeRef.current;
    if (mode === "all") return null;
    if (mode === "day") {
      const day = dateRef.current;
      return { from: day, to: day };
    }
    return rangeRef.current;
  }, []);

  /** Identity of the current report window — refetch only when it changes. */
  const reportWindowKey =
    reportMode === "all"
      ? "all"
      : reportMode === "day"
        ? `day:${date}`
        : `range:${range.from}_${range.to}`;

  /** One manual refresh for the day list and its daily stats. */
  const refreshAll = useCallback(() => {
    void load(dateRef.current, false);
    void fetchMonthly(currentWindow());
    void loadTechnicians();
    void loadPartsShops();
  }, [load, fetchMonthly, currentWindow, loadTechnicians, loadPartsShops]);

  useEffect(() => {
    void fetchMonthly(currentWindow());
  }, [reportWindowKey, fetchMonthly, currentWindow]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    void load(date, !loadedOnce.current);
    // listMode/listRange changes re-run the same loader with a wider window.
  }, [date, listMode, listRange, load]);

  /** Next page of a capped range/all view; appends so sections stay stable. */
  const loadMore = useCallback(async () => {
    const my = ++reqId.current;
    setRefreshing(true);
    try {
      const next = await getJSON<ServicesListResponse>(
        listUrl(dateRef.current, servicesRef.current.length)
      );
      if (reqId.current !== my) return;
      setServices((prev) => [...prev, ...next.services]);
      setListTotal(next.total ?? null);
      setListHasMore(!!next.hasMore);
    } catch (e) {
      if (reqId.current === my) {
        toast.error(e instanceof Error ? e.message : "লোড করা যায়নি");
      }
    } finally {
      if (reqId.current === my) setRefreshing(false);
    }
  }, [listUrl]);

  useEffect(() => {
    void loadTechnicians();
  }, [loadTechnicians]);

  useEffect(() => {
    void loadPartsShops();
  }, [loadPartsShops]);

  // ←/→ day navigation, ignored while typing or while a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) {
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Day stepping only makes sense in the single-day view.
        if (listModeRef.current !== "day") return;
        const next = shiftDateKey(
          dateRef.current,
          e.key === "ArrowLeft" ? -1 : 1
        );
        setDate(next);
        if (rangeMode !== "custom") setRange(computeRange(rangeMode, next));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rangeMode]);

  const goToday = () => applyDate(dhakaDateKey(new Date()));

  /** List scope switch — only the list window moves; the report stays put. */
  const changeListMode = (mode: ListMode) => {
    if (mode === listMode) return;
    setListMode(mode);
    setTechFilter(null);
  };

  const changeListRange = (from: string, to: string) => {
    if (!from || !to) return;
    if (from > to) {
      toast.error("শুরুর তারিখ শেষের তারিখের আগে");
      return;
    }
    setListRange({ from, to });
  };

  const pickPreset = (mode: RangeMode) => {
    setRangeMode(mode);
    setRange(computeRange(mode, dateRef.current));
  };

  const pickCustom = (from: string, to: string) => {
    if (!from || !to) return;
    if (from > to) {
      toast.error("শুরুর তারিখ শেষের তারিখের পরে");
      return;
    }
    setRangeMode("custom");
    setRange({ from, to });
  };

  const print = async () => {
    if (loading || refreshing || !stats || !monthly) {
      toast.error("পুরো পেজ লোড হওয়ার পর প্রিন্ট করুন");
      return;
    }
    if (window.maherDesktop?.isElectron) {
      await window.maherDesktop.printReceipt();
      return;
    }
    window.print();
  };

  /**
   * Open the customer copy. A per-device receipt stays as before; a shared
   * visit loads every device row FIRST so the dialog never flashes a one-device
   * slip before the combined bill appears.
   */
  const openReceipt = (service: ServiceDTO) => {
    const req = ++receiptGroupReq.current;
    if (!service.groupId) {
      setReceiptGroup(null);
      setReceipt(service);
      return;
    }
    setReceipt(null);
    setReceiptGroup(null);
    void (async () => {
      try {
        const data = await getJSON<{ services: ServiceDTO[] }>(
          `/api/services?groupId=${encodeURIComponent(service.groupId!)}`
        );
        if (req !== receiptGroupReq.current) return;
        const rows = Array.isArray(data.services) ? data.services : [];
        if (rows.length > 1) {
          setReceiptGroup(rows);
          setReceipt(rows[0]);
        } else {
          setReceipt(rows[0] ?? service);
        }
      } catch {
        if (req !== receiptGroupReq.current) return;
        setReceipt(service);
      }
    })();
  };

  const closeReceipt = () => {
    receiptGroupReq.current += 1;
    setReceipt(null);
    setReceiptGroup(null);
  };

  const shareReceiptPdf = async (service: ServiceDTO) => {
    let group: ServiceDTO[] | null = null;
    if (service.groupId) {
      try {
        const data = await getJSON<{ services: ServiceDTO[] }>(
          `/api/services?groupId=${encodeURIComponent(service.groupId)}`
        );
        if (Array.isArray(data.services) && data.services.length > 1) {
          group = data.services;
        }
      } catch {
        /* fall back to the single-device PDF */
      }
    }
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-10000px;top:0;width:720px;background:#fff;pointer-events:none;z-index:-1;";
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      flushSync(() => {
        root.render(
          group ? (
            <ReceiptBundle services={group} profile={shopSettings} />
          ) : (
            <Receipt service={service} profile={shopSettings} />
          )
        );
      });
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const receiptNode = host.querySelector<HTMLElement>("[data-receipt]");
      if (!receiptNode) throw new Error("রিসিট তৈরি করা যায়নি");

      const { createReceiptPdf, shareReceiptPdf: sharePdfBlob } = await import(
        "@/lib/receipt-pdf"
      );
      const blob = await createReceiptPdf(receiptNode);
      const result = await sharePdfBlob(service, blob, shopSettings.shopName);
      if (result === "shared") {
        toast.success("PDF শেয়ার হয়েছে");
      } else if (result === "downloaded") {
        toast.info(
          "PDF download হয়েছে; WhatsApp chat খুলেছে — PDF attach করে Send করুন"
        );
      } else if (result === "downloaded-no-chat") {
        toast.info(
          "PDF download হয়েছে; WhatsApp খোলা যায়নি — WhatsApp বাটন থেকে চ্যাট খুলে পাঠান"
        );
      }
    } catch (error) {
      console.error("PDF share failed", error);
      toast.error(
        error instanceof Error ? error.message : "PDF তৈরি করা যায়নি"
      );
    } finally {
      root.unmount();
      host.remove();
    }
  };

  const edit = (service: ServiceDTO) => {
    setEditing(service);
    setMobileTab("form");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /**
   * Jump straight to the entry form (empty list, navbar CTA, deep links):
   * switch the phone surface to the form, scroll it into view, then put the
   * cursor in the first field so the shopkeeper can start typing immediately.
   */
  const newEntry = () => {
    setEditing(null);
    setMobileTab("form");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const focusFirstField = () => {
      const field = formRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]), select, textarea'
      );
      field?.focus({ preventScroll: true });
    };
    // Phones swap surfaces on the next paint, so they keep the short delay.
    // On desktop the form is already on screen — focus it straight away and
    // never lose the first keystrokes while the page smooth-scrolls.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(focusFirstField)
      );
    } else {
      window.setTimeout(focusFirstField, 350);
    }
  };

  // Deep links from search and old Home bookmarks: open the exact row, or the
  // receipt slip. Consumed once so a normal refresh does not fight the user's
  // current state.
  useEffect(() => {
    if (paramsConsumed.current) return;
    if (!initialEditId && !initialReceiptId) {
      paramsConsumed.current = true;
      return;
    }
    paramsConsumed.current = true;
    void (async () => {
      try {
        if (initialEditId) {
          const row = await getJSON<ServiceDTO>(
            `/api/services/${initialEditId}`
          );
          const rowDate = dhakaDateKey(row.serviceDate);
          if (rowDate !== dateRef.current) applyDate(rowDate);
          setEditing(row);
          setMobileTab("form");
          requestAnimationFrame(() =>
            formRef.current?.scrollIntoView({ block: "start" })
          );
        }
        if (initialReceiptId) {
          const row = await getJSON<ServiceDTO>(
            `/api/services/${initialReceiptId}`
          );
          openReceipt(row);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "এন্ট্রি খোলা যায়নি"
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditId, initialReceiptId]);

  // Visibility refresh keeps the selected day and all counters honest.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refreshAll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshAll]);

  const statusParam: "All" | ServiceStatus | "Due" =
    initialStatus === "All" ||
    initialStatus === "Due" ||
    (STATUSES as readonly string[]).includes(initialStatus ?? "")
      ? (initialStatus as "All" | ServiceStatus | "Due")
      : "All";

  // The masthead is rendered once by the root layout (AppChrome) so it stays
  // put while routing; hand it this desk's search behaviour.
  useAppHeader({
    searchRefreshKey: dataVersion,
    onSearchEdit: edit,
    onSearchReceipt: openReceipt,
  });

  /** Headline label of the daily cards: the shown window, not always "today". */
  const statsScope =
    listMode === "day"
      ? null
      : listMode === "all"
        ? "সব তারিখের হিসাব"
        : `${dayLabel(listRange.from)} – ${dayLabel(listRange.to)}`;

  return (
    // The masthead now lives in the root layout (AppChrome), outside this
    // wrapper, so a full-viewport min-height here would stack on top of the
    // bar and force a vertical scrollbar. Subtract the measured chrome height
    // (bar + its pt-2: 122px on phones, 68px from md up).
    <div className="min-h-[calc(100dvh-122px)] bg-maher-surface md:min-h-[calc(100dvh-68px)]">
      <div
        data-testid="day-refreshing"
        aria-hidden={!refreshing}
        className={`fixed inset-x-0 top-0 z-[60] h-0.5 bg-maher-blue transition-opacity duration-150 print:hidden ${
          refreshing ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />

      {receipt ? (
        <div className="hidden print:block">
          {receiptGroup && receiptGroup.length > 1 ? (
            <ReceiptBundle services={receiptGroup} />
          ) : (
            <Receipt service={receipt} />
          )}
        </div>
      ) : null}

      <main
        data-refreshing={refreshing ? "true" : "false"}
        className={`mx-auto w-full max-w-7xl space-y-2 px-3 py-2 xl:max-w-[1600px] 2xl:max-w-[1840px] ${
          receipt ? "print:hidden" : ""
        }`}
      >
        <div className="hidden print:block" data-testid="monthly-print">
          <MonthlySummary
            summary={monthly?.summary ?? null}
            range={range}
            mode={rangeMode}
            dateMode={reportMode}
            day={date}
            onPreset={pickPreset}
            onCustom={pickCustom}
            loading={loading}
          />
        </div>

        {/* Phones get one workspace surface at a time; desktop keeps both. */}
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-maher-border bg-white p-1 lg:hidden print:hidden">
          <button
            type="button"
            data-testid="service-tab-list"
            aria-pressed={mobileTab === "list"}
            onClick={() => setMobileTab("list")}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
              mobileTab === "list"
                ? "bg-maher-navy text-white"
                : "text-muted-foreground hover:bg-maher-surface"
            )}
          >
            <ClipboardList className="h-4 w-4" />
            সার্ভিস তালিকা
          </button>
          <button
            type="button"
            data-testid="service-tab-form"
            aria-pressed={mobileTab === "form"}
            onClick={() => setMobileTab("form")}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors",
              mobileTab === "form"
                ? "bg-maher-navy text-white"
                : "text-muted-foreground hover:bg-maher-surface"
            )}
          >
            <Plus className="h-4 w-4" />
            নতুন এন্ট্রি
          </button>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[380px_minmax(0,1fr)]">
          <div
            ref={formRef}
            className={cn(
              "min-w-0 scroll-mt-24",
              mobileTab === "list" && "hidden lg:block"
            )}
          >
            <ServiceForm
              key={
                editing?.id ??
                (initialProductMode ? "new-product" : "new-service")
              }
              initial={editing}
              initialProducts={
                editing
                  ? editing.entryKind === "PRODUCT"
                    ? (editing.saleItems ?? [])
                    : editing.groupId
                      ? (services.find(
                          (s) =>
                            s.groupId === editing.groupId &&
                            s.entryKind === "PRODUCT" &&
                            !s.archived
                        )?.saleItems ?? [])
                      : []
                  : []
              }
              initialAnchorId={
                editing
                  ? editing.entryKind === "PRODUCT"
                    ? editing.id
                    : editing.groupId
                      ? (services.find(
                          (s) =>
                            s.groupId === editing.groupId &&
                            s.entryKind === "PRODUCT" &&
                            !s.archived
                        )?.id ?? null)
                      : null
                  : null
              }
              serviceDate={date}
              technicians={technicians}
              partsShops={partsShops}
              onAddPartShop={addPartShop}
              initialProductMode={initialProductMode}
              onSaved={() => {
                setEditing(null);
                setMobileTab("list");
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(currentWindow());
                void loadPartsShops();
              }}
              onCancelEdit={() => {
                setEditing(null);
                setMobileTab("list");
              }}
            />
          </div>
          <div
            className={cn(
              "min-w-0",
              mobileTab === "form" && "hidden lg:block"
            )}
          >
            <ServiceTable
              services={services}
              loading={loading}
              date={date}
              listMode={listMode}
              listRange={listRange}
              listTotal={listTotal}
              listHasMore={listHasMore}
              onLoadMore={() => void loadMore()}
              onModeChange={changeListMode}
              onRangeChange={changeListRange}
              onEdit={edit}
              onReceipt={openReceipt}
              onPayment={(service) => setPaymentTarget(service)}
              onSharePdf={shareReceiptPdf}
              technicianFilter={techFilter}
              onClearTechnician={() => setTechFilter(null)}
              onPrev={() => applyDate(shiftDateKey(dateRef.current, -1))}
              onNext={() => applyDate(shiftDateKey(dateRef.current, 1))}
              onDateChange={(next) => applyDate(next)}
              onToday={goToday}
              initialStatus={statusParam}
              onNewEntry={newEntry}
              onChanged={() => {
                if (editing) setEditing(null);
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(currentWindow());
              }}
            />
          </div>
        </div>
      </main>

      <ShopFooter className={receipt ? "print:hidden" : ""} />

      <ReceiptDialog
        service={receipt}
        services={receiptGroup}
        onClose={closeReceipt}
        onPrint={print}
      />

      <PaymentDialog
        service={paymentTarget}
        onClose={() => setPaymentTarget(null)}
        onChanged={() => {
          setPaymentTarget(null);
          setDataVersion((v) => v + 1);
          void load(dateRef.current, false);
          void fetchMonthly(currentWindow());
        }}
      />

      {refreshing ? (
        <span className="sr-only" role="status">
          <Loader2 className="h-3 w-3 animate-spin" />
          রিফ্রেশ হচ্ছে
        </span>
      ) : null}
    </div>
  );
}
