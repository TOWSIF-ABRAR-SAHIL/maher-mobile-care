"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  BarChart3,
  ClipboardList,
  Loader2,
  Plus,
  Printer,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { DailySummary } from "@/components/DailySummary";
import { MonthlySummary } from "@/components/MonthlySummary";
import { OutstandingDues, type DuesResponse } from "@/components/OutstandingDues";
import { PageLead } from "@/components/PageLead";
import { Receipt, ReceiptBundle, ReceiptDialog } from "@/components/Receipt";
import { RestoreDialog } from "@/components/RestoreDialog";
import { ServiceForm } from "@/components/ServiceForm";
import { ServiceStageLine } from "@/components/service/ServiceStageLine";
import { ServiceTable } from "@/components/ServiceTable";
import { ServiceUtilities } from "@/components/service/ServiceUtilities";
import { ShopFooter } from "@/components/ShopFooter";
import { TechnicianManager } from "@/components/TechnicianManager";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishBackup } from "@/lib/backup";
import { dhakaDateKey, monthContaining, shiftDateKey, shiftMonth } from "@/lib/dhaka";
import { useLastBackup } from "@/lib/use-last-backup";
import { cn, STATUSES, toBnDigits, type ServiceStatus } from "@/lib/utils";
import type {
  MonthlyResponse,
  OverdueResponse,
  RangeMode,
  ServiceDTO,
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
  const receiptGroupReq = useRef(0);
  const [showTechManager, setShowTechManager] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showDues, setShowDues] = useState(false);
  const [dues, setDues] = useState<DuesResponse | null>(null);
  const [duesLoading, setDuesLoading] = useState(true);
  const [overdue, setOverdue] = useState<OverdueResponse | null>(null);
  const [overdueLoading, setOverdueLoading] = useState(true);
  const [overdueError, setOverdueError] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const lastBackup = useLastBackup();
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
  const duesReq = useRef(0);
  const overdueReq = useRef(0);
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
      if (res.ok && Array.isArray(data.shops)) {
        setPartsShops(data.shops.filter((s: unknown) => typeof s === "string"));
      }
    } catch {
      /* suggestions are optional; free text still works */
    }
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
        getJSON<{ services: ServiceDTO[] }>(`/api/services?date=${day}`),
        getJSON<StatsResponse>(`/api/stats?date=${day}`),
      ]);
      if (reqId.current !== my) return;
      setServices(svc.services);
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
  }, []);

  const fetchMonthly = useCallback(async (r: { from: string; to: string }) => {
    const my = ++monthlyReq.current;
    try {
      const mo = await getJSON<MonthlyResponse>(
        `/api/stats/monthly?from=${r.from}&to=${r.to}`
      );
      if (monthlyReq.current !== my) return;
      setMonthly(mo);
    } catch (e) {
      if (monthlyReq.current !== my) return;
      toast.error(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, []);

  const fetchDues = useCallback(async () => {
    const my = ++duesReq.current;
    try {
      const d = await getJSON<DuesResponse>("/api/services/dues");
      if (duesReq.current !== my) return;
      setDues(d);
    } catch {
      if (duesReq.current === my) setDues(null);
    } finally {
      if (duesReq.current === my) setDuesLoading(false);
    }
  }, []);

  const fetchOverdue = useCallback(async (day: string) => {
    const my = ++overdueReq.current;
    setOverdueLoading(true);
    try {
      const data = await getJSON<OverdueResponse>(
        `/api/services/overdue?date=${day}`
      );
      if (overdueReq.current !== my) return;
      setOverdue(data);
      setOverdueError(false);
    } catch {
      if (overdueReq.current !== my) return;
      setOverdue(null);
      setOverdueError(true);
    } finally {
      if (overdueReq.current === my) setOverdueLoading(false);
    }
  }, []);

  /** One manual refresh for every panel on the desk, including the stage line. */
  const refreshAll = useCallback(() => {
    void load(dateRef.current, false);
    void fetchMonthly(rangeRef.current);
    void fetchDues();
    void fetchOverdue(dateRef.current);
    void loadTechnicians();
    void loadPartsShops();
  }, [
    load,
    fetchMonthly,
    fetchDues,
    fetchOverdue,
    loadTechnicians,
    loadPartsShops,
  ]);

  useEffect(() => {
    void fetchMonthly(range);
  }, [range, fetchMonthly]);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    void fetchDues();
  }, [fetchDues, dataVersion]);

  useEffect(() => {
    void fetchOverdue(date);
  }, [date, fetchOverdue, dataVersion]);

  useEffect(() => {
    void load(date, !loadedOnce.current);
  }, [date, load]);

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

  const print = () => {
    if (loading || refreshing || !stats || !monthly) {
      toast.error("পুরো পেজ লোড হওয়ার পর প্রিন্ট করুন");
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
            <ReceiptBundle services={group} />
          ) : (
            <Receipt service={service} />
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
      const result = await sharePdfBlob(service, blob);
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

  const backup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const snap = await fetch("/api/backup", { method: "POST" });
      const sj = await snap.json().catch(() => ({}));
      if (!snap.ok || !sj?.ok) {
        throw new Error(sj?.error || "ব্যাকআপ করা যায়নি");
      }
      const link = document.createElement("a");
      link.href = "/api/backup";
      document.body.appendChild(link);
      link.click();
      link.remove();
      publishBackup();
      toast.success(
        `ব্যাকআপ হয়েছে (${sj.file ?? ""}, ${sj.services ?? 0}টি রেকর্ড)`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ব্যাকআপ করা যায়নি");
    } finally {
      setBackingUp(false);
    }
  };

  const edit = (service: ServiceDTO) => {
    setEditing(service);
    setMobileTab("form");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const editFromDues = (service: ServiceDTO) => {
    setShowDues(false);
    edit(service);
  };
  const receiptFromDues = (service: ServiceDTO) => {
    setShowDues(false);
    openReceipt(service);
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

  const duesButtonLabel = duesLoading
    ? "💰 বাকি তালিকা (হিসাব হচ্ছে…)"
    : dues
      ? `💰 বাকি তালিকা (${toBnDigits(dues.count)}টি • ৳${toBnDigits(
          dues.totalDue.toLocaleString("en-IN")
        )})`
      : "💰 বাকি তালিকা";

  const statusParam: "All" | ServiceStatus =
    initialStatus === "All" ||
    (STATUSES as readonly string[]).includes(initialStatus ?? "")
      ? (initialStatus as "All" | ServiceStatus)
      : "All";

  return (
    <div className="min-h-dvh bg-maher-surface">
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
        className={`mx-auto w-full max-w-7xl space-y-3 px-3 py-3 xl:max-w-[1440px] 2xl:max-w-[1600px] ${
          receipt ? "print:hidden" : ""
        }`}
      >
        <AppHeader
          searchRefreshKey={dataVersion}
          onSearchEdit={edit}
          onSearchReceipt={openReceipt}
        />

        <PageLead
          eyebrow="সার্ভিস ডেস্ক"
          title="সার্ভিস ওয়ার্কস্পেস"
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="open-report"
                onClick={() => setShowReport(true)}
                className="bg-white"
              >
                <BarChart3 className="mr-1 h-4 w-4" />
                রিপোর্ট
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="open-dues"
                onClick={() => setShowDues(true)}
                className="border-maher-due/30 bg-white text-maher-due hover:bg-maher-due/10"
              >
                {duesButtonLabel}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={print}
                className="bg-white"
              >
                <Printer className="mr-1 h-4 w-4" />
                প্রিন্ট
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="open-technician-manager"
                onClick={() => setShowTechManager(true)}
                className="bg-white"
                title="টেকনিশিয়ান যোগ / বদল / ডিলিট"
              >
                <Settings className="mr-1 h-4 w-4" />
                টেকনিশিয়ান
              </Button>
            </>
          }
        />

        <ServiceStageLine
          services={services}
          stats={stats}
          date={date}
          overdue={overdue}
          overdueLoading={overdueLoading}
          overdueError={overdueError}
          loading={loading}
          activeStatus={statusParam}
          onRetryOverdue={() => void fetchOverdue(date)}
        />

        <DailySummary
          stats={stats}
          loading={loading}
          selected={techFilter}
          onSelect={setTechFilter}
          date={date}
          today={dhakaDateKey(new Date())}
        />

        <ServiceUtilities
          lastBackup={lastBackup}
          refreshing={refreshing}
          backingUp={backingUp}
          onRefresh={refreshAll}
          onBackup={() => void backup()}
          onRestore={() => setShowRestore(true)}
        />

        <div className="hidden print:block" data-testid="monthly-print">
          <MonthlySummary
            summary={monthly?.summary ?? null}
            range={range}
            mode={rangeMode}
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

        <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
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
              serviceDate={date}
              technicians={technicians}
              partsShops={partsShops}
              initialProductMode={initialProductMode}
              onSaved={() => {
                setEditing(null);
                setMobileTab("list");
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(range);
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
              onEdit={edit}
              onReceipt={openReceipt}
              onSharePdf={shareReceiptPdf}
              technicianFilter={techFilter}
              onClearTechnician={() => setTechFilter(null)}
              onPrev={() => applyDate(shiftDateKey(dateRef.current, -1))}
              onNext={() => applyDate(shiftDateKey(dateRef.current, 1))}
              onDateChange={(next) => applyDate(next)}
              onToday={goToday}
              initialStatus={statusParam}
              onChanged={() => {
                if (editing) setEditing(null);
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(range);
              }}
            />
          </div>
        </div>
      </main>

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent
          data-testid="report-dialog"
          className="max-h-[92dvh] sm:max-w-5xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>ওভারঅল রিপোর্ট</DialogTitle>
            <DialogDescription>
              বিগত ৩০ দিন, এই মাস বা গত মাসের সার্ভিস ও লাভের হিসাব
            </DialogDescription>
          </DialogHeader>
          <MonthlySummary
            summary={monthly?.summary ?? null}
            range={range}
            mode={rangeMode}
            onPreset={pickPreset}
            onCustom={pickCustom}
            loading={loading}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showDues} onOpenChange={setShowDues}>
        <DialogContent
          data-testid="dues-dialog"
          className="max-h-[92dvh] sm:max-w-6xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>বাকি তালিকা</DialogTitle>
            <DialogDescription>
              সব তারিখের বাকি কাস্টমার, বিল, জমা ও যোগাযোগ
            </DialogDescription>
          </DialogHeader>
          <OutstandingDues
            dues={dues}
            loading={duesLoading}
            onEdit={editFromDues}
            onReceipt={receiptFromDues}
          />
        </DialogContent>
      </Dialog>

      <ShopFooter className={receipt ? "print:hidden" : ""} />

      <ReceiptDialog
        service={receipt}
        services={receiptGroup}
        onClose={closeReceipt}
        onPrint={print}
      />

      <RestoreDialog
        open={showRestore}
        onClose={() => setShowRestore(false)}
        onRestored={() => {
          setShowRestore(false);
          setDataVersion((value) => value + 1);
          void load(dateRef.current, false);
          void fetchMonthly(rangeRef.current);
          void loadTechnicians();
          void loadPartsShops();
        }}
      />

      <TechnicianManager
        open={showTechManager}
        onClose={() => setShowTechManager(false)}
        onChanged={() => {
          void loadTechnicians();
          setDataVersion((v) => v + 1);
          void load(dateRef.current, false);
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
