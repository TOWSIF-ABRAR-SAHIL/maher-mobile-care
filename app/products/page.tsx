"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Eye,
  EyeOff,
  Loader2,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { useAppHeader } from "@/components/AppChrome";
import { PageLead } from "@/components/PageLead";
import { ShopFooter } from "@/components/ShopFooter";
import { ProductDialog } from "@/components/ProductDialog";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dhakaDateKey } from "@/lib/dhaka";
import { formatNum, formatTaka, parseBnNumber } from "@/lib/utils";
import type {
  ProductDTO,
  ProductListResponse,
  ServiceDTO,
  StockStatus,
} from "@/lib/types";

const STATUS_STYLE: Record<StockStatus, string> = {
  in: "border-maher-done/35 bg-maher-done/10 text-maher-done",
  low: "border-maher-warning/40 bg-maher-warning/10 text-maher-money",
  out: "border-maher-due/30 bg-maher-due/10 text-maher-due-ink",
};

const STATUS_TEXT: Record<StockStatus, string> = {
  in: "স্টকে আছে",
  low: "কম স্টক",
  out: "স্টক শেষ",
};

const DOT_STYLE: Record<StockStatus, string> = {
  in: "bg-maher-done",
  low: "bg-maher-warning",
  out: "bg-maher-due",
};

