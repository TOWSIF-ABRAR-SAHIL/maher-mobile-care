"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { BarChart3, Wallet } from "lucide-react";
import { toast } from "sonner";
import { MonthlySummary } from "@/components/MonthlySummary";
import { OutstandingDues, type DuesResponse } from "@/components/OutstandingDues";
import { ReceiptDialog } from "@/components/Receipt";
import { ReportDetails } from "@/components/ReportDetails";
import { ReportDocument } from "@/components/report/ReportDocument";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dhakaDateKey,
  monthContaining,
  shiftDateKey,
  shiftMonth,
} from "@/lib/dhaka";
import type { ReportData } from "@/lib/export";
import type {
  ListMode,
  MonthlyResponse,
  RangeMode,
  ServiceDTO,
  ServicesListResponse,
} from "@/lib/types";

/**
 * Reports and the all-dues list moved off the Service desk so it can stay a
 * pure front desk. They live here, on the Dashboard, with the exact same
 * components and money math as before — only the entry point changed.
 */

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "লোড করা যায়নি");
  return data as T;
}

const EXPORT_PAGE = 500;
const EXPORT_MAX = 5000;
const OPEN_DUES_EVENT = "maher:dashboard-open-dues";

/**
 * The all-dues action now lives on the Receivables metric card. It only
 * announces intent; ReportDock still owns the dialog and the live fetch so
 * there is exactly one dues state on the page.
 */
export function DuesTrigger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      data-testid="open-dues"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_DUES_EVENT))}
    >
      <Wallet className="h-3.5 w-3.5 shrink-0" />
      {children}
    </Button>
  );
}

function rangeFor(mode: RangeMode, day: string): { from: string; to: string } {
  if (mode === "thisMonth") return monthContaining(day);
  if (mode === "lastMonth") return monthContaining(shiftMonth(day, -1));
  if (mode === "rolling30") return { from: shiftDateKey(day, -29), to: day };
  return { from: day, to: day };
}

