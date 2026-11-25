"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Loader2,
  Package,
  RotateCcw,
  Settings2,
  Tag,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ServiceDateNav } from "@/components/ServiceDateNav";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BN_MONTHS,
  bengaliDateLabel,
  dhakaDateKey,
  shiftDateKey,
} from "@/lib/dhaka";
import { normalizePartShopName } from "@/lib/part-shops";
import { partSupplierKey } from "@/lib/parts";
import { decodeWithCipher } from "@/lib/secret-code";
import { formatNum, formatTaka, toBnDigits } from "@/lib/utils";
import type {
  ListMode,
  ServicePartLedgerResponse,
  ServicePartLedgerRowDTO,
  ServicePartLedgerSummaryDTO,
  ServicePartResolutionStatus,
} from "@/lib/types";

type StatusTab = "all" | "paid" | "unpaid" | "legacy";
type ResolutionTab = "all" | ServicePartResolutionStatus;

/** Same three labels and order as the service desk's list header. */
const DATE_MODES: { key: ListMode; label: string }[] = [
  { key: "day", label: "একদিন" },
  { key: "range", label: "তারিখ রেঞ্জ" },
  { key: "all", label: "সব তারিখ" },
];

const NO_SHOPS: readonly string[] = [];

/** Secondary filter: a compact dropdown, not a second chip bar. */
const PAYMENT_FILTERS: { key: StatusTab; label: string }[] = [
  { key: "all", label: "সব" },
  { key: "paid", label: "Paid চিহ্ন" },
  { key: "unpaid", label: "চিহ্ন নেই" },
  { key: "legacy", label: "তারিখহীন" },
];

/** Primary filter: one segmented bar for the part lifecycle. */
const RESOLUTION_TABS: { key: ResolutionTab; label: string }[] = [
  { key: "all", label: "সব" },
  { key: "USED", label: "ব্যবহৃত" },
  { key: "MOVED_TO_STOCK", label: "স্টকে যুক্ত" },
  { key: "RETURNED", label: "মহাজনে ফেরত" },
  { key: "DAMAGED", label: "ড্যামেজ" },
  { key: "KEPT_IN_LEDGER", label: "খাতায় রাখা" },
];

const RESOLUTION_BADGES: Record<
  ServicePartResolutionStatus,
  { label: string; className: string }
> = {
  USED: {
    label: "ব্যবহৃত",
    className: "border-maher-navy/20 bg-white text-maher-navy",
  },
  MOVED_TO_STOCK: {
    label: "স্টকে যুক্ত",
    className: "border-maher-done/30 bg-maher-done/10 text-maher-done",
  },
  RETURNED: {
    label: "ফেরত",
    className: "border-maher-warning/40 bg-maher-warning/10 text-maher-warning",
  },
  DAMAGED: {
    label: "ড্যামেজ ক্ষতি",
    className: "border-maher-due/30 bg-maher-due/10 text-maher-due",
  },
  KEPT_IN_LEDGER: {
    label: "খাতায় রাখা",
    className: "border-maher-navy/30 bg-maher-blue-soft text-maher-navy",
  },
};

const RESOLUTION_OPTIONS: Array<{
  key: ServicePartResolutionStatus;
  label: string;
  hint: string;
  icon: typeof Tag;
}> = [
  { key: "USED", label: "ব্যবহৃত", hint: "ডিভাইসের খরচে যোগ হবে", icon: Check },
  {
    key: "MOVED_TO_STOCK",
    label: "স্টকে যুক্ত",
    hint: "পণ্য বাড়বে, ডিভাইসে খরচ নেই",
    icon: Package,
  },
  {
    key: "RETURNED",
    label: "ফেরত",
    hint: "সাপ্লায়ার বাকি থেকে বাদ",
    icon: RotateCcw,
  },
  {
    key: "DAMAGED",
    label: "ড্যামেজ ক্ষতি",
    hint: "দোকানের ক্ষতি হিসাবে যোগ",
    icon: TriangleAlert,
  },
  {
    key: "KEPT_IN_LEDGER",
    label: "খাতায় রাখা",
    hint: "খাতায় থাকবে, স্টকে যাবে না, বাকি থাকবে",
    icon: Tag,
  },
];

/**
 * Display-only: `paidNote` is append-only and stores system stamps as
 * "YYYY-MM-DD HH:mm — Paid …". Reformat just that system prefix in Bengali;
 * everything after it (including user-entered notes) stays byte-for-byte.
 * No Date parsing, so the already-Dhaka-local stamp cannot shift timezone.
 */