export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [stockStatus, setStockStatus] = useState<StockStatus | "all">("all");
  const [valueVisible, setValueVisible] = useState(false);

  const [restockTarget, setRestockTarget] = useState<ProductDTO | null>(null);
  const [restockQty, setRestockQty] = useState("");
  const [restockError, setRestockError] = useState<string | null>(null);
  const [restocking, setRestocking] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductDTO | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProductDTO | null>(null);
  const [archiving, setArchiving] = useState(false);

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (categoryId !== "all") params.set("categoryId", categoryId);
      if (stockStatus !== "all") params.set("status", stockStatus);
      // The simplified list keeps one predictable order (name A→Z).
      params.set("sort", "name");

      const res = await fetch(`/api/products?${params.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (reqId.current !== my) return;
      if (!res.ok) {
        setError(json?.error || "প্রোডাক্ট লোড করা যায়নি");
        return;
      }
      setData(json as ProductListResponse);
    } catch {
      if (reqId.current !== my) return;
      setError("প্রোডাক্ট লোড করা যায়নি");
    } finally {
      if (reqId.current === my) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [query, categoryId, stockStatus]);

  // Typing waits a beat; switching a filter is immediate.
  useEffect(() => {
    const timer = setTimeout(() => void load(), query.trim() ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const openCreate = () => {
    if (!data || data.categories.length === 0) {
      toast.info("আগে একটি ক্যাটাগরি যোগ করুন");
      setCategoriesOpen(true);
      return;
    }
    setEditProduct(null);
    setDialogOpen(true);
  };

  const openEdit = (product: ProductDTO) => {
    setEditProduct(product);
    setDialogOpen(true);
  };

  const filtersActive =
    query.trim() !== "" || categoryId !== "all" || stockStatus !== "all";

  /** One click back to the full inventory from an empty filtered view. */
  const clearFilters = () => {
    setQuery("");
    setCategoryId("all");
    setStockStatus("all");
  };

  // The internal valuation is masked again after ten seconds on the counter.
  useEffect(() => {
    if (!valueVisible) return;
    const timer = setTimeout(() => setValueVisible(false), 10000);
    return () => clearTimeout(timer);
  }, [valueVisible]);

  const openRestock = (product: ProductDTO) => {
    setRestockTarget(product);
    setRestockQty("");
    setRestockError(null);
  };

  const submitRestock = async () => {
    if (!restockTarget || restocking) return;
    const quantity = parseBnNumber(restockQty);
    if (quantity === null || quantity < 1) {
      setRestockError("সঠিক সংখ্যা দিন (কমপক্ষে ১)");
      return;
    }
    setRestocking(true);
    setRestockError(null);
    try {
      const res = await fetch(`/api/products/${restockTarget.id}/restock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity, reason: "কুইক স্টক ইন" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "স্টক যোগ করা যায়নি");
      toast.success(`${quantity} পিস স্টকে যোগ হয়েছে`);
      setRestockTarget(null);
      await load();
    } catch (err) {
      setRestockError(
        err instanceof Error ? err.message : "স্টক যোগ করা যায়নি"
      );
    } finally {
      setRestocking(false);
    }
  };

  /** Global search belongs to the shared chrome; from inventory it opens the
   *  matching service row on the Service desk. */
  const openServiceFromSearch = (service: ServiceDTO) => {
    router.push(
      `/service?date=${dhakaDateKey(service.serviceDate)}&edit=${service.id}`
    );
  };

  const archive = async () => {
    if (!archiveTarget || archiving) return;
    const target = archiveTarget;
    setArchiving(true);
    try {
      const res = await fetch(`/api/products/${target.id}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json?.error || "প্রোডাক্ট আর্কাইভ করা যায়নি");
        return;
      }
      toast.success(`"${target.name}" আর্কাইভ হয়েছে`);
      setArchiveTarget(null);
      await load();
    } catch {
      toast.error("প্রোডাক্ট আর্কাইভ করা যায়নি");
    } finally {
      setArchiving(false);
    }
  };

  const summary = data?.summary;
  const products = data?.products ?? [];
  const categories = data?.categories ?? [];

  // Same persistent masthead as the service desk; inventory search opens the
  // matching service row back on /service.
  useAppHeader({
    searchRefreshKey: 0,
    onSearchEdit: openServiceFromSearch,
    onSearchReceipt: openServiceFromSearch,
  });

  return (
    <div className="flex min-h-dvh flex-col bg-maher-surface">
      <div
        aria-hidden={!refreshing}
        className={`fixed inset-x-0 top-0 z-[60] h-0.5 bg-maher-navy transition-opacity duration-150 ${
          refreshing ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-2 px-3 py-2 xl:max-w-[1600px] 2xl:max-w-[1840px]">
        <PageLead
          eyebrow="স্টক রুম"
          title="প্রোডাক্ট ও ইনভেন্টরি"
          meta={
            <span
              data-testid="product-count-badge"
              className="inline-flex items-center rounded-full border border-maher-border bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              {summary ? `${formatNum(summary.totalProducts)}টি প্রোডাক্ট` : "…"}
            </span>
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCategoriesOpen(true)}
                className="bg-white"
              >
                <Settings2 className="mr-1 h-4 w-4" />
                ক্যাটাগরি ব্যবস্থাপনা
              </Button>
              <Button type="button" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" />
                নতুন প্রোডাক্ট
              </Button>
            </>
          }
        />

        <section
          aria-label="সারাংশ কার্ড"
          data-testid="product-metrics"
          className="grid grid-cols-2 gap-2 lg:grid-cols-4"
        >
          <div
            data-testid="product-metric-total"
            className="rounded-xl border border-maher-border bg-white px-3 py-2 shadow-card"
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                মোট প্রোডাক্ট / আইটেম
              </p>
              <span
                data-testid="product-metric-icon-total"
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-600"
              >
                <Package className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-maher-navy">
              {summary ? `${formatNum(summary.totalProducts)}টি আইটেম` : "…"}
            </p>
          </div>
          <div
            data-testid="product-metric-stock"
            className="rounded-xl border border-maher-border bg-white px-3 py-2 shadow-card"
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                মোট মজুদ স্টক
              </p>
              <span
                data-testid="product-metric-icon-stock"
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-600"
              >
                <Boxes className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-maher-navy">
              {summary ? `${formatNum(summary.units)} পিস` : "…"}
            </p>
          </div>
          <button
            type="button"
            data-testid="product-metric-low"
            onClick={() => {
              setQuery("");
              setCategoryId("all");
              setStockStatus("low");
            }}
            aria-pressed={stockStatus === "low"}
            title="কম স্টক থাকা আইটেমগুলো দেখুন"
            className={`rounded-xl border bg-white px-3 py-2 text-left shadow-card transition hover:border-maher-warning hover:bg-maher-warning/5 ${stockStatus === "low" ? "border-maher-warning bg-maher-warning/5" : "border-maher-warning/40"}`}
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                ⚠️ কম স্টক সতর্কতা
              </p>
              <span
                data-testid="product-metric-icon-low"
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </div>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-maher-money">
              {summary ? `${formatNum(summary.lowStock)}টি আইটেম` : "…"}
            </p>
          </button>
          <div
            data-testid="product-metric-value"
            className="rounded-xl border border-maher-border bg-white px-3 py-2 shadow-card"
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[11px] font-medium text-muted-foreground">
                ইনভেন্টরি মোট মূল্য
              </p>
              <div className="flex shrink-0 items-center gap-0.5">
                <span
                  data-testid="product-metric-icon-value"
                  aria-hidden="true"
                  className="grid h-6 w-6 place-items-center rounded-md bg-slate-100 text-slate-500"
                >
                  <Wallet className="h-3.5 w-3.5" />
                </span>
                <button
                  type="button"
                  data-testid="product-value-toggle"
                  aria-label={
                    valueVisible
                      ? "ইনভেন্টরি মূল্য লুকান"
                      : "ইনভেন্টরি মূল্য দেখুন"
                  }
                  title="দোকানের ক্রয়মূল্য ও ইনভেন্টরি মূল্য দেখুন (১০ সেকেন্ড)"
                  onClick={() => setValueVisible((visible) => !visible)}
                  className="rounded-md p-0.5 text-muted-foreground transition hover:bg-maher-blue-soft hover:text-maher-navy"
                >
                  {valueVisible ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            {valueVisible ? (
              <p
                data-testid="product-value-revealed"
                className="mt-0.5 text-lg font-semibold tabular-nums text-maher-navy"
              >
                {formatTaka(summary?.inventoryValue ?? 0)}
              </p>
            ) : (
              <p
                data-testid="product-value-hidden"
                className="mt-0.5 text-lg font-semibold tracking-widest text-maher-navy"
              >
                ৳••••
              </p>
            )}
          </div>
        </section>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-maher-due/30 bg-maher-due/10 px-3 py-2 text-sm text-maher-due">
            <span>{error}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              className="bg-white"
            >
              আবার চেষ্টা করুন
            </Button>
          </div>
        )}

        <section aria-label="প্রোডাক্ট তালিকা" data-testid="products-list">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="text-sm font-semibold text-maher-navy">
              প্রোডাক্ট তালিকা
            </h2>
            <p className="text-xs text-muted-foreground">
              {data ? `${formatNum(products.length)}টি দেখানো হচ্ছে` : "…"}
            </p>
          </div>

          <div
            role="group"
            aria-label="ফিল্টার"
            data-testid="product-filter-bar"
            className="mb-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <div className="relative w-full sm:w-64 lg:w-80">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="product-search"
                data-testid="product-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="নাম, ব্র্যান্ড, SKU, বারকোড বা ক্যাটাগরি খুঁজুন"
                className="bg-white pl-8"
                aria-label="প্রোডাক্ট খুঁজুন (নাম, ব্র্যান্ড, SKU, বারকোড বা ক্যাটাগরি)"
                title="এই খোঁজা শুধু প্রোডাক্ট তালিকার মধ্যে কাজ করে"
              />
            </div>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger
                className="w-full sm:w-[170px]"
                aria-label="ক্যাটাগরি ফিল্টার"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব ক্যাটাগরি</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={String(category.id)}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filtersActive ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearFilters}
                className="h-9 text-muted-foreground hover:text-maher-navy"
              >
                ফিল্টার সরান
              </Button>
            ) : null}
          </div>

          <div
            role="group"
            aria-label="স্টক স্ট্যাটাস ফিল্টার"
            className="mb-2 flex flex-wrap items-center gap-1.5"
          >
            {(
              [
                {
                  key: "all" as const,
                  id: "product-status-all",
                  label: "সব প্রোডাক্ট",
                  count: summary?.totalProducts ?? 0,
                },
                {
                  key: "in" as const,
                  id: "product-status-in",
                  label: "পর্যাপ্ত স্টক",
                  count: Math.max(
                    0,
                    (summary?.totalProducts ?? 0) -
                      (summary?.lowStock ?? 0) -
                      (summary?.outOfStock ?? 0)
                  ),
                },
                {
                  key: "low" as const,
                  id: "product-status-low",
                  label: "⚠️ কম স্টক",
                  count: summary?.lowStock ?? 0,
                },
                {
                  key: "out" as const,
                  id: "product-status-out",
                  label: "❌ স্টক শেষ",
                  count: summary?.outOfStock ?? 0,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                data-testid={tab.id}
                aria-pressed={stockStatus === tab.key}
                onClick={() => setStockStatus(tab.key)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition ${
                  stockStatus === tab.key
                    ? "border-maher-navy bg-maher-navy font-semibold text-white"
                    : "border-maher-border bg-white font-medium text-muted-foreground hover:border-maher-navy/35 hover:text-maher-navy"
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1 text-[10px] tabular-nums ${
                    stockStatus === tab.key
                      ? "bg-white/20 text-white"
                      : "bg-maher-surface text-muted-foreground"
                  }`}
                >
                  {formatNum(tab.count)}
                </span>
              </button>
            ))}
          </div>

          {loading && !data ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <Skeleton key={n} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : products.length === 0 ? (
            data && data.summary.totalProducts === 0 ? (
              <div
                data-testid="product-empty-onboarding"
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-maher-border bg-white px-4 py-12 text-center shadow-card"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-maher-blue-soft text-maher-navy">
                  <ShoppingBag className="h-6 w-6" />
                </span>
                <p className="text-sm font-semibold">
                  আপনার স্টকে এখনো কোনো প্রোডাক্ট যুক্ত করা হয়নি
                </p>
                <p className="max-w-sm text-xs leading-snug text-muted-foreground">
                  প্রথমে একটি ক্যাটাগরি তৈরি করে আপনার মালামাল যুক্ত করা শুরু
                  করুন
                </p>
                {categories.length === 0 ? (
                  <Button
                    size="sm"
                    className="mt-1"
                    data-testid="product-empty-category"
                    onClick={() => setCategoriesOpen(true)}
                  >
                    <Settings2 className="mr-1 h-4 w-4" />
                    প্রথম ক্যাটাগরি যোগ করুন
                  </Button>
                ) : (
                  <Button size="sm" className="mt-1" onClick={openCreate}>
                    <PackagePlus className="mr-1 h-4 w-4" />
                    প্রথম প্রোডাক্ট যোগ করুন
                  </Button>
                )}
              </div>
            ) : (
              <div
                data-testid="product-empty-filtered"
                className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-maher-border bg-white px-4 py-12 text-center shadow-card"
              >
                <span className="grid h-12 w-12 place-items-center rounded-full bg-maher-blue-soft text-maher-navy">
                  <Search className="h-6 w-6" />
                </span>
                <p className="text-sm font-semibold">
                  কোনো প্রোডাক্ট খুঁজে পাওয়া যায়নি
                </p>
                <p className="max-w-sm text-xs leading-snug text-muted-foreground">
                  খোঁজা বা ফিল্টার বদলে আবার দেখুন।
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  data-testid="product-empty-reset"
                  onClick={clearFilters}
                >
                  ফিল্টার রিসেট করুন
                </Button>
              </div>
            )
          ) : (
            <>
              {/* Tablet/desktop table */}
              <div className="hidden overflow-hidden rounded-xl border border-maher-border bg-white shadow-card md:block">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-maher-surface/60">
                        <TableHead>প্রোডাক্ট</TableHead>
                        <TableHead>ক্যাটাগরি</TableHead>
                        <TableHead>স্টক</TableHead>
                        <TableHead className="text-right">বিক্রয় মূল্য</TableHead>
                        <TableHead className="w-[92px] text-right">
                          অ্যাকশন
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="max-w-[260px]">
                            <p className="truncate font-medium" title={product.name}>
                              {product.name}
                            </p>
                            {product.brand ? (
                              <p className="truncate text-xs text-muted-foreground">
                                ব্র্যান্ড: {product.brand}
                              </p>
                            ) : null}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            <span
                              data-testid={`product-category-${product.id}`}
                              className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                            >
                              {product.categoryName}
                            </span>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
                                <span
                                  aria-hidden="true"
                                  className={`h-1.5 w-1.5 rounded-full ${DOT_STYLE[product.status]}`}
                                />
                                {formatNum(product.stock)}
                                <span className="text-xs font-normal text-muted-foreground">
                                  পিস
                                </span>
                              </span>
                              {product.status !== "in" ? (
                                <Badge
                                  variant="outline"
                                  className={STATUS_STYLE[product.status]}
                                >
                                  {STATUS_TEXT[product.status]}
                                </Badge>
                              ) : null}
                              <button
                                type="button"
                                data-testid={`product-stock-add-${product.id}`}
                                onClick={() => openRestock(product)}
                                title={`${product.name} — স্টক যোগ করুন`}
                                className="rounded-md border border-maher-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-maher-navy transition hover:border-maher-navy/40 hover:bg-maher-blue-soft"
                              >
                                + যোগ
                              </button>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">
                            {formatTaka(product.sellingPrice)}
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0"
                                onClick={() => openEdit(product)}
                                aria-label={`${product.name} বদলান`}
                                title="বদলান"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-maher-due hover:text-maher-due"
                                onClick={() => setArchiveTarget(product)}
                                aria-label={`${product.name} আর্কাইভ করুন`}
                                title="আর্কাইভ করুন"
                              >
                                <Archive className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Phone cards */}
              <div className="space-y-2 md:hidden">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-xl border border-maher-border bg-white p-3 shadow-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold" title={product.name}>
                          {product.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {product.categoryName}
                          {product.brand ? ` • ${product.brand}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 ${STATUS_STYLE[product.status]}`}
                      >
                        {STATUS_TEXT[product.status]}
                      </Badge>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>
                        স্টক{" "}
                        <strong className="text-sm tabular-nums">
                          {formatNum(product.stock)}
                        </strong>{" "}
                        পিস
                      </span>
                      {product.status !== "in" ? (
                        <Badge
                          variant="outline"
                          className={STATUS_STYLE[product.status]}
                        >
                          {STATUS_TEXT[product.status]}
                        </Badge>
                      ) : null}
                      <button
                        type="button"
                        data-testid={`product-stock-add-mobile-${product.id}`}
                        onClick={() => openRestock(product)}
                        className="rounded-md border border-maher-border bg-white px-2 py-0.5 text-[11px] font-medium text-maher-navy"
                      >
                        + যোগ
                      </button>
                      <span className="text-muted-foreground">
                        বিক্রয় মূল্য{" "}
                        <span className="font-semibold text-foreground">
                          {formatTaka(product.sellingPrice)}
                        </span>
                      </span>
                    </div>

                    <div className="mt-2 flex justify-end gap-1 border-t pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openEdit(product)}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        বদলান
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-maher-due hover:text-maher-due"
                        onClick={() => setArchiveTarget(product)}
                      >
                        <Archive className="mr-1 h-3.5 w-3.5" />
                        আর্কাইভ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </main>

      <ShopFooter />

      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editProduct}
        categories={categories}
        onSaved={() => void load()}
      />

      <CategoryManagerDialog
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        categories={categories}
        onChanged={() => void load()}
      />

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(open) => {
          if (!open && !archiving) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>প্রোডাক্ট আর্কাইভ করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              “{archiveTarget?.name}” তালিকা থেকে সরে যাবে, কিন্তু বিক্রয় ও
              স্টকের পুরোনো রেকর্ড ঠিক থাকবে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiving}>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiving}
              className="bg-maher-due hover:bg-maher-due/90"
              onClick={(event) => {
                event.preventDefault();
                void archive();
              }}
            >
              {archiving && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              আর্কাইভ করুন
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!restockTarget}
        onOpenChange={(open) => {
          if (!open && !restocking) setRestockTarget(null);
        }}
      >
        <DialogContent data-testid="quick-stock-dialog" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>+ স্টক যোগ করুন</DialogTitle>
            <DialogDescription>
              {restockTarget?.name} — কত পিস যোগ করবেন?
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRestock();
            }}
          >
            <Label htmlFor="quick-stock-qty">পরিমাণ (পিস)</Label>
            <Input
              id="quick-stock-qty"
              data-testid="quick-stock-qty"
              value={restockQty}
              onChange={(event) => {
                setRestockQty(event.target.value);
                setRestockError(null);
              }}
              inputMode="numeric"
              placeholder="যেমন: 5"
              autoFocus
            />
            {restockError ? (
              <p className="text-xs text-maher-due">{restockError}</p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={restocking}
                onClick={() => setRestockTarget(null)}
              >
                বাতিল
              </Button>
              <Button type="submit" data-testid="quick-stock-confirm" disabled={restocking}>
                {restocking ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : null}
                স্টক যোগ করুন
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
