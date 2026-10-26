import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  PackageCheck,
  PackageX,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, toBnDigits } from "@/lib/utils";
import type { ProductListResponse } from "@/lib/types";

/**
 * Real stock health only. Counts come from the product summary (non-archived
 * rows, each product's own lowStockThreshold), never from a guessed limit.
 * Stock-in/out dialogs do not exist yet, so no "add stock" button is shown.
 */
export function InventoryPulse({
  products,
  loading,
}: {
  products: ProductListResponse | null;
  loading: boolean;
}) {
  const summary = products?.summary;
  const lowProducts = (products?.products ?? [])
    .filter((product) => product.status !== "in")
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "out" ? -1 : 1;
      return a.stock - b.stock || a.name.localeCompare(b.name, "bn");
    })
    .slice(0, 3);
  const needsStock = (summary?.lowStock ?? 0) + (summary?.outOfStock ?? 0) > 0;

  return (
    <section
      data-testid="home-low-stock"
      aria-labelledby="home-stock-title"
      className="flex h-full flex-col overflow-hidden rounded-xl border border-maher-border bg-white"
    >
      <div className="flex items-start justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Boxes className="h-3.5 w-3.5 text-maher-navy" />
          <div>
            <h2
              id="home-stock-title"
              className="text-[13px] font-semibold tracking-tight text-maher-ink"
            >
              ইনভেন্টরি ও স্টক
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              বাস্তব স্টক ও প্রতি প্রোডাক্টের সীমা
            </p>
          </div>
        </div>
        <Link
          href="/products"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-maher-navy transition-colors hover:text-maher-blue"
        >
          সব দেখুন
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {loading || !summary ? (
        <div className="flex flex-1 flex-col p-4">
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
          <Skeleton className="mt-4 h-10 w-full" />
          <Skeleton className="mt-3 h-6 w-24" />
        </div>
      ) : (
        <div className="flex flex-1 flex-col p-4">
          <dl className="grid grid-cols-3 divide-x divide-maher-border">
            <div className="pr-3">
              <dt className="text-[10px] font-medium text-muted-foreground">
                মোট প্রোডাক্ট
              </dt>
              <dd className="mt-1 text-[20px] font-bold leading-none tabular-nums text-maher-ink">
                {toBnDigits(summary.totalProducts)}
              </dd>
            </div>
            <div className="px-3">
              <dt
                className={cn(
                  "text-[10px] font-medium",
                  summary.lowStock > 0
                    ? "text-amber-700"
                    : "text-muted-foreground"
                )}
              >
                কম স্টক
              </dt>
              <dd
                className={cn(
                  "mt-1 text-[20px] font-bold leading-none tabular-nums",
                  summary.lowStock > 0
                    ? "text-amber-700"
                    : "text-muted-foreground"
                )}
              >
                {toBnDigits(summary.lowStock)}
              </dd>
            </div>
            <div className="pl-3">
              <dt
                className={cn(
                  "text-[10px] font-medium",
                  summary.outOfStock > 0
                    ? "text-maher-due"
                    : "text-muted-foreground"
                )}
              >
                স্টক নেই
              </dt>
              <dd
                className={cn(
                  "mt-1 text-[20px] font-bold leading-none tabular-nums",
                  summary.outOfStock > 0
                    ? "text-maher-due"
                    : "text-muted-foreground"
                )}
              >
                {toBnDigits(summary.outOfStock)}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex-1">
            {summary.totalProducts === 0 ? (
              <p className="rounded-lg border border-dashed border-maher-border bg-maher-surface/60 px-3 py-3 text-[11px] leading-snug text-muted-foreground">
                এখনো কোনো প্রোডাক্ট যোগ হয়নি।
              </p>
            ) : needsStock ? (
              <ul className="divide-y divide-maher-border">
                {lowProducts.map((product) => (
                  <li
                    key={product.id}
                    className="flex items-center justify-between gap-2 py-1.5 text-[11px]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      {product.status === "out" ? (
                        <PackageX className="h-3.5 w-3.5 shrink-0 text-maher-due" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-maher-warning" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-maher-ink">
                          {product.name}
                        </span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          সীমা {toBnDigits(product.lowStockThreshold)} পিস
                        </span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-semibold tabular-nums",
                        product.status === "out"
                          ? "text-maher-due"
                          : "text-maher-warning"
                      )}
                    >
                      {toBnDigits(product.stock)} পিস
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-700">
                <PackageCheck className="h-4 w-4 shrink-0" />
                সব প্রোডাক্টের স্টক সীমার উপরে আছে।
              </p>
            )}
          </div>

          <Link
            href={needsStock ? "/products?status=low" : "/products"}
            className="mt-3 inline-flex items-center justify-between border-t border-maher-border pt-2.5 text-[11px] font-semibold text-maher-navy transition-colors hover:text-maher-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60"
          >
            {summary.totalProducts === 0
              ? "ইনভেন্টরি খুলুন"
              : "ইনভেন্টরি দেখুন"}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
    </section>
  );
}
