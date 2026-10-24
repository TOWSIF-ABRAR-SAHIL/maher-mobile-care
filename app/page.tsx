"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MapPin, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { MonthlySummary } from "@/components/MonthlySummary";
import { OutstandingDues, type DuesResponse } from "@/components/OutstandingDues";
import { TechnicianManager } from "@/components/TechnicianManager";
import { Receipt, ReceiptDialog } from "@/components/Receipt";
import { RestoreDialog } from "@/components/RestoreDialog";
import { ServiceForm } from "@/components/ServiceForm";
import { SHOP } from "@/lib/shop";
import {
  createReceiptPdf,
  shareReceiptPdf as sharePdfBlob,
} from "@/lib/receipt-pdf";
import { ServiceTable } from "@/components/ServiceTable";
import { TechnicianStats } from "@/components/TechnicianStats";
import { TodayStats } from "@/components/TodayStats";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dhakaDateKey, monthContaining, shiftDateKey, shiftMonth } from "@/lib/dhaka";
import { toBnDigits } from "@/lib/utils";
import type {
  MonthlyResponse,
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

export default function Home() {
  const [date, setDate] = useState(() => dhakaDateKey(new Date()));
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  // `loading` is the first-paint skeleton only. Day-to-day refreshes keep the
  // previous data on screen and use `refreshing` for a subtle top bar, so
  // navigating days never blanks the dashboard or shifts the page.
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [receipt, setReceipt] = useState<ServiceDTO | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [showTechManager, setShowTechManager] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showDues, setShowDues] = useState(false);
  // Dues are fetched here (not inside the dialog) so the trigger button can
  // show the live count/total before the dialog is ever opened.
  const [dues, setDues] = useState<DuesResponse | null>(null);
  const [duesLoading, setDuesLoading] = useState(true);
  // v1.1: active roster drives the form dropdown and the dashboard cards.
  const [technicians, setTechnicians] = useState<string[]>([]);
  // Internal parts-shop names, used only as datalist suggestions in the form.
  const [partsShops, setPartsShops] = useState<string[]>([]);
  // Client-side card → table filter. Reset on every date change.
  const [techFilter, setTechFilter] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef(date);
  useEffect(() => {
    dateRef.current = date;
  }, [date]);
  // Monotonic request id — stale (out-of-order) responses are ignored so
  // rapid day-navigation never shows the wrong day's data.
  const reqId = useRef(0);
  const monthlyReq = useRef(0);
  const duesReq = useRef(0);
  // Set after the first successful load; later date changes update in place.
  const loadedOnce = useRef(false);
  // Delayed so a fast local API never flashes a progress bar.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Summary window. Presets are anchored to the navbar date ("আজকের দিনের
  // সাথে connection"), custom range stays fixed until a preset is picked.
  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling30");
  const [range, setRange] = useState(() => {
    const t = dhakaDateKey(new Date());
    return { from: shiftDateKey(t, -29), to: t };
  });
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const computeRange = (mode: RangeMode, day: string) => {
    if (mode === "thisMonth") return monthContaining(day);
    if (mode === "lastMonth") return monthContaining(shiftMonth(day, -1));
    return { from: shiftDateKey(day, -29), to: day }; // rolling30
  };

  /** Navbar date change — presets recompute from the new day, custom stays. */
  const applyDate = (d: string, mode: RangeMode = rangeMode) => {
    setDate(d);
    // A roster filter belongs to the day it was picked on.
    setTechFilter(null);
    if (mode !== "custom") setRange(computeRange(mode, d));
  };

  const loadTechnicians = useCallback(async () => {
    try {
      const res = await fetch("/api/technicians");
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.technicians)) {
        setTechnicians(data.technicians.filter((t: { isActive: boolean }) => t.isActive).map((t: { name: string }) => t.name));
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

  useEffect(() => {
    try {
      setLastBackup(localStorage.getItem("maher-last-backup"));
    } catch {
      /* private mode etc. */
    }
  }, []);

  // ←/→ day navigation (ignored while typing or when a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="alertdialog"], [role="dialog"]')) {
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const nd = shiftDateKey(
          dateRef.current,
          e.key === "ArrowLeft" ? -1 : 1
        );
        setDate(nd);
        if (rangeMode !== "custom") setRange(computeRange(rangeMode, nd));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rangeMode]);

  const load = useCallback(async (day: string, showSkeleton: boolean) => {
    const my = ++reqId.current;
    if (showSkeleton) {
      setLoading(true);
    } else {
      // Only show the refresh bar if the request is slow enough to notice;
      // a fast local response must not produce its own flicker.
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        setRefreshing(true);
      }, 150);
    }
    try {
      const [svc, st] = await Promise.all([
        getJSON<{ services: ServiceDTO[] }>(
          `/api/services?date=${day}`
        ),
        getJSON<StatsResponse>(`/api/stats?date=${day}`),
      ]);
      if (reqId.current !== my) return; // a newer request already started
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
        setSyncing(false);
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
    // Skeleton only on the very first paint. Date changes keep the previous
    // list visible while the new day loads.
    void load(date, !loadedOnce.current);
  }, [date, load]);

  useEffect(() => {
    void loadTechnicians();
  }, [loadTechnicians]);

  useEffect(() => {
    void loadPartsShops();
  }, [loadPartsShops]);

  const sync = () => {
    setSyncing(true);
    void load(date, false);
    void fetchMonthly(rangeRef.current);
    void fetchDues();
  };

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
    // Printing before CSS/data finish loading produces a blank unstyled
    // page — block it with a clear message instead.
    if (loading || refreshing || !stats || !monthly) {
      toast.error("পুরো পেজ লোড হওয়ার পর প্রিন্ট করুন");
      return;
    }
    window.print();
  };

  /**
   * Render the same Receipt off-screen, capture it with html2canvas, and hand
   * the resulting PDF to the OS share sheet. The document is never uploaded;
   * every byte stays on the shop PC. The fallback downloads the PDF and opens
   * the customer's own WhatsApp chat (wa.me cannot attach files itself).
   */
  const shareReceiptPdf = async (service: ServiceDTO) => {
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText =
      "position:fixed;left:-10000px;top:0;width:720px;background:#fff;pointer-events:none;z-index:-1;";
    document.body.appendChild(host);
    const root = createRoot(host);

    try {
      flushSync(() => {
        root.render(<Receipt service={service} />);
      });
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );

      const receiptNode = host.querySelector<HTMLElement>("[data-receipt]");
      if (!receiptNode) throw new Error("রিসিট তৈরি করা যায়নি");

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
        error instanceof Error
          ? error.message
          : "PDF তৈরি করা যায়নি"
      );
    } finally {
      root.unmount();
      host.remove();
    }
  };

  const stampBackup = () => {
    const stamp = new Date().toLocaleString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      localStorage.setItem("maher-last-backup", stamp);
    } catch {
      /* private mode etc. */
    }
    setLastBackup(stamp);
  };

  const takeSnapshot = async () => {
    const snap = await fetch("/api/backup", { method: "POST" });
    const sj = await snap.json().catch(() => ({}));
    if (!snap.ok || !sj.ok)
      throw new Error(sj?.error || "ব্যাকআপ করা যায়নি");
    return sj;
  };

  const backup = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      // 1) timestamped snapshot of dev.db on the server (./backups)
      const sj = await takeSnapshot();
      // 2) full data as CSV download in the browser
      const a = document.createElement("a");
      a.href = "/api/backup";
      document.body.appendChild(a);
      a.click();
      a.remove();
      stampBackup();
      toast.success(`ব্যাকআপ হয়েছে (${sj.file ?? ""}, ${sj.services ?? 0}টি রেকর্ড)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ব্যাকআপ করা যায়নি");
    } finally {
      setBackingUp(false);
    }
  };

  const edit = (s: ServiceDTO) => {
    if (s.status === "Returned") {
      toast.info(
        "ফেরত দেওয়া কাজ এডিট করা যায় না। ড্যামেজ ক্ষতি যোগ করতে টেবিলের ⚖️ বাটন ব্যবহার করুন।"
      );
      return;
    }
    setEditing(s);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // A dialog must close before the receipt dialog / form opens underneath it,
  // otherwise two radix portals stack and focus gets trapped in the old one.
  const editFromDues = (s: ServiceDTO) => {
    setShowDues(false);
    edit(s);
  };
  const receiptFromDues = (s: ServiceDTO) => {
    setShowDues(false);
    setReceipt(s);
  };

  // Tab-e fire ele chupchap refresh — Sync mone rakhte hoy na.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load(dateRef.current, false);
        void fetchMonthly(rangeRef.current);
        void fetchDues();
        // The roster can change in another tab (or via the manager while this
        // tab was in the background). Without this the entry form keeps a
        // technician that is no longer selectable and every save is rejected
        // with "সঠিক টেকনিশিয়ান বাছুন" until a manual reload.
        void loadTechnicians();
        void loadPartsShops();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, fetchMonthly, fetchDues, loadTechnicians, loadPartsShops]);

  // Dine prothom khulle auto snapshot (staff vulleo backup thakbe).
  // Ref guard: StrictMode double-invokes effects in dev — one snapshot only.
  const autoFired = useRef(false);
  useEffect(() => {
    if (autoFired.current) return;
    autoFired.current = true;
    const today = dhakaDateKey(new Date());
    let done = null;
    try {
      done = localStorage.getItem("maher-auto-backup-date");
    } catch {
      /* ignore */
    }
    if (done === today) return;
    (async () => {
      try {
        const sj = await takeSnapshot();
        if (!sj.ok) return;
        try {
          localStorage.setItem("maher-auto-backup-date", today);
        } catch {
          /* ignore */
        }
        stampBackup();
        toast.success("Auto backup hoyeche");
      } catch {
        /* server busy — user can backup manually */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const duesButtonLabel = duesLoading
    ? "💰 বাকি তালিকা (হিসাব হচ্ছে…)"
    : dues
      ? `💰 বাকি তালিকা (${toBnDigits(dues.count)}টি • ৳${toBnDigits(
          dues.totalDue.toLocaleString("en-IN")
        )})`
      : "💰 বাকি তালিকা";

  return (
    <div className="min-h-dvh bg-gray-100">
      {/* Fixed so a slow refresh never changes the layout height. */}
      <div
        data-testid="day-refreshing"
        aria-hidden={!refreshing}
        className={`fixed inset-x-0 top-0 z-[60] h-0.5 bg-blue-600 transition-opacity duration-150 print:hidden ${
          refreshing ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />
      {/* Paper: ONLY the customer receipt prints — never the dashboard. */}
      {receipt ? (
        <div className="hidden print:block">
          <Receipt service={receipt} />
        </div>
      ) : null}
      <main
        data-refreshing={refreshing ? "true" : "false"}
        className={`mx-auto w-full max-w-7xl space-y-2.5 px-3 py-2.5 xl:max-w-[1440px] 2xl:max-w-[1600px] ${
          receipt ? "print:hidden" : ""
        }`}
      >
        <Header
          date={date}
          onPrev={() => applyDate(shiftDateKey(dateRef.current, -1))}
          onNext={() => applyDate(shiftDateKey(dateRef.current, 1))}
          onDateChange={(d) => applyDate(d)}
          onToday={goToday}
          lastBackup={lastBackup}
          onSync={sync}
          syncing={syncing}
          onBackup={() => void backup()}
          backingUp={backingUp}
          onRestore={() => setShowRestore(true)}
          onManageTechnicians={() => setShowTechManager(true)}
          onPrint={print}
          searchRefreshKey={dataVersion}
          onSearchEdit={edit}
          onSearchReceipt={setReceipt}
        />

        {/* Action row: report + dues are dialogs now, so the daily form and
            table stay above the fold. */}
        <div
          data-testid="action-row"
          className="flex flex-col gap-2 print:hidden sm:flex-row sm:flex-wrap"
        >
          <Button
            type="button"
            data-testid="open-report"
            onClick={() => setShowReport(true)}
            className="w-full bg-slate-800 text-white hover:bg-slate-900 sm:w-auto"
          >
            📊 ওভারঅল রিপোর্ট
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="open-dues"
            onClick={() => setShowDues(true)}
            className="w-full border-red-300 bg-red-50 text-red-800 hover:bg-red-100 sm:w-auto"
          >
            {duesButtonLabel}
          </Button>
        </div>

        <TechnicianStats
          stats={stats?.techStats ?? []}
          loading={loading}
          selected={techFilter}
          onSelect={setTechFilter}
        />

        <TodayStats
          stats={stats?.today ?? null}
          loading={loading}
          date={date}
          today={dhakaDateKey(new Date())}
        />

        {/* Dashboard printing still includes the monthly report even though it
            is a dialog on screen. The dialog itself is print:hidden. */}
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

        <div className="grid items-start gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <div ref={formRef} className="min-w-0 scroll-mt-24">
            <ServiceForm
              key={editing?.id ?? "new"}
              initial={editing}
              serviceDate={date}
              technicians={technicians}
              partsShops={partsShops}
              onSaved={() => {
                setEditing(null);
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(range);
                void loadPartsShops();
              }}
              onCancelEdit={() => setEditing(null)}
            />
          </div>
          <div className="min-w-0">
            <ServiceTable
              services={services}
              loading={loading}
              date={date}
              onEdit={edit}
              onReceipt={setReceipt}
              onSharePdf={shareReceiptPdf}
              technicianFilter={techFilter}
              onClearTechnician={() => setTechFilter(null)}
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

      {/* The banner is app chrome. It belongs on a dashboard printout (it
          carries the shop name) but must never end up on a customer's bill,
          so it is hidden only while a receipt is open — same rule as <main>. */}
      <footer
        className={`mx-auto w-full max-w-7xl px-3 pb-6 xl:max-w-[1440px] 2xl:max-w-[1600px] ${
          receipt ? "print:hidden" : ""
        }`}
      >
        <div className="overflow-hidden rounded-lg bg-gradient-to-r from-slate-800 via-slate-900 to-slate-800 text-white shadow print:bg-white print:text-black">
          <div className="px-4 py-4 text-center">
            <p className="text-base font-extrabold tracking-wide sm:text-lg">
              {SHOP.name}
            </p>
            <div className="mt-2 flex flex-col items-center justify-center gap-1.5 text-xs text-slate-300 sm:flex-row sm:gap-6 print:text-gray-700">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {SHOP.address}
              </span>
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {SHOP.phone}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                ১০০% অফলাইন
              </span>
            </div>
          </div>
          <div className="border-t border-white/10 px-4 py-2 text-center text-[11px] text-slate-400 print:border-gray-300 print:text-gray-500">
            দৈনিক সার্ভিস ট্র্যাকার — ডেটা আপনার পিসিতেই থাকে
          </div>
        </div>
      </footer>
      <ReceiptDialog
        service={receipt}
        onClose={() => setReceipt(null)}
        onPrint={print}
      />
      {/* Mounted last so `document.querySelector('[role="dialog"]')` in the
          suites keeps resolving to the receipt dialog first. */}
      <RestoreDialog
        open={showRestore}
        onClose={() => setShowRestore(false)}
        onRestored={() => {
          setShowRestore(false);
          setDataVersion((v) => v + 1);
          void load(dateRef.current, false);
          void fetchMonthly(rangeRef.current);
          void fetchDues();
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
    </div>
  );
}