export function ReportDock({
  className,
  variant = "secondary",
  children,
}: {
  className?: string;
  variant?: "secondary" | "ghost" | "outline";
  children?: ReactNode;
} = {}) {
  const router = useRouter();
  const { settings } = useShopSettings();
  const today = dhakaDateKey(new Date());
  const [showReport, setShowReport] = useState(false);
  const [showDues, setShowDues] = useState(false);
  const [receipt, setReceipt] = useState<ServiceDTO | null>(null);
  const [receiptGroup, setReceiptGroup] = useState<ServiceDTO[] | null>(null);

  const [rangeMode, setRangeMode] = useState<RangeMode>("rolling30");
  const [day, setDay] = useState(today);
  const [range, setRange] = useState(() => rangeFor("rolling30", today));
  const [dateMode, setDateMode] = useState<ListMode>("range");
  const [monthly, setMonthly] = useState<MonthlyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState<null | "pdf" | "csv" | "excel">(null);
  const [reportRows, setReportRows] = useState<ServiceDTO[] | null>(null);
  const [reportRowsLoading, setReportRowsLoading] = useState(false);
  const reportRowsReq = useRef(0);
  const monthlyReq = useRef(0);
  const rangeRef = useRef(range);
  const dateModeRef = useRef(dateMode);
  const dayRef = useRef(day);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  useEffect(() => {
    dateModeRef.current = dateMode;
  }, [dateMode]);
  useEffect(() => {
    dayRef.current = day;
  }, [day]);

  const applyPreset = useCallback((mode: RangeMode) => {
    const next = rangeFor(mode, dayRef.current);
    setRangeMode(mode);
    setRange(next);
    setDateMode("range");
  }, []);

  const applyCustom = useCallback((from: string, to: string) => {
    // Keep the original report guard: an inverted window is refused with a
    // toast and the previously selected range stays untouched.
    if (!from || !to) return;
    if (from > to) {
      toast.error("শুরুর তারিখ শেষের তারিখের পরে");
      return;
    }
    setRangeMode("custom");
    setRange({ from, to });
    setDateMode("range");
  }, []);

  const currentWindow = useCallback((): { from: string; to: string } | null => {
    const mode = dateModeRef.current;
    if (mode === "day") return { from: dayRef.current, to: dayRef.current };
    if (mode === "all") return null;
    return rangeRef.current;
  }, []);

  const reportWindowKey = (() => {
    const w = dateMode === "day" ? { from: day, to: day } : dateMode === "all" ? null : range;
    return w ? `${w.from}_${w.to}` : "all";
  })();

  const fetchMonthly = useCallback(
    async (window: { from: string; to: string } | null) => {
      const my = ++monthlyReq.current;
      setLoading(true);
      try {
        const query = !window
          ? "all=1"
          : `from=${window.from}&to=${window.to}`;
        const data = await getJSON<MonthlyResponse>(`/api/stats/monthly?${query}`);
        if (monthlyReq.current === my) setMonthly(data);
      } catch {
        if (monthlyReq.current === my) setMonthly(null);
      } finally {
        if (monthlyReq.current === my) setLoading(false);
      }
    },
    []
  );

  const fetchWindowRows = useCallback(
    async (cap: number): Promise<{ rows: ServiceDTO[]; capped: boolean }> => {
      const w = currentWindow();
      const scope = w ? `from=${w.from}&to=${w.to}` : "all=1";
      const rows: ServiceDTO[] = [];
      let offset = 0;
      let hasMore = true;
      while (hasMore && rows.length < cap) {
        const page = await getJSON<ServicesListResponse>(
          `/api/services?${scope}&limit=${EXPORT_PAGE}&offset=${offset}`
        );
        rows.push(...(page.services ?? []));
        hasMore = !!page.hasMore;
        offset = rows.length;
      }
      return { rows, capped: hasMore };
    },
    [currentWindow]
  );

  useEffect(() => {
    void fetchMonthly(currentWindow());
  }, [reportWindowKey, fetchMonthly, currentWindow]);

  useEffect(() => {
    if (!showReport) {
      setReportRows(null);
      return;
    }
    const my = ++reportRowsReq.current;
    setReportRowsLoading(true);
    fetchWindowRows(EXPORT_MAX)
      .then(({ rows }) => {
        if (reportRowsReq.current === my) setReportRows(rows);
      })
      .catch(() => {
        if (reportRowsReq.current === my) setReportRows([]);
      })
      .finally(() => {
        if (reportRowsReq.current === my) setReportRowsLoading(false);
      });
  }, [showReport, reportWindowKey, fetchWindowRows]);

  const collectReport = async (): Promise<ReportData | null> => {
    if (!monthly) return null;
    const w = currentWindow();
    const { rows, capped } = await fetchWindowRows(EXPORT_MAX);
    if (capped) {
      toast.warning("রিপোর্টে সর্বোচ্চ ৫০০০ রেকর্ড — রেঞ্জ ছোট করে আবার চেষ্টা করুন");
    }
    return {
      from: w?.from ?? "",
      to: w?.to ?? "",
      label: w ? `${w.from} – ${w.to}` : "সব তারিখ",
      stamp: w ? `${w.from}_${w.to}` : "all",
      generatedAt: new Date().toISOString(),
      shopName: settings.shopName,
      summary: monthly.summary,
      rows,
    };
  };

  const exportReport = async (kind: "pdf" | "csv" | "excel") => {
    if (exporting) return;
    if (!monthly) {
      toast.error("রিপোর্ট লোড হওয়ার পর এক্সপোর্ট করুন");
      return;
    }
    setExporting(kind);
    try {
      const data = await collectReport();
      if (!data) return;
      const stamp = data.stamp;
      const { downloadBlob } = await import("@/lib/download");
      if (kind === "csv") {
        const { buildReportCsv } = await import("@/lib/export");
        downloadBlob(buildReportCsv(data), `MSS-Report-${stamp}.csv`);
      } else if (kind === "excel") {
        const { buildReportXlsx } = await import("@/lib/export");
        downloadBlob(await buildReportXlsx(data), `MSS-Report-${stamp}.xlsx`);
      } else {
        const host = document.createElement("div");
        host.setAttribute("aria-hidden", "true");
        host.style.cssText =
          "position:fixed;left:-10000px;top:0;width:760px;background:#fff;pointer-events:none;z-index:-1;";
        document.body.appendChild(host);
        const root = createRoot(host);
        try {
          flushSync(() => {
            root.render(<ReportDocument data={data} />);
          });
          if (document.fonts?.ready) await document.fonts.ready;
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          );
          const node = host.querySelector<HTMLElement>("[data-report-doc]");
          if (!node) throw new Error("রিপোর্ট তৈরি করা যায়নি");
          const { createReportPdf } = await import("@/lib/report-pdf");
          downloadBlob(await createReportPdf(node), `MSS-Report-${stamp}.pdf`);
        } finally {
          root.unmount();
          host.remove();
        }
      }
      toast.success("রিপোর্ট ডাউনলোড হয়েছে");
    } catch (error) {
      console.error("Report export failed", error);
      toast.error(error instanceof Error ? error.message : "এক্সপোর্ট করা যায়নি");
    } finally {
      setExporting(null);
    }
  };

  const [dues, setDues] = useState<DuesResponse | null>(null);
  const [duesLoading, setDuesLoading] = useState(true);
  const duesReq = useRef(0);
  const fetchDues = useCallback(async () => {
    const my = ++duesReq.current;
    try {
      const data = await getJSON<DuesResponse>("/api/services/dues");
      if (duesReq.current === my) setDues(data);
    } catch {
      if (duesReq.current === my) setDues(null);
    } finally {
      if (duesReq.current === my) setDuesLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDues();
  }, [fetchDues]);

  useEffect(() => {
    const open = () => {
      void fetchDues();
      setShowDues(true);
    };
    window.addEventListener(OPEN_DUES_EVENT, open);
    return () => window.removeEventListener(OPEN_DUES_EVENT, open);
  }, [fetchDues]);

  const openReceipt = async (service: ServiceDTO) => {
    setShowDues(false);
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
        /* fall back to the single-device slip */
      }
    }
    setReceiptGroup(group);
    setReceipt(service);
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        className={
          className ?? "h-10 w-full justify-center gap-2"
        }
        data-testid="open-report"
        onClick={(e) => {
          e.stopPropagation();
          setShowReport(true);
        }}
      >
        {children ?? (
          <>
            <BarChart3 className="h-4 w-4" /> রিপোর্ট খুলুন
          </>
        )}
      </Button>

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent
          data-testid="report-dialog"
          className="max-h-[92dvh] sm:max-w-5xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>ওভারঅল রিপোর্ট</DialogTitle>
            <DialogDescription>
              একদিন, তারিখ রেঞ্জ বা সব তারিখের সার্ভিস, বাকি ও লাভের হিসাব
            </DialogDescription>
          </DialogHeader>
          <MonthlySummary
            summary={monthly?.summary ?? null}
            range={range}
            mode={rangeMode}
            dateMode={dateMode}
            day={day}
            onDateMode={setDateMode}
            onDayChange={setDay}
            onPreset={applyPreset}
            onCustom={applyCustom}
            loading={loading}
            exporting={exporting}
            onExportPdf={() => void exportReport("pdf")}
            onExportCsv={() => void exportReport("csv")}
            onExportExcel={() => void exportReport("excel")}
          />
          <ReportDetails
            rows={reportRows}
            loading={reportRowsLoading}
            dateMode={dateMode}
            day={day}
            range={range}
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
            onEdit={(service) => {
              setShowDues(false);
              router.push(`/service?edit=${service.id}`);
            }}
            onReceipt={(service) => void openReceipt(service)}
          />
        </DialogContent>
      </Dialog>

      <ReceiptDialog
        service={receipt}
        services={receiptGroup}
        onClose={() => {
          setReceipt(null);
          setReceiptGroup(null);
        }}
        onPrint={() => {
          if (window.maherDesktop?.isElectron) {
            void window.maherDesktop.printReceipt();
            return;
          }
          window.print();
        }}
      />
    </>
  );
}
