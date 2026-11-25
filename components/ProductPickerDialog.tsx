"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PackageSearch, ScanLine, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProductCategoryDTO, ProductDTO } from "@/lib/types";

const stockTone = (p: ProductDTO) =>
  p.stock <= 0
    ? "border-maher-due/30 bg-maher-due/10 text-maher-due"
    : p.stock <= p.lowStockThreshold
      ? "border-maher-warning/40 bg-maher-warning/10 text-maher-money"
      : "border-maher-done/30 bg-maher-done/10 text-maher-done";

const stockLabel = (p: ProductDTO) =>
  p.stock <= 0
    ? "স্টক নেই"
    : p.stock <= p.lowStockThreshold
      ? `কম স্টক · ${p.stock}`
      : `স্টক ${p.stock}`;

/**
 * Search-and-pick dialog for a visit's product lines. Everything is local
 * (the caller already fetched `/api/products`), so it works offline and never
 * waits on the network while the shopkeeper is at the counter.
 */
export function ProductPickerDialog({
  open,
  products,
  categories,
  onClose,
  onPick,
}: {
  open: boolean;
  products: ProductDTO[];
  categories: ProductCategoryDTO[];
  onClose: () => void;
  onPick: (product: ProductDTO) => void;
}) {
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setCategoryId("all");
    // Radix mounts the content a tick later; focus the scan field so a USB
    // barcode scanner types straight into it.
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products
      .filter((p) => !p.archived)
      .filter((p) => categoryId === "all" || p.categoryId === categoryId)
      .filter((p) => {
        if (!needle) return true;
        return [
          p.name,
          p.sku ?? "",
          p.barcode ?? "",
          p.brand ?? "",
          p.categoryName,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      });
  }, [products, q, categoryId]);

  const pick = (product: ProductDTO) => {
    if (product.stock <= 0) return;
    onPick(product);
    onClose();
  };

  /** Barcode scanners press Enter: an exact barcode/SKU picks the row. */
  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const needle = q.trim().toLowerCase();
    if (!needle) return;
    const exact = filtered.find(
      (p) =>
        (p.barcode ?? "").toLowerCase() === needle ||
        (p.sku ?? "").toLowerCase() === needle
    );
    if (exact) {
      event.preventDefault();
      pick(exact);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DialogContent
        data-testid="product-picker"
        className="max-h-[92dvh] sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageSearch className="h-5 w-5 text-maher-navy" />
            প্রোডাক্ট যোগ করুন
          </DialogTitle>
          <DialogDescription>
            বারকোড স্ক্যান করে Enter চাপলেই যোগ হবে।
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            data-testid="product-picker-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="নাম / SKU / বারকোড / ক্যাটাগরি…"
            aria-label="প্রোডাক্ট খুঁজুন"
            className="h-10 pl-9 pr-9"
            autoComplete="off"
            spellCheck={false}
          />
          {q ? (
            <button
              type="button"
              aria-label="খোঁজা মুছুন"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:bg-maher-surface hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <ScanLine
              aria-hidden
              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60"
            />
          )}
        </div>

        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={categoryId === "all"}
              onClick={() => setCategoryId("all")}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                categoryId === "all"
                  ? "border-maher-navy bg-maher-navy text-white"
                  : "border-maher-border bg-white text-muted-foreground hover:border-maher-navy/40 hover:text-maher-navy"
              }`}
            >
              সব
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                data-testid={`product-picker-category-${c.id}`}
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(c.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${
                  categoryId === c.id
                    ? "border-maher-navy bg-maher-navy text-white"
                    : "border-maher-border bg-white text-muted-foreground hover:border-maher-navy/40 hover:text-maher-navy"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="max-h-[52dvh] overflow-y-auto rounded-lg border border-maher-border">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              কোনো প্রোডাক্ট মেলেনি
            </p>
          ) : (
            <ul className="divide-y divide-maher-border">
              {filtered.map((p) => {
                const disabled = p.stock <= 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      data-testid={`product-picker-item-${p.id}`}
                      disabled={disabled}
                      onClick={() => pick(p)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition hover:bg-maher-surface disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {p.name}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>{p.categoryName}</span>
                          {p.sku ? (
                            <span className="font-mono">SKU {p.sku}</span>
                          ) : null}
                          {p.barcode ? (
                            <span className="font-mono">{p.barcode}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          ৳{p.sellingPrice}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stockTone(p)}`}
                        >
                          {stockLabel(p)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
