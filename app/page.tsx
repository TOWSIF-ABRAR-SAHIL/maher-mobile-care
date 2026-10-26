"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { PageLead } from "@/components/PageLead";
import { ShopFooter } from "@/components/ShopFooter";
import { RestoreDialog } from "@/components/RestoreDialog";
import { OutstandingDues, type DuesResponse } from "@/components/OutstandingDues";
import { MonthlySummary } from "@/components/MonthlySummary";
import { DuesCard } from "@/components/home/DuesCard";
import { FinanceSummary } from "@/components/home/FinanceSummary";
import { InventoryPulse } from "@/components/home/InventoryPulse";
import { QuickActions } from "@/components/home/QuickActions";
import { RecentWork } from "@/components/home/RecentWork";
import { ReportsCard } from "@/components/home/ReportsCard";
import { ServiceKpis } from "@/components/home/ServiceKpis";
import { SystemUtilities } from "@/components/home/SystemUtilities";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { publishBackup } from "@/lib/backup";
import {
  bengaliDateLabel,
  dhakaDateKey,
  monthContaining,
  shiftDateKey,
  shiftMonth,
} from "@/lib/dhaka";
import { useLastBackup } from "@/lib/use-last-backup";
import type {
  MonthlyResponse,
  OverdueResponse,
  ProductListResponse,
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
  const router = useRouter();
  const today = useRef(dhakaDateKey(new Date())).current;
  const [services, setServices] = useState<ServiceDTO[]>([]);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [products, setProducts] = useState<ProductListResponse | null>(null);
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  const [dues, setDues] = useState<DuesResponse | null>(null);
  const [overdue, setOverdue] = useState<OverdueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showDues, setShowDues] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const lastBackup = useLastBackup();

  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling30");
  const [range, setRange] = useState(() => ({
    from: shiftDateKey(today, -29),
    to: today,
  }));
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const reqId = useRef(0);
  const monthlyReq = useRef(0);
  const loadedOnce = useRef(false);

  const computeRange = (mode: RangeMode, day: string) => {
    if (mode === "thisMonth") return monthContaining(day);
    if (mode === "lastMonth") return monthContaining(shiftMonth(day, -1));
    return { from: shiftDateKey(day, -29), to: day };
  };

  const loadCore = useCallback(async (day: string, skeleton: boolean) => {
    const my = ++reqId.current;
    if (skeleton) setLoading(true);
    else setRefreshing(true);
    try {
      const [svc, st, prod, due, late] = await Promise.all([
        getJSON<{ services: ServiceDTO[] }>(`/api/services?date=${day}`),
        getJSON<StatsResponse>(`/api/stats?date=${day}`),
        getJSON<ProductListResponse>("/api/products?sort=stock"),
        getJSON<DuesResponse>("/api/services/dues").catch(() => null),
        getJSON<OverdueResponse>(`/api/services/overdue?date=${day}`).catch(
          () => null
        ),
      ]);
      if (reqId.current !== my) return;
      setServices(svc.services);
      setStats(st);
      setProducts(prod);
      setDues(due);
      setOverdue(late);
    } catch (error) {
      if (reqId.current !== my) return;
      toast.error(error instanceof Error ? error.message : "লোড করা যায়নি");
    } finally {
      if (reqId.current === my) {
        loadedOnce.current = true;
        setLoading(false);
        setRefreshing(false);
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
    } catch (error) {
      if (monthlyReq.current !== my) return;
      toast.error(error instanceof Error ? error.message : "রিপোর্ট লোড করা যায়নি");
    }
  }, []);

  useEffect(() => {
    void loadCore(today, !loadedOnce.current);
  }, [today, loadCore]);

  useEffect(() => {
    void fetchMonthly(range);
  }, [range, fetchMonthly]);

  // Another tab may add a sale or a payment while Home is in the background.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void loadCore(today, false);
      void fetchMonthly(rangeRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [today, loadCore, fetchMonthly]);

  const refresh = () => {
    void loadCore(today, false);
    void fetchMonthly(rangeRef.current);
  };

  const pickPreset = (mode: RangeMode) => {
    setRangeMode(mode);
    setRange(computeRange(mode, today));
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

  const openEdit = (service: ServiceDTO) => {
    router.push(
      `/service?date=${dhakaDateKey(service.serviceDate)}&edit=${service.id}`
    );
  };
  const openReceipt = (service: ServiceDTO) => {
    router.push(
      `/service?date=${dhakaDateKey(service.serviceDate)}&receipt=${service.id}`
    );
  };

  const report = monthly?.summary ?? null;
  const day = stats?.today ?? null;

  return (
    <div className="min-h-dvh bg-maher-surface">
      <div
        aria-hidden={!refreshing}
        className={`fixed inset-x-0 top-0 z-[60] h-0.5 bg-maher-blue transition-opacity duration-150 ${
          refreshing ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />

      <main className="mx-auto w-full max-w-7xl space-y-3 px-3 py-3 xl:max-w-[1440px] 2xl:max-w-[1600px]">
        <AppHeader
          searchRefreshKey={dataVersion}
          onSearchEdit={openEdit}
          onSearchReceipt={openReceipt}
        />

        <PageLead
          title="আজকের ড্যাশবোর্ড"
          description="আজকের সার্ভিস, টাকা, বাকি ও স্টকের সারসংক্ষেপ দেখুন।"
          meta={
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-maher-navy" />
              {bengaliDateLabel(today)}
            </span>
          }
          actions={
            <Button
              asChild
              className="bg-maher-navy text-white hover:bg-maher-navy-light"
            >
              <Link href={`/service?date=${today}&mode=service`}>
                <Plus className="mr-1.5 h-4 w-4" />
                নতুন সার্ভিস
              </Link>
            </Button>
          }
        />

        <ServiceKpis
          services={services}
          stats={stats}
          date={today}
          overdue={overdue}
          loading={loading}
        />
        <FinanceSummary stats={day} loading={loading} />
        <QuickActions
          date={today}
          onOpenDues={() => setShowDues(true)}
          onOpenReport={() => setShowReport(true)}
        />

        <div className="grid gap-3 xl:grid-cols-12">
          <div className="order-2 min-w-0 xl:order-none xl:col-span-8 xl:col-start-1 xl:row-start-1">
            <RecentWork services={services} date={today} loading={loading} />
          </div>
          <div className="order-1 xl:order-none xl:col-span-4 xl:col-start-9 xl:row-start-1">
            <DuesCard
              dues={dues}
              loading={!dues && loading}
              onOpen={() => setShowDues(true)}
            />
          </div>
          <div className="order-3 xl:order-none xl:col-span-5 xl:col-start-1 xl:row-start-2">
            <InventoryPulse products={products} loading={loading} />
          </div>
          <div className="order-4 xl:order-none xl:col-span-4 xl:col-start-6 xl:row-start-2">
            <ReportsCard
              report={report}
              range={range}
              mode={rangeMode}
              loading={loading}
              onOpen={() => setShowReport(true)}
            />
          </div>
          <div className="order-5 xl:order-none xl:col-span-3 xl:col-start-10 xl:row-start-2">
            <SystemUtilities
              lastBackup={lastBackup}
              refreshing={refreshing}
              backingUp={backingUp}
              onRefresh={refresh}
              onBackup={() => void backup()}
              onRestore={() => setShowRestore(true)}
            />
          </div>
        </div>
      </main>

      <ShopFooter />

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
            loading={!dues && loading}
            onEdit={(service) => {
              setShowDues(false);
              openEdit(service);
            }}
            onReceipt={(service) => {
              setShowDues(false);
              openReceipt(service);
            }}
          />
        </DialogContent>
      </Dialog>

      <RestoreDialog
        open={showRestore}
        onClose={() => setShowRestore(false)}
        onRestored={() => {
          setShowRestore(false);
          setDataVersion((value) => value + 1);
          void loadCore(today, false);
          void fetchMonthly(rangeRef.current);
        }}
      />
    </div>
  );
}
