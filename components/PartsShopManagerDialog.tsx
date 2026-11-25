"use client";

import { useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
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
import { partSupplierKey } from "@/lib/parts";
import {
  removePartShopName,
  savePartShopName,
  summarizePartShopBills,
} from "@/lib/part-shops";
import { formatTaka } from "@/lib/utils";
import type { ServicePartLedgerResponse } from "@/lib/types";

/**
 * Counter-ready shop picker. Storage stays in lib/part-shops and every figure
 * comes from the all-time rows the page already loaded, so opening the dialog
 * issues no new query and never changes the ledger's own filters.
 */
export function PartsShopManagerDialog({
  open,
  onClose,
  onSelectShop,
  shopNames,
  ledgerRows,
  onNamesChange,
}: {
  open: boolean;
  onClose: () => void;
  /** Jump straight to this shop's ledger rows and dismiss the dialog. */
  onSelectShop: (shopName: string) => void;
  shopNames: string[];
  ledgerRows: ServicePartLedgerResponse["rows"];
  onNamesChange: (names: string[]) => void;
}) {
  const [newShopName, setNewShopName] = useState("");
  const [shopToDelete, setShopToDelete] = useState<string | null>(null);

  const bills = summarizePartShopBills(shopNames, ledgerRows);

  // Paid is a whole-line marker, not a payment record: the two figures below
  // are the marked and unmarked shares of the same all-time line total.
  const moneyByShop = new Map<string, { total: number; paid: number }>();
  const shopsWithRows = new Set<string>();
  for (const row of ledgerRows) {
    const key = partSupplierKey(row.supplier);
    if (!key) continue;
    shopsWithRows.add(key);
    if (row.partStatus === "RETURNED") continue;
    const amount = Math.max(0, Math.round(Number(row.lineCost) || 0));
    if (!amount) continue;
    const entry = moneyByShop.get(key) ?? { total: 0, paid: 0 };
    entry.total += amount;
    if (row.paidAt) entry.paid += amount;
    moneyByShop.set(key, entry);
  }

  // The footer mirrors the row tags: the same line costs, split into marked
  // and still-owing shares. `bills.total` keeps its historic testid meaning.
  let grandPaid = 0;
  let grandDue = 0;
  for (const entry of moneyByShop.values()) {
    grandPaid += entry.paid;
    grandDue += Math.max(0, entry.total - entry.paid);
  }

  const addShop = () => {
    if (!newShopName.trim()) return;
    onNamesChange(savePartShopName(newShopName));
    setNewShopName("");
  };

  const confirmDelete = () => {
    if (!shopToDelete) return;
    const key = partSupplierKey(shopToDelete);
    if (key && shopsWithRows.has(key)) return;
    onNamesChange(removePartShopName(shopToDelete));
    setShopToDelete(null);
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) {
            setShopToDelete(null);
            onClose();
          }
        }}
      >
        <DialogContent
          data-testid="parts-shop-manager-dialog"
          className="max-h-[85vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>পার্টসের দোকান ব্যবস্থাপনা</DialogTitle>
            <DialogDescription>
              পার্টস কেনার দোকানসমূহ এবং তাদের আর্থিক হিসাব
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              addShop();
            }}
            className="flex flex-col gap-2 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <Label
                htmlFor="new-part-shop-name"
                className="text-[11px] font-semibold text-maher-navy"
              >
                দোকানের নাম
              </Label>
              <Input
                id="new-part-shop-name"
                value={newShopName}
                onChange={(event) => setNewShopName(event.target.value)}
                placeholder="যেমন: রহিম মোবাইল হাউজ"
                className="mt-1"
                maxLength={100}
                autoComplete="off"
              />
            </div>
            <Button
              type="submit"
              disabled={!newShopName.trim()}
              className="sm:shrink-0"
            >
              <Plus className="mr-1 h-4 w-4" />
              যোগ করুন
            </Button>
          </form>

          <div data-testid="part-shops-manager" className="min-h-0">
            {bills.shops.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-maher-border">
                <ul>
                  {bills.shops.map((shop) => {
                    const key = partSupplierKey(shop.name) ?? "";
                    const money = moneyByShop.get(key) ?? { total: 0, paid: 0 };
                    const unpaid = Math.max(0, money.total - money.paid);
                    const protectedShop = shopsWithRows.has(key);
                    return (
                      <li
                        key={shop.name.toLocaleLowerCase()}
                        data-testid="part-shop-row"
                        className="flex items-start gap-2 border-b border-maher-border px-3 py-2 last:border-b-0 hover:bg-maher-surface/40"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-maher-navy">
                            {shop.name}
                          </span>
                          {!shop.stored ? (
                            <span className="mt-0.5 inline-block rounded bg-maher-surface px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              খাতা থেকে
                            </span>
                          ) : null}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] tabular-nums">
                            <span
                              data-testid="part-shop-bill"
                              className="font-medium text-slate-600"
                            >
                              মোট: {formatTaka(money.total)}
                            </span>
                            <span
                              data-testid="part-shop-paid"
                              className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"
                            >
                              পরিশোধ: {formatTaka(money.paid)}
                            </span>
                            {unpaid > 0 ? (
                              <span
                                data-testid="part-shop-unpaid"
                                className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700"
                              >
                                ⚠️ বাকি: {formatTaka(unpaid)}
                              </span>
                            ) : (
                              <span
                                data-testid="part-shop-unpaid"
                                className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700"
                              >
                                ✅ পরিশোধিত
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          data-testid="part-shop-view-ledger"
                          title="এই দোকানের খাতা দেখুন"
                          aria-label={`${shop.name} দোকানের খাতা দেখুন`}
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-maher-surface hover:text-maher-navy"
                          onClick={() => onSelectShop(shop.name)}
                        >
                          <Search className="h-3.5 w-3.5" />
                        </Button>
                        {shop.stored ? (
                          <span
                            title={
                              protectedShop
                                ? "লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না"
                                : undefined
                            }
                          >
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              data-testid="part-shop-delete"
                              aria-label={
                                protectedShop
                                  ? `${shop.name} — লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না`
                                  : `${shop.name} দোকান মুছুন`
                              }
                              title={
                                protectedShop
                                  ? "লেনদেন থাকায় দোকানটি ডিলিট করা যাবে না"
                                  : "দোকানের নাম মুছুন"
                              }
                              disabled={protectedShop}
                              className="h-7 w-7 shrink-0 text-maher-due hover:bg-maher-due/10 hover:text-maher-due disabled:cursor-not-allowed disabled:opacity-40"
                              onClick={() => setShopToDelete(shop.name)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        ) : (
                          <span className="w-7 shrink-0" aria-hidden="true" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-maher-border px-3 py-6 text-center">
                <p className="text-xs font-medium text-maher-navy">
                  এখনো কোনো দোকান যোগ করা হয়নি
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  উপরের ঘরে নাম লিখে দোকান যোগ করুন।
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <div
              className="grid w-full grid-cols-1 gap-1.5 rounded-lg border border-maher-border bg-maher-surface/60 px-3 py-2 sm:grid-cols-3"
              title="Paid চিহ্ন হলো লাইনের মার্কার, আসল পেমেন্ট রেকর্ড নয়"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  মোট বিল:
                </span>
                <span
                  data-testid="part-shops-total"
                  className="text-xs font-semibold tabular-nums text-slate-600"
                >
                  {formatTaka(bills.total)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  পরিশোধিত:
                </span>
                <span
                  data-testid="part-shops-paid-total"
                  className="text-xs font-semibold tabular-nums text-emerald-700"
                >
                  {formatTaka(grandPaid)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  মোট বাকি দেনা:
                </span>
                <span
                  data-testid="part-shops-due-total"
                  className="text-sm font-bold tabular-nums text-rose-700"
                >
                  {formatTaka(grandDue)}
                </span>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!shopToDelete}
        onOpenChange={(next) => {
          if (!next) setShopToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>দোকানের নাম মুছবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              “{shopToDelete}” শুধু বাছাই তালিকা থেকে যাবে। আগের পার্টস লাইন ও
              বিলের হিসাব ঠিক থাকবে; খাতা থেকে নামটি আবার দেখা যেতে পারে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>বাতিল</AlertDialogCancel>
            <AlertDialogAction
              className="bg-maher-due hover:bg-maher-due/90"
              onClick={confirmDelete}
            >
              মুছুন
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
