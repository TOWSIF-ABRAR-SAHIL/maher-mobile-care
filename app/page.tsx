"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Phone, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { GlobalServiceSearch } from "@/components/GlobalServiceSearch";
import { MonthlySummary } from "@/components/MonthlySummary";
import { OutstandingDues } from "@/components/OutstandingDues";
import { Receipt, ReceiptDialog } from "@/components/Receipt";
import { RestoreDialog } from "@/components/RestoreDialog";
import { ServiceForm } from "@/components/ServiceForm";
import { SHOP } from "@/lib/shop";
import { ServiceTable } from "@/components/ServiceTable";
import { TechnicianStats } from "@/components/TechnicianStats";
import { TodayStats } from "@/components/TodayStats";
import { dhakaDateKey, monthContaining, shiftDateKey, shiftMonth } from "@/lib/dhaka";
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [editing, setEditing] = useState<ServiceDTO | null>(null);
  const [receipt, setReceipt] = useState<ServiceDTO | null>(null);
  const [showRestore, setShowRestore] = useState(false);
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
    if (mode !== "custom") setRange(computeRange(mode, d));
  };

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
    if (showSkeleton) setLoading(true);
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

  useEffect(() => {
    void fetchMonthly(range);
  }, [range, fetchMonthly]);

  useEffect(() => {
    void load(date, true);
  }, [date, load]);

  const sync = () => {
    setSyncing(true);
    void load(date, false);
    void fetchMonthly(rangeRef.current);
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
    if (loading || !stats || !monthly) {
      toast.error("পুরো পেজ লোড হওয়ার পর প্রিন্ট করুন");
      return;
    }
    window.print();
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
    setEditing(s);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Tab-e fire ele chupchap refresh — Sync mone rakhte hoy na.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void load(dateRef.current, false);
        void fetchMonthly(rangeRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load, fetchMonthly]);

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

  return (
    <div className="min-h-dvh bg-gray-100">
      {/* Paper: ONLY the customer receipt prints — never the dashboard. */}
      {receipt ? (
        <div className="hidden print:block">
          <Receipt service={receipt} />
        </div>
      ) : null}
      <main
        className={`mx-auto max-w-7xl space-y-5 px-3 py-4 ${
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
          onPrint={print}
        />

        <TechnicianStats stats={stats?.techStats ?? []} loading={loading} />

        <TodayStats
          stats={stats?.today ?? null}
          loading={loading}
          date={date}
          today={dhakaDateKey(new Date())}
        />

        <MonthlySummary
          summary={monthly?.summary ?? null}
          range={range}
          mode={rangeMode}
          onPreset={pickPreset}
          onCustom={pickCustom}
          loading={loading}
        />

        <OutstandingDues
          refreshKey={dataVersion}
          onEdit={edit}
          onReceipt={setReceipt}
        />
        <GlobalServiceSearch
          refreshKey={dataVersion}
          onEdit={edit}
          onReceipt={setReceipt}
        />

        <div className="grid items-start gap-4 lg:grid-cols-10">
          <div ref={formRef} className="min-w-0 scroll-mt-4 lg:col-span-3">
            <ServiceForm
              key={editing?.id ?? "new"}
              initial={editing}
              serviceDate={date}
              onSaved={() => {
                setEditing(null);
                setDataVersion((v) => v + 1);
                void load(date, false);
                void fetchMonthly(range);
              }}
              onCancelEdit={() => setEditing(null)}
            />
          </div>
          <div className="min-w-0 lg:col-span-7">
            <ServiceTable
              services={services}
              loading={loading}
              date={date}
              onEdit={edit}
              onReceipt={setReceipt}
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
      <footer className="mx-auto max-w-7xl px-3 pb-6">
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
      <RestoreDialog
        open={showRestore}
        onClose={() => setShowRestore(false)}
        onRestored={() => {
          setShowRestore(false);
          setDataVersion((v) => v + 1);
          void load(dateRef.current, false);
          void fetchMonthly(rangeRef.current);
        }}
      />
    </div>
  );
}
