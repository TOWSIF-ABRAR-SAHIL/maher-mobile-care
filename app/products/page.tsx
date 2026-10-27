"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Boxes,
  Coins,
  Layers,
  Loader2,
  Package,
  PackagePlus,
  PackageX,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/AppHeader";
import { PageLead } from "@/components/PageLead";
import { ShopFooter } from "@/components/ShopFooter";
import { ProductDialog } from "@/components/ProductDialog";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatNum, formatTaka } from "@/lib/utils";
import type {
  ProductDTO,
  ProductListResponse,
  ServiceDTO,
  StockStatus,
} from "@/lib/types";

type StatusFilter = "all" | StockStatus;
type SortKey = "name" | "recent" | "stock" | "selling";

const STATUS_STYLE: Record<StockStatus, string> = {
  in: "border-maher-done/35 bg-maher-done/10 text-maher-done",
  low: "border-maher-warning/40 bg-maher-warning/10 text-maher-money",
  out: "border-maher-due/30 bg-maher-due/10 text-maher-due-ink",
};

const STATUS_TEXT: Record<StockStatus, string> = {
  in: "স্টকে আছে",
  low: "কম স্টক",
  out: "স্টক নেই",
};

export default function ProductsPage() {
  const router = useRouter();
  const [data, setData] = useState<ProductListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [categoryId, setCategoryId] = useState("all");
  const [sort, setSort] = useState<SortKey>("name");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductDTO | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ProductDTO | null>(null);
  const [archiving, setArchiving] = useState(false);

  const reqId = useRef(0);

  // ?status=low deep-links from the old stock pulse still work.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("status");
    if (raw === "in" || raw === "low" || raw === "out") setStatus(raw);
  }, []);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setRefreshing(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (status !== "all") params.set("status", status);
      if (categoryId !== "all") params.set("categoryId", categoryId);
      params.set("sort", sort);

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
  }, [query, status, categoryId, sort]);

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
    query.trim() !== "" || status !== "all" || categoryId !== "all";

  /** One click back to the full inventory from an empty filtered view. */
  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setCategoryId("all");
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

  const cards = [
    {
      label: "মোট প্রোডাক্ট",
      value: summary ? formatNum(summary.totalProducts) : "—",
      hint: "টি আইটেম",
      icon: Package,
      tone: "text-maher-navy",
    },
    {
      label: "ক্যাটাগরি",
      value: summary ? formatNum(summary.categories) : "—",
      hint: "টি বিভাগ",
      icon: Layers,
      tone: "text-maher-royal",
    },
    {
      label: "মোট ইউনিট",
      value: summary ? formatNum(summary.units) : "—",
      hint: "পিস স্টকে",
      icon: Boxes,
      tone: "text-maher-navy-light",
    },
    {
      label: "কম স্টক",
      value: summary ? formatNum(summary.lowStock) : "—",
      hint: "সীমার নিচে/সমান",
      icon: AlertTriangle,
      tone: "text-maher-warning",
    },
    {
      label: "স্টক নেই",
      value: summary ? formatNum(summary.outOfStock) : "—",
      hint: "শূন্য স্টক",
      icon: PackageX,
      tone: "text-maher-due",
    },
    {
      label: "ইনভেন্টরি মূল্য",
      value: summary ? formatTaka(summary.inventoryValue) : "—",
      hint: "স্টক × ক্রয় মূল্য",
      icon: Coins,
      tone: "text-maher-money",
    },
  ];

  return (
    <div className="min-h-dvh bg-maher-surface">
      <div
        aria-hidden={!refreshing}
        className={`fixed inset-x-0 top-0 z-[60] h-0.5 bg-maher-navy transition-opacity duration-150 ${
          refreshing ? "animate-pulse opacity-100" : "opacity-0"
        }`}
      />
      <main className="mx-auto w-full max-w-7xl space-y-3 px-3 py-3 xl:max-w-[1440px] 2xl:max-w-[1600px]">
        <AppHeader
          searchRefreshKey={0}
          onSearchEdit={openServiceFromSearch}
          onSearchReceipt={openServiceFromSearch}
        />

        <PageLead
          eyebrow="স্টক রুম"
          title="প্রোডাক্ট ও ইনভেন্টরি"
          description="স্টক, দাম, ক্যাটাগরি ও কম-স্টকের সতর্কতা — সবই আসল ইনভেন্টরি ডেটা থেকে।"
          meta={
            <span className="inline-flex items-center rounded-full border border-maher-border bg-white px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
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
                ক্যাটাগরি
              </Button>
              <Button type="button" onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" />
                নতুন প্রোডাক্ট
              </Button>
            </>
          }
        />

        {/* Summary cards — always describe the whole active inventory. */}
        <section
          aria-label="ইনভেন্টরি সারসংক্ষেপ"
          data-testid="inventory-summary"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
        >
          {cards.map(({ label, value, hint, icon: Icon, tone }) => (
            <div
              key={label}
              className="rounded-xl border border-maher-border bg-white p-3 shadow-rail sheen"
            >
              <div className="flex items-center justify-between gap-1">
                <p className="text-[11px] font-medium text-muted-foreground sm:text-xs">
                  {label}
                </p>
                <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
              </div>
              <p className="mt-1 truncate text-lg font-bold tracking-tight sm:text-xl">
                {value}
              </p>
              <p className="text-[10px] text-muted-foreground sm:text-[11px]">
                {hint}
              </p>
            </div>
          ))}
        </section>

        {/* Toolbar */}
        <section
          aria-label="ফিল্টার"
          className="flex flex-col gap-2 rounded-xl border border-maher-border bg-white p-2.5 shadow-card lg:flex-row lg:items-center"
        >
          <div className="relative min-w-0 lg:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="নাম, SKU, ক্যাটাগরি বা বারকোড খুঁজুন"
              className="pl-8"
              aria-label="প্রোডাক্ট খুঁজুন"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:w-auto">
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as StatusFilter)}
            >
              <SelectTrigger className="lg:w-[135px]" aria-label="স্টক অবস্থা">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">সব স্টক</SelectItem>
                <SelectItem value="in">স্টকে আছে</SelectItem>
                <SelectItem value="low">কম স্টক</SelectItem>
                <SelectItem value="out">স্টক নেই</SelectItem>
              </SelectContent>
            </Select>

            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="lg:w-[150px]" aria-label="ক্যাটাগরি">
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

            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SortKey)}
            >
              <SelectTrigger
                className="col-span-2 sm:col-span-1 lg:w-[150px]"
                aria-label="সাজান"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">নাম (ক→খ)</SelectItem>
                <SelectItem value="recent">নতুন আগে</SelectItem>
                <SelectItem value="stock">স্টক (বেশি→কম)</SelectItem>
                <SelectItem value="selling">দাম (বেশি→কম)</SelectItem>
              </SelectContent>
            </Select>
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
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-maher-navy">
              প্রোডাক্ট তালিকা
            </h2>
            <p className="text-xs text-muted-foreground">
              {data ? `${formatNum(products.length)}টি দেখানো হচ্ছে` : "…"}
            </p>
          </div>

          {loading && !data ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <Skeleton key={n} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : products.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-maher-border bg-white px-4 py-12 text-center shadow-card">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-maher-blue-soft text-maher-navy">
                <ShoppingBag className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold">
                {data && data.summary.totalProducts === 0
                  ? "এখনো কোনো প্রোডাক্ট নেই"
                  : "এই ফিল্টারে কোনো প্রোডাক্ট নেই"}
              </p>
              <p className="max-w-sm text-xs text-muted-foreground">
                {data && data.summary.totalProducts === 0
                  ? "ক্যাটাগরি তৈরি করে প্রথম প্রোডাক্ট যোগ করুন।"
                  : "খোঁজা বা ফিল্টার বদলে আবার দেখুন।"}
              </p>
              {data && data.summary.totalProducts === 0 ? (
                <Button size="sm" className="mt-1" onClick={openCreate}>
                  <PackagePlus className="mr-1 h-4 w-4" />
                  প্রথম প্রোডাক্ট যোগ করুন
                </Button>
              ) : filtersActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={clearFilters}
                >
                  ফিল্টার সরান
                </Button>
              ) : null}
            </div>
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
                        <TableHead className="text-right">বিক্রয়</TableHead>
                        <TableHead className="text-right">ক্রয়</TableHead>
                        <TableHead className="w-[92px] text-right">
                          অ্যাকশন
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {products.map((product) => (
                        <TableRow key={product.id}>
                          <TableCell className="max-w-[260px]">
                            <p className="truncate font-medium">
                              {product.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {[product.brand, product.sku, product.barcode]
                                .filter(Boolean)
                                .join(" • ") || "—"}
                            </p>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm">
                            {product.categoryName}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="font-semibold">
                              {formatNum(product.stock)}
                            </span>
                            <span className="ml-1 text-xs text-muted-foreground">
                              পিস
                            </span>
                            <Badge
                              variant="outline"
                              className={`ml-1.5 ${STATUS_STYLE[product.status]}`}
                            >
                              {STATUS_TEXT[product.status]}
                            </Badge>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">
                            {formatTaka(product.sellingPrice)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground">
                            {formatTaka(product.purchasePrice)}
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
                        <p className="truncate text-sm font-semibold">
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
                        <strong className="text-sm">
                          {formatNum(product.stock)}
                        </strong>{" "}
                        পিস
                      </span>
                      <span className="text-muted-foreground">
                        বিক্রয়{" "}
                        <span className="font-semibold text-foreground">
                          {formatTaka(product.sellingPrice)}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        ক্রয় {formatTaka(product.purchasePrice)}
                      </span>
                    </div>
                    {(product.sku || product.barcode) && (
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {[product.sku, product.barcode]
                          .filter(Boolean)
                          .join(" • ")}
                      </p>
                    )}

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
    </div>
  );
}
