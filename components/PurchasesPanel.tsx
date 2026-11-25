"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, PackagePlus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { PurchaseDialog } from "@/components/PurchaseDialog";
import { ServicePartsLedger } from "@/components/ServicePartsLedger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dhakaDateKey } from "@/lib/dhaka";
import { formatNum, formatTaka } from "@/lib/utils";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/payment-methods";
import type {
  ProductDTO,
  PurchaseDTO,
  PurchaseListResponse,
} from "@/lib/types";

const METHODS: PaymentMethod[] = ["CASH", "BKASH", "OTHER"];

/** "দোকান ও ক্রয়" tab: supplier bills and money out. */
export function PurchasesPanel({ products }: { products: ProductDTO[] }) {
  const [data, setData] = useState<PurchaseListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PurchaseDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/purchases");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "ক্রয় তালিকা আনা যায়নি");
      setData(json as PurchaseListResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ক্রয় তালিকা আনা যায়নি");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = data?.summary;
  const purchases = data?.purchases ?? [];

  return (
    <section aria-label="দোকান ও ক্রয়" data-testid="purchases-panel">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-maher-navy">ক্রয়ের তালিকা</h2>
        <p className="text-xs text-muted-foreground">
          {loading ? "…" : `${formatNum(purchases.length)}টি বিল`}
        </p>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          onClick={() => setDialogOpen(true)}
        >
          <PackagePlus className="mr-1 h-4 w-4" />
          নতুন ক্রয়
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "মোট ক্রয়", value: summary ? formatTaka(summary.total) : "—" },
          { label: "পরিশোধিত", value: summary ? formatTaka(summary.paid) : "—" },
          { label: "বাকি", value: summary ? formatTaka(summary.due) : "—" },
          { label: "বিল সংখ্যা", value: summary ? formatNum(summary.count) : "—" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-maher-border bg-white p-2.5 shadow-rail"
          >
            <p className="text-[11px] font-medium text-muted-foreground">
              {card.label}
            </p>
            <p className="mt-0.5 truncate text-base font-bold tabular-nums">
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {error ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-maher-due/30 bg-maher-due/10 px-3 py-2 text-sm text-maher-due">
          <span>{error}</span>
          <Button size="sm" variant="outline" className="bg-white" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="rounded-xl border border-maher-border bg-white px-4 py-10 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          ক্রয় তালিকা আনা হচ্ছে…
        </div>
      ) : purchases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-maher-border bg-white px-4 py-10 text-center">
          <p className="text-sm font-semibold">এখনো কোনো ক্রয় নেই</p>
          <p className="mt-1 text-xs text-muted-foreground">
            সাপ্লায়ারের বিল যোগ করলে স্টক বাড়বে।
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-maher-border bg-white shadow-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-maher-surface/60">
                  <TableHead>তারিখ</TableHead>
                  <TableHead>সাপ্লায়ার</TableHead>
                  <TableHead>আইটেম</TableHead>
                  <TableHead className="text-right">মোট</TableHead>
                  <TableHead className="text-right">পরিশোধিত</TableHead>
                  <TableHead className="text-right">বাকি</TableHead>
                  <TableHead className="w-[80px] text-right">অ্যাকশন</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchases.map((purchase) => (
                  <TableRow key={purchase.id} data-testid={`purchase-row-${purchase.id}`}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {dhakaDateKey(purchase.purchaseDate)}
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{purchase.supplier}</p>
                      <p className="text-[11px] font-medium text-maher-navy">
                        {purchase.purchaseType === "SERVICE_PART"
                          ? `সার্ভিস পার্টস${purchase.serviceId ? ` · #${purchase.serviceId}` : ""}`
                          : "স্টক ক্রয়"}
                      </p>
                      {purchase.invoiceNo ? (
                        <p className="text-xs text-muted-foreground">
                          {purchase.invoiceNo}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                      {purchase.items
                        .map((item) => `${item.nameSnapshot} ×${item.quantity}`)
                        .join(", ")}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatTaka(purchase.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-maher-done">
                      {formatTaka(purchase.paid)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-maher-due-ink">
                      {formatTaka(purchase.due)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-maher-navy"
                          aria-label="সাপ্লায়ারকে টাকা দিন"
                          data-testid={`purchase-pay-${purchase.id}`}
                          disabled={purchase.due <= 0}
                          onClick={() => setPayTarget(purchase)}
                        >
                          <Wallet className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <ServicePartsLedger />

      <PurchaseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        products={products}
        onSaved={() => void load()}
      />

      <SupplierPaymentDialog
        target={payTarget}
        purchases={purchases}
        onClose={() => setPayTarget(null)}
        onPaid={() => {
          setPayTarget(null);
          void load();
        }}
      />
    </section>
  );
}

function SupplierPaymentDialog({
  target,
  purchases,
  onClose,
  onPaid,
}: {
  target: PurchaseDTO | null;
  purchases: PurchaseDTO[];
  onClose: () => void;
  onPaid: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setAmount("");
    setMethod("CASH");
    setNote("");
    setError(null);
  }, [target]);

  const open = purchases
    .filter(
      (purchase) =>
        target && purchase.supplier === target.supplier && purchase.due > 0
    )
    .sort(
      (a, b) =>
        new Date(a.purchaseDate).getTime() -
          new Date(b.purchaseDate).getTime() || a.id - b.id
    );
  const totalDue = open.reduce((sum, purchase) => sum + purchase.due, 0);
  const amountNum = Math.max(0, Math.floor(Number(amount) || 0));
  const overpay = amountNum > totalDue;

  const submit = async () => {
    if (!target || saving) return;
    if (amountNum <= 0 || overpay) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/purchases/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier: target.supplier,
          amount: amountNum,
          method,
          note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "পেমেন্ট সেভ করা যায়নি");
        return;
      }
      toast.success(`${formatTaka(amountNum)} সাপ্লায়ারকে দেওয়া হয়েছে`);
      onPaid();
    } catch {
      setError("পেমেন্ট সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(value) => !value && onClose()}>
      <DialogContent data-testid="supplier-payment-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>সাপ্লায়ারকে টাকা দিন</DialogTitle>
          <DialogDescription>
            {target?.supplier} — পুরোনো বিল আগে পরিশোধ হবে।
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-maher-border bg-maher-surface px-3 py-2">
            <span className="text-sm text-muted-foreground">মোট বাকি</span>
            <span className="text-lg font-bold tabular-nums text-maher-due-ink">
              {formatTaka(totalDue)}
            </span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-amount">টাকার পরিমাণ</Label>
            <Input
              id="supplier-amount"
              data-testid="supplier-amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            {overpay ? (
              <p className="text-xs font-medium text-maher-due">
                বাকির চেয়ে বেশি টাকা দেওয়া যাবে না।
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-method">মাধ্যম</Label>
            <Select
              value={method}
              onValueChange={(value) => setMethod(value as PaymentMethod)}
            >
              <SelectTrigger id="supplier-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {PAYMENT_METHOD_LABEL[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="supplier-note">নোট (ঐচ্ছিক)</Label>
            <Input
              id="supplier-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          {error ? (
            <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-xs font-medium text-maher-due">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="bg-white" onClick={onClose}>
              বাতিল
            </Button>
            <Button
              type="button"
              data-testid="supplier-payment-submit"
              disabled={saving || amountNum <= 0 || overpay}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              দিন
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