function readablePaidHistory(note: string): string {
  return note
    .split("\n")
    .map((line) => {
      const match =
        /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) — (Paid(?: বাতিল)? — [\s\S]*)$/.exec(
          line
        );
      if (!match) return line;
      const [, y, m, d, time, rest] = match;
      const month = BN_MONTHS[Number(m) - 1];
      if (!month) return line;
      return `${toBnDigits(Number(d))} ${month}, ${toBnDigits(y)} ${toBnDigits(time)} — ${rest}`;
    })
    .join("\n");
}

type ActionKind =
  | "paid"
  | "unpaid"
  | "delete"
  | "bulk-paid"
  | "bulk-unpaid";

interface LedgerAction {
  kind: ActionKind;
  row?: ServicePartLedgerRowDTO;
}

/**
 * Internal parts-purchase ledger, embedded in the "দোকান ও ক্রয়" tab.
 *
 * Deliberately separate from supplier bills: a `paid` marker here is a
 * whole-line flag, never a `PurchasePayment`, and it never touches
 * `Service.due`. The summary depends only on date + supplier, so switching
 * the status tab can never hide another status's money.
 */
export function ServicePartsLedger({
  onLedgerChanged,
  shopNames = NO_SHOPS,
  focusShop = null,
}: {
  /** Let the page refresh its all-time shop bills after any ledger write. */
  onLedgerChanged?: () => void;
  /** Saved shops from /parts, merged with shops seen on past part lines. */
  shopNames?: readonly string[];
  /** Quick jump from the shop manager; a fresh object re-applies the same key. */
  focusShop?: { key: string; nonce: number } | null;
} = {}) {
  // The active cipher is broadcast by ShopSettingsProvider, so a saved change
  // on /dashboard reaches this ledger without a hard browser refresh.
  const { cipher } = useShopSettings();
  const [data, setData] = useState<ServicePartLedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<ListMode>("day");
  const [day, setDay] = useState(() => dhakaDateKey(new Date()));
  const [range, setRange] = useState(() => {
    const anchor = dhakaDateKey(new Date());
    return { from: anchor, to: anchor };
  });
  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState<StatusTab>("all");
  const [resolution, setResolution] = useState<ResolutionTab>("all");
  const [action, setAction] = useState<LedgerAction | null>(null);
  const [resolveRow, setResolveRow] = useState<ServicePartLedgerRowDTO | null>(
    null
  );
  // Internal taka is hidden by default; the price code stays visible for audit.
  // A row eye reveals one amount, the toolbar button reveals them all — the
  // same two controls the service desk uses for shop cost. Never persisted,
  // never sent to a receipt.
  const [revealedCosts, setRevealedCosts] = useState<Record<number, boolean>>(
    {}
  );
  const [showAllCosts, setShowAllCosts] = useState(false);
  const toggleCost = (id: number) =>
    setRevealedCosts((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleAllCosts = () => setShowAllCosts((value) => !value);

  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const suppliers = useMemo(() => data?.suppliers ?? [], [data?.suppliers]);

  // The API takes one inclusive date window. `all` omits both bounds so legacy
  // (unknown-date) lines stay visible in the ledger and its fourth card.
  const scopeFrom =
    dateMode === "day" ? day : dateMode === "range" ? range.from : "";
  const scopeTo =
    dateMode === "day" ? day : dateMode === "range" ? range.to : "";

  // Saved names win the display spelling; suppliers found only on old rows are
  // added too. Keys are the same `partSupplierKey` the API filters on.
  const shopOptions = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string }>();
    for (const raw of shopNames) {
      const name = normalizePartShopName(raw);
      const key = partSupplierKey(name);
      if (key && !byKey.has(key)) byKey.set(key, { key, name });
    }
    for (const item of suppliers) {
      const name = normalizePartShopName(item.name);
      const key = partSupplierKey(item.key) ?? partSupplierKey(name);
      if (key && !byKey.has(key)) byKey.set(key, { key, name });
    }
    return [...byKey.values()].sort((a, b) =>
      a.name.localeCompare(b.name, "bn")
    );
  }, [shopNames, suppliers]);

  const supplierName =
    supplier === "all"
      ? null
      : shopOptions.find((item) => item.key === supplier)?.name ?? supplier;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (scopeFrom) params.set("from", scopeFrom);
      if (scopeTo) params.set("to", scopeTo);
      if (supplier !== "all") params.set("supplier", supplier);
      params.set("status", status);
      params.set("resolution", resolution);
      const res = await fetch(`/api/service-parts?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "পার্টস খাতা আনা যায়নি");
      setData(json as ServicePartLedgerResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "পার্টস খাতা আনা যায়নি");
    } finally {
      setLoading(false);
    }
  }, [scopeFrom, scopeTo, supplier, status, resolution]);

  useEffect(() => {
    void load();
  }, [load]);

  // A shop removed from storage and absent from old rows must not leave a
  // selected value with no matching option in the dropdown.
  useEffect(() => {
    if (
      supplier !== "all" &&
      shopOptions.length > 0 &&
      !shopOptions.some((item) => item.key === supplier)
    ) {
      setSupplier("all");
    }
  }, [shopOptions, supplier]);

  // The shop manager's 🔍 only touches the supplier filter; dates, status and
  // resolution tabs stay untouched so the jump never changes the time window.
  useEffect(() => {
    if (focusShop?.key) setSupplier(focusShop.key);
  }, [focusShop]);

  // Every ledger write ends in one of the dialog onDone handlers below. Also
  // notify the parent so its all-time shop totals never lag behind the filtered
  // view shown here.
  const refresh = () => {
    void load();
    onLedgerChanged?.();
  };

  const changeRange = (from: string, to: string) => {
    if (!from || !to) return;
    if (from > to) {
      toast.error("শুরুর তারিখ শেষের তারিখের আগে");
      return;
    }
    setRange({ from, to });
  };

  return (
    <section
      aria-label="সার্ভিস পার্টস খাতা"
      data-testid="service-parts-ledger"
      className="mt-4 border-t border-maher-border pt-3"
    >
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-maher-navy">
            সার্ভিস পার্টস খাতা
          </h3>
          <p className="text-[11px] leading-snug text-muted-foreground">
            শুধু দোকানের হিসাব — Paid শুধু লাইন চিহ্ন, কোনো পেমেন্ট নয়।
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-end justify-end gap-2">
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5 lg:items-end">
            <div data-testid="parts-date-mode" className="max-w-full">
              <div
                data-testid="svc-date-mode"
                role="group"
                aria-label="তারিখ দেখার মোড"
                className="inline-flex h-auto min-h-9 max-w-full flex-wrap items-center overflow-visible rounded-lg border border-maher-border bg-white p-0.5"
              >
                {DATE_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    aria-pressed={dateMode === mode.key}
                    onClick={() => setDateMode(mode.key)}
                    className={`h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-semibold transition ${
                      dateMode === mode.key
                        ? "bg-maher-navy text-white"
                        : "text-muted-foreground hover:bg-maher-surface hover:text-maher-navy"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            {dateMode === "day" ? (
              <ServiceDateNav
                date={day}
                onPrev={() => setDay((current) => shiftDateKey(current, -1))}
                onNext={() => setDay((current) => shiftDateKey(current, 1))}
                onDateChange={setDay}
                onToday={() => setDay(dhakaDateKey(new Date()))}
                isToday={day === dhakaDateKey(new Date())}
              />
            ) : dateMode === "range" ? (
              <div
                data-testid="svc-range-inputs"
                className="flex items-center gap-1.5"
              >
                <label className="sr-only" htmlFor="svc-range-from">
                  শুরুর তারিখ
                </label>
                <Input
                  id="svc-range-from"
                  data-testid="svc-range-from"
                  type="date"
                  aria-label="শুরুর তারিখ"
                  value={range.from}
                  max={range.to}
                  onChange={(event) =>
                    event.target.value &&
                    changeRange(
                      event.target.value,
                      range.to || event.target.value
                    )
                  }
                  className="h-9 w-[148px] bg-white text-xs"
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
                  value={range.to}
                  min={range.from}
                  onChange={(event) =>
                    event.target.value &&
                    changeRange(
                      range.from || event.target.value,
                      event.target.value
                    )
                  }
                  className="h-9 w-[148px] bg-white text-xs"
                />
              </div>
            ) : null}
          </div>
          <div className="shrink-0">
            <Label htmlFor="parts-supplier" className="text-[11px]">
              পার্টসের দোকান
            </Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger id="parts-supplier" className="h-9 w-[170px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব দোকান</SelectItem>
                {shopOptions.map((item) => (
                  <SelectItem key={item.key} value={item.key}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <SummaryCards summary={summary} />

      <div className="my-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
        <div
          role="group"
          aria-label="নিষ্পত্তির অবস্থা"
          className="flex flex-wrap items-center gap-1"
        >
          {RESOLUTION_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={resolution === tab.key}
              data-testid={`resolution-tab-${tab.key}`}
              onClick={() => setResolution(tab.key)}
              className={
                resolution === tab.key
                  ? "rounded-full border border-maher-navy bg-maher-navy px-2.5 py-1 text-[11px] font-semibold text-white"
                  : "rounded-full border border-maher-border bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:border-maher-navy/35 hover:text-maher-navy"
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Label
            htmlFor="parts-payment-filter"
            className="text-[11px] font-medium text-muted-foreground"
          >
            পেমেন্ট চিহ্ন
          </Label>
          <select
            id="parts-payment-filter"
            data-testid="parts-payment-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusTab)}
            className="h-8 rounded-md border border-maher-border bg-white px-2 text-[11px] font-medium text-maher-ink"
          >
            {PAYMENT_FILTERS.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant={showAllCosts ? "default" : "outline"}
          size="sm"
          data-testid="parts-price-toggle"
          aria-pressed={showAllCosts}
          aria-label={
            showAllCosts ? "সব পার্টসের দাম লুকান" : "সব পার্টসের দাম দেখান"
          }
          title={
            showAllCosts
              ? "এক ক্লিকে সব দাম আবার লুকান"
              : "এক ক্লিকে সব দামের টাকা দেখান"
          }
          onClick={toggleAllCosts}
          className="h-8 shrink-0 print:hidden"
        >
          {showAllCosts ? (
            <EyeOff className="mr-1 h-4 w-4" />
          ) : (
            <Eye className="mr-1 h-4 w-4" />
          )}
          {showAllCosts ? "দাম লুকান" : "দাম দেখান"}
        </Button>
        {supplier !== "all" ? (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {supplierName} — ফিল্টার করা সব লাইন
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-white"
              title="শুধু লাইন চিহ্ন বদলানো হয় — কোনো পেমেন্ট নয়"
              onClick={() => setAction({ kind: "bulk-paid" })}
            >
              সব Paid চিহ্ন
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 bg-white"
              title="শুধু লাইন চিহ্ন বদলানো হয় — কোনো পেমেন্ট নয়"
              onClick={() => setAction({ kind: "bulk-unpaid" })}
            >
              সব চিহ্ন বাতিল
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-maher-due/30 bg-maher-due/10 px-3 py-2 text-sm text-maher-due">
          <span>{error}</span>
          <Button
            size="sm"
            variant="outline"
            className="bg-white"
            onClick={refresh}
          >
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-xl border border-maher-border bg-white px-4 py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          পার্টস খাতা আনা হচ্ছে…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-maher-border bg-white px-4 py-8 text-center">
          <p className="text-sm font-semibold">এই ফিল্টারে কোনো পার্টস নেই</p>
          <p className="mt-1 text-xs text-muted-foreground">
            সার্ভিস ফর্মে পার্টস যোগ করলে এখানে জমা হবে।
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-maher-border bg-white shadow-card">
          <p className="border-b border-maher-border px-2.5 py-1.5 text-[11px] text-muted-foreground sm:hidden">
            <span aria-hidden="true">↔ </span>অ্যাকশন দেখতে টেবিল স্ক্রল করুন
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-maher-surface/60">
                  <TableHead>তারিখ</TableHead>
                  <TableHead>পার্টস</TableHead>
                  <TableHead className="text-right">পরিমাণ</TableHead>
                  <TableHead className="text-right">দাম</TableHead>
                  <TableHead>দোকান</TableHead>
                  <TableHead>সার্ভিস</TableHead>
                  <TableHead className="text-center">অবস্থা</TableHead>
                  <TableHead className="w-[132px] text-right">অ্যাকশন</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const legacy = row.purchaseDate === null;
                  const paid = !!row.paidAt;
                  const returned = row.partStatus === "RETURNED";
                  const costVisible = showAllCosts || !!revealedCosts[row.id];
                  const badge = RESOLUTION_BADGES[row.partStatus];
                  // Decode with the ACTIVE cipher for the row hint/tooltip only.
                  // The stored numeric unitCost stays authoritative: a code
                  // written under a different cipher decodes to a different
                  // value, so we show no decoded hint rather than wrong money.
                  const decodedCost = row.priceCode
                    ? decodeWithCipher(row.priceCode, cipher)
                    : null;
                  const decodedMatches =
                    decodedCost !== null && decodedCost === row.unitCost;
                  return (
                    <TableRow
                      key={row.id}
                      data-testid={`service-part-row-${row.id}`}
                    >
                      <TableCell className="whitespace-nowrap text-sm">
                        {row.purchaseDate !== null ? (
                          <span title={row.purchaseDate}>
                            {bengaliDateLabel(row.purchaseDate)}
                          </span>
                        ) : (
                          <span className="rounded-full border border-maher-warning/40 bg-maher-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-maher-money">
                            তারিখহীন
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        <p className="truncate font-medium" title={row.name}>
                          {row.name}
                        </p>
                        <div className="flex flex-wrap items-center gap-1">
                          {row.sku ? (
                            <span className="truncate text-[10px] text-muted-foreground">
                              {row.sku}
                            </span>
                          ) : null}
                        </div>
                        {row.paidNote ? (
                          <p
                            className="mt-0.5 line-clamp-2 whitespace-pre-line text-[10px] text-muted-foreground"
                            title={row.paidNote}
                          >
                            {readablePaidHistory(row.paidNote)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNum(row.quantity)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="min-w-0 text-right">
                            <span className="block font-semibold">
                              {costVisible ? formatTaka(row.lineCost) : "৳••••"}
                            </span>
                            {row.priceCode ? (
                              <span
                                data-testid={`part-cost-code-${row.id}`}
                                className="block text-[10px] font-medium text-maher-navy"
                                title={`কোড: ${row.priceCode}${
                                  decodedMatches
                                    ? ` ➔ ${formatTaka(row.unitCost)}`
                                    : ""
                                } — হিসেবের জন্য সবসময় দেখা যায়`}
                              >
                                কোড: {row.priceCode}
                              </span>
                            ) : null}
                            {row.priceCode && decodedMatches && costVisible ? (
                              <span
                                data-testid={`part-cost-decoded-${row.id}`}
                                data-value={String(row.unitCost)}
                                className="block text-[10px] font-bold text-maher-done"
                              >
                                ডিকোড: {toBnDigits(formatTaka(decodedCost))}
                              </span>
                            ) : null}
                            <span className="block text-[10px] text-muted-foreground">
                              {costVisible
                                ? formatTaka(row.unitCost)
                                : "৳••••"}{" "}
                              × {formatNum(row.quantity)}
                            </span>
                          </div>
                          <button
                            type="button"
                            data-testid={`part-cost-reveal-${row.id}`}
                            aria-label={
                              costVisible
                                ? "পার্টসের দাম লুকান"
                                : "পার্টসের দাম দেখুন"
                            }
                            aria-pressed={costVisible}
                            disabled={showAllCosts}
                            title={
                              showAllCosts
                                ? "সব দাম দেখানো আছে — টুলবারের বাটন দিয়ে লুকান"
                                : costVisible
                                  ? "এই লাইনের দাম লুকান"
                                  : "এই লাইনের দাম দেখুন"
                            }
                            onClick={() => toggleCost(row.id)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-maher-border/50 hover:text-maher-navy disabled:opacity-40"
                          >
                            {costVisible ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[140px] truncate text-sm">
                        {row.supplier ?? "দোকান নেই"}
                      </TableCell>
                      <TableCell className="max-w-[170px]">
                        {row.service ? (
                          <>
                            <p className="truncate text-sm" title={row.service.customerName}>
                              {row.service.customerName}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              #{row.service.id} · {row.service.model}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            মুছে ফেলা সার্ভিস
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-2">
                          <span
                            data-testid={`service-part-status-${row.id}`}
                            title={`নিষ্পত্তি: ${badge.label}`}
                            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                          <span
                            data-testid={`part-payment-mark-${row.id}`}
                            title={
                              returned
                                ? "ফেরত দেওয়া পার্টস — Paid চিহ্ন বদলানো যাবে না"
                                : paid
                                  ? "Paid শুধু লাইন চিহ্ন — কোনো পেমেন্ট নয়"
                                  : "এই লাইনে Paid চিহ্ন নেই — কোনো পেমেন্ট নয়"
                            }
                            className={
                              paid
                                ? "inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700"
                                : returned
                                  ? "inline-flex items-center rounded-full border border-maher-border bg-maher-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                  : "inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                            }
                          >
                            {paid ? <Tag className="h-2.5 w-2.5" /> : null}
                            {paid
                              ? "Paid চিহ্ন"
                              : returned
                                ? "ফেরতকৃত"
                                : "চিহ্ন নেই"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-maher-navy"
                            aria-label="নিষ্পত্তি / অবস্থা পরিবর্তন"
                            title="নিষ্পত্তি / অবস্থা পরিবর্তন"
                            data-testid={`service-part-resolve-${row.id}`}
                            onClick={() => setResolveRow(row)}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-maher-navy disabled:opacity-40"
                            disabled={returned}
                            aria-label={
                              returned
                                ? "ফেরতকৃত লাইনে Paid চিহ্ন বদলানো যাবে না"
                                : paid
                                  ? "Paid চিহ্ন বাতিল করুন"
                                  : "Paid চিহ্ন যোগ করুন"
                            }
                            title={
                              returned
                                ? "ফেরত দেওয়া লাইনের Paid চিহ্ন বদলানো যায়নি"
                                : paid
                                  ? "Paid চিহ্ন বাতিল (টাকা দেওয়ার রেকর্ড নয়)"
                                  : "Paid চিহ্ন যোগ করুন (টাকা দেওয়ার রেকর্ড নয়)"
                            }
                            data-testid={`service-part-paid-${row.id}`}
                            onClick={() =>
                              setAction({
                                kind: paid ? "unpaid" : "paid",
                                row,
                              })
                            }
                          >
                            <Tag className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-maher-due hover:text-maher-due disabled:opacity-40"
                            disabled={returned}
                            aria-label={
                              returned
                                ? "ফেরতকৃত লাইন মোছা যাবে না"
                                : "পার্টস লাইন মুছুন"
                            }
                            title="মুছুন"
                            data-testid={`service-part-delete-${row.id}`}
                            onClick={() => setAction({ kind: "delete", row })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <LedgerActionDialog
        action={action}
        supplierKey={supplier === "all" ? null : supplier}
        supplierName={supplierName}
        from={scopeFrom}
        to={scopeTo}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          refresh();
        }}
      />
      <PartResolutionDialog
        row={resolveRow}
        onClose={() => setResolveRow(null)}
        onDone={() => {
          setResolveRow(null);
          refresh();
        }}
      />
    </section>
  );
}

function SummaryCards({
  summary,
}: {
  summary: ServicePartLedgerSummaryDTO | undefined;
}) {
  const cards = [
    {
      id: "unpaid",
      label: "চিহ্ন নেই",
      value: summary ? formatTaka(summary.unpaidTotal) : "—",
      hint: summary ? `${formatNum(summary.unpaidCount)} লাইন` : "",
    },
    {
      id: "paid",
      label: "Paid চিহ্ন",
      value: summary ? formatTaka(summary.paidTotal) : "—",
      hint: summary ? `${formatNum(summary.paidCount)} লাইন` : "",
    },
    {
      id: "total",
      label: "মোট (তারিখ আছে)",
      value: summary ? formatTaka(summary.total) : "—",
      hint: summary ? `${formatNum(summary.count)} লাইন` : "",
    },
    {
      id: "legacy",
      label: "তারিখহীন",
      value: summary ? formatTaka(summary.legacyAmount) : "—",
      hint: summary ? `${formatNum(summary.legacyCount)} লাইন · মোটে নেই` : "",
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.id}
          data-testid={`parts-summary-${card.id}`}
          data-value={card.value}
          data-hint={card.hint}
          className="rounded-xl border border-maher-border bg-white p-2.5 shadow-rail"
        >
          <p className="text-[11px] font-medium text-muted-foreground">
            {card.label}
          </p>
          <p className="mt-0.5 truncate text-base font-bold tabular-nums">
            {card.value}
          </p>
          <p className="text-[10px] text-muted-foreground">{card.hint}</p>
        </div>
      ))}
    </div>
  );
}

function LedgerActionDialog({
  action,
  supplierKey,
  supplierName,
  from,
  to,
  onClose,
  onDone,
}: {
  action: LedgerAction | null;
  supplierKey: string | null;
  supplierName: string | null;
  from: string;
  to: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = action?.row;
  const legacy = !!row && row.purchaseDate === null;
  const unpaidAction = action?.kind === "unpaid" || action?.kind === "bulk-unpaid";
  const bulk = action?.kind === "bulk-paid" || action?.kind === "bulk-unpaid";

  // Fresh inputs every time a different action opens.
  useEffect(() => {
    if (!action) return;
    setNote("");
    setDate(dhakaDateKey(new Date()));
    setConfirmed(false);
    setSaving(false);
    setError(null);
  }, [action]);

  const noteRequired = unpaidAction || (action?.kind === "delete" && legacy);
  const canSubmit =
    !saving &&
    (!noteRequired || note.trim() !== "") &&
    (!(action?.kind === "paid" && legacy) || (!!date && confirmed));

  const submit = async () => {
    if (!action || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      let res: Response;
      if (bulk) {
        res = await fetch("/api/service-parts/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierKey,
            from: from || null,
            to: to || null,
            paid: action.kind === "bulk-paid",
            note: note.trim() || null,
          }),
        });
      } else if (action.kind === "delete") {
        res = await fetch(`/api/service-parts/${row!.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note: note.trim() || null,
            confirmUnknownDate: legacy && confirmed,
          }),
        });
      } else {
        res = await fetch(`/api/service-parts/${row!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paid: action.kind === "paid",
            note: note.trim() || null,
            purchaseDate:
              action.kind === "paid" && legacy ? date : null,
            confirmUnknownDate: action.kind === "paid" && legacy && confirmed,
          }),
        });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "কাজটি সম্পন্ন হয়নি");
        return;
      }
      toast.success(
        action.kind === "delete"
          ? "পার্টস লাইন মোছা হয়েছে"
          : action.kind === "unpaid" || action.kind === "bulk-unpaid"
            ? "Paid চিহ্ন বাতিল করা হয়েছে"
            : "Paid চিহ্ন যোগ করা হয়েছে"
      );
      onDone();
    } catch {
      setError("কাজটি সম্পন্ন হয়নি");
    } finally {
      setSaving(false);
    }
  };

  const title =
    action?.kind === "delete"
      ? "পার্টস লাইন মুছবেন?"
      : action?.kind === "bulk-paid"
        ? "এই দোকানের সব লাইন Paid চিহ্ন করবেন?"
        : action?.kind === "bulk-unpaid"
          ? "এই দোকানের সব লাইন Paid চিহ্ন বাতিল করবেন?"
          : action?.kind === "unpaid"
            ? "Paid চিহ্ন বাতিল করবেন?"
            : legacy
              ? "তারিখহীন লাইনে Paid চিহ্ন যোগ করবেন?"
              : "এই লাইনে Paid চিহ্ন যোগ করবেন?";

  return (
    <Dialog open={!!action} onOpenChange={(value) => !value && !saving && onClose()}>
      <DialogContent
        data-testid="service-part-action-dialog"
        className="sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {bulk
              ? `${supplierName ?? ""} — ${from || "শুরু থেকে"} থেকে ${to || "আজ"} পর্যন্ত। ৫০০-এর বেশি লাইন হলে পুরো কাজ বাতিল হবে।`
              : row
                ? `${row.name} · ${formatTaka(row.lineCost)} · ${row.supplier ?? "দোকান নেই"}`
                : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {action?.kind === "paid" && legacy ? (
            <>
              <div className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 px-3 py-2 text-xs leading-snug text-maher-money">
                এই লাইনের কেনার তারিখ নেই। Paid চিহ্ন যোগ করার আগে সঠিক তারিখ
                দিন — এই লাইনটি তখন Paid/Unpaid হিসাবে গণনা হবে।
              </div>
              <div className="space-y-1">
                <Label htmlFor="part-paid-date">কেনার তারিখ *</Label>
                <Input
                  id="part-paid-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="h-9"
                />
              </div>
            </>
          ) : null}

          <div className="space-y-1">
            <Label htmlFor="part-action-note">
              {noteRequired ? "কারণ লিখুন *" : "নোট (ঐচ্ছিক)"}
            </Label>
            <Textarea
              id="part-action-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              placeholder={
                action?.kind === "delete"
                  ? "কেন মুছছেন…"
                  : "যেমন: লাইনটির হিসাব মিলানো হয়েছে"
              }
            />
            <p className="text-[11px] text-muted-foreground">
              নোট সময়সহ ইতিহাসে যোগ হবে; পুরোনো নোট কখনো মুছবে না।
            </p>
          </div>

          {(action?.kind === "paid" && legacy) ||
          (action?.kind === "delete" && legacy) ? (
            <label className="flex items-start gap-2 text-xs leading-snug text-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                আমি নিশ্চিত — এই তারিখহীন লাইনে তারিখ/কারণসহ কাজটি করছি।
              </span>
            </label>
          ) : null}

          {action?.kind === "unpaid" || action?.kind === "bulk-unpaid" ? (
            <p className="rounded border border-maher-warning/30 bg-maher-warning/10 px-2 py-1.5 text-[11px] leading-snug text-maher-money">
              Paid চিহ্ন বাতিল করলে পরে দাম/তারিখ/দোকান বদলানো যাবে। এই কারণ
              Paid ইতিহাসে জমা থাকবে।
            </p>
          ) : null}

          {error ? (
            <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-xs font-medium text-maher-due">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="bg-white"
            onClick={onClose}
            disabled={saving}
          >
            বাতিল
          </Button>
          <Button
            type="button"
            data-testid="service-part-action-submit"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            নিশ্চিত করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Whole-line resolution of an internal part: ব্যবহৃত / স্টকে যুক্ত / ফেরত /
 * ড্যামেজ ক্ষতি. Every state has a real money/stock consequence, so the dialog
 * asks only for the fields that state needs and the server applies it in one
 * transaction. A returned line can never be marked Paid again.
 */
function PartResolutionDialog({
  row,
  onClose,
  onDone,
}: {
  row: ServicePartLedgerRowDTO | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [next, setNext] = useState<ServicePartResolutionStatus>("USED");
  const [note, setNote] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [productName, setProductName] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!row) return;
    setNext(row.partStatus);
    setNote("");
    setCategoryName("");
    setProductName(row.name);
    setSellingPrice(String(Math.round(row.unitCost * 1.2)));
    setSaving(false);
    setError(null);
  }, [row]);

  const isStock = next === "MOVED_TO_STOCK";
  const isReturn = next === "RETURNED";
  const isDamage = next === "DAMAGED";
  const canSubmit =
    !!row &&
    !saving &&
    next !== row.partStatus &&
    (!isReturn || note.trim() !== "") &&
    (!isStock || categoryName.trim() !== "");

  const submit = async () => {
    if (!row || !canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        partStatus: next,
        resolutionNote: note.trim() || null,
      };
      if (isStock) {
        body.categoryName = categoryName.trim();
        body.productName = productName.trim() || row.name;
        body.sellingPrice = sellingPrice.trim() || undefined;
      }
      const res = await fetch(`/api/service-parts/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "নিষ্পত্তি সম্পন্ন হয়নি");
        return;
      }
      toast.success("পার্টসের নিষ্পত্তি সংরক্ষিত হয়েছে");
      onDone();
    } catch {
      setError("নিষ্পত্তি সম্পন্ন হয়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!row}
      onOpenChange={(value) => !value && !saving && onClose()}
    >
      <DialogContent
        data-testid="service-part-resolution-dialog"
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>নিষ্পত্তি / অবস্থা পরিবর্তন</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.name} · ${formatTaka(row.lineCost)} · ${row.supplier ?? "দোকান নেই"}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div
            role="radiogroup"
            aria-label="পার্টস নিষ্পত্তির অবস্থা"
            className="grid grid-cols-2 gap-2"
          >
            {RESOLUTION_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = next === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  data-testid={`resolution-option-${option.key}`}
                  onClick={() => setNext(option.key)}
                  className={
                    active
                      ? "flex flex-col items-start gap-0.5 rounded-xl border border-maher-navy bg-maher-blue-soft px-3 py-2 text-left text-maher-navy"
                      : "flex flex-col items-start gap-0.5 rounded-xl border border-maher-border bg-white px-3 py-2 text-left text-foreground hover:border-maher-navy/35"
                  }
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Icon className="h-4 w-4" /> {option.label}
                  </span>
                  <span className="text-[10px] leading-snug text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {isStock && row ? (
            <>
              <div className="rounded-lg border border-maher-navy/20 bg-maher-blue-soft px-3 py-2 text-xs leading-snug text-maher-navy">
                কেনার দাম {formatTaka(row.unitCost)} — এটি পরিবর্তন করা যাবে না।
                নিচের বিক্রয় দাম দিয়ে স্টকে যুক্ত হবে।
              </div>
              <div className="space-y-1">
                <Label htmlFor="resolution-category">ক্যাটাগরির নাম *</Label>
                <Input
                  id="resolution-category"
                  value={categoryName}
                  onChange={(event) => setCategoryName(event.target.value)}
                  placeholder="যেমন: ডিসপ্লে"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="resolution-product">প্রোডাক্টের নাম</Label>
                <Input
                  id="resolution-product"
                  value={productName}
                  onChange={(event) => setProductName(event.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="resolution-price">বিক্রয় দাম (আনুমানিক)</Label>
                <Input
                  id="resolution-price"
                  inputMode="numeric"
                  value={sellingPrice}
                  onChange={(event) => setSellingPrice(event.target.value)}
                  className="h-9"
                />
              </div>
            </>
          ) : null}

          {isReturn ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="resolution-note">ফেরতের কারণ *</Label>
                <Textarea
                  id="resolution-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={2}
                  placeholder="কোনো কারণে ফেরত দেওয়া হয়েছে…"
                />
              </div>
              <p className="rounded border border-maher-warning/30 bg-maher-warning/10 px-2 py-1.5 text-[11px] leading-snug text-maher-money">
                ফেরতকৃত লাইনের Paid চিহ্ন বাতিল হবে, স্টক যোগ হবে না এবং দোকানের
                বাকি থেকে বাদ যাবে। কারণ ইতিহাসে জমা থাকবে।
              </p>
            </>
          ) : null}

          {isDamage && row ? (
            <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-[11px] leading-snug text-maher-due">
              পুরো {formatTaka(row.lineCost)} দোকানের ড্যামেজ ক্ষতিতে যোগ হবে।
              কাস্টমারের বিল অপরিবর্তিত থাকবে; সাপ্লায়ারের বাকি থেকে বাদ যাবে না।
            </p>
          ) : null}

          {!isReturn ? (
            <div className="space-y-1">
              <Label htmlFor="resolution-note">নোট (ঐচ্ছিক)</Label>
              <Textarea
                id="resolution-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                placeholder="নিষ্পত্তির কারণ বা মন্তব্য…"
              />
            </div>
          ) : null}

          {error ? (
            <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-xs font-medium text-maher-due">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="bg-white"
            onClick={onClose}
            disabled={saving}
          >
            বাতিল
          </Button>
          <Button
            type="button"
            data-testid="service-part-resolution-submit"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            নিষ্পত্তি সংরক্ষণ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
