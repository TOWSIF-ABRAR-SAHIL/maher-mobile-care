"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { dhakaDateKey } from "@/lib/dhaka";
import { formatTaka } from "@/lib/utils";
import {
  PAYMENT_METHOD_LABEL,
  type PaymentMethod,
} from "@/lib/payment-methods";
import type { ProductDTO } from "@/lib/types";

const METHODS: PaymentMethod[] = ["CASH", "BKASH", "OTHER"];

interface Line {
  key: string;
  productId: string;
  name: string;
  quantity: string;
  unitCost: string;
}

const emptyLine = (): Line => ({
  key: `${Date.now()}-${Math.random()}`,
  productId: "",
  name: "",
  quantity: "1",
  unitCost: "",
});

/** New supplier bill: stock-in every tracked line and record the money. */
export function PurchaseDialog({
  open,
  onOpenChange,
  products,
  onSaved,
  purchaseType = "STOCK",
  serviceId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products?: ProductDTO[];
  onSaved: () => void;
  purchaseType?: "STOCK" | "SERVICE_PART";
  serviceId?: number;
}) {
  const servicePart = purchaseType === "SERVICE_PART";
  const availableProducts = products ?? [];
  const [supplier, setSupplier] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [date, setDate] = useState(dhakaDateKey(new Date()));
  const [note, setNote] = useState("");
  const [paid, setPaid] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSupplier("");
    setInvoiceNo("");
    setDate(dhakaDateKey(new Date()));
    setNote("");
    setPaid("");
    setMethod("CASH");
    setLines([emptyLine()]);
    setError(null);
  }, [open]);

  const total = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
        const cost = Math.max(0, Math.floor(Number(line.unitCost) || 0));
        return sum + qty * cost;
      }, 0),
    [lines]
  );
  const paidNum = Math.max(0, Math.floor(Number(paid) || 0));

  const updateLine = (key: string, patch: Partial<Line>) => {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  const pickProduct = (key: string, productId: string) => {
    const product = availableProducts.find((p) => String(p.id) === productId);
    updateLine(key, {
      productId,
      unitCost:
        product && (!lines.find((l) => l.key === key)?.unitCost.trim())
          ? String(product.purchasePrice)
          : lines.find((l) => l.key === key)?.unitCost ?? "",
    });
  };

  const submit = async () => {
    if (saving) return;
    const items = lines
      .filter((line) => line.productId || line.name.trim())
      .map((line) => ({
        productId: line.productId ? Number(line.productId) : null,
        name: line.productId ? null : line.name.trim(),
        quantity: line.quantity,
        unitCost: line.unitCost || "0",
      }));
    if (!supplier.trim()) {
      setError("সাপ্লায়ারের নাম দিন");
      return;
    }
    if (items.length === 0) {
      setError("অন্তত একটি ক্রয় আইটেম দিন");
      return;
    }
    if (paidNum > total) {
      setError("পরিশোধিত টাকা মোট বিলের বেশি হতে পারে না");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purchaseType,
          ...(servicePart && serviceId ? { serviceId } : {}),
          supplier,
          invoiceNo,
          purchaseDate: date,
          note,
          paid: paidNum,
          method,
          items,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "ক্রয় সেভ করা যায়নি");
        return;
      }
      toast.success("ক্রয় সেভ হয়েছে");
      onSaved();
      onOpenChange(false);
    } catch {
      setError("ক্রয় সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="purchase-dialog"
        className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>{servicePart ? "পার্টস কেনার বিল" : "নতুন ক্রয়"}</DialogTitle>
          <DialogDescription>
            {servicePart
              ? "ডিভাইসের পার্টস — স্টকে যোগ হবে না; সার্ভিসের অভ্যন্তরীণ খরচে ধরা হবে।"
              : "সাপ্লায়ারের বিল — ট্র্যাক করা আইটেম স্টকে যোগ হবে; সার্ভিস খরচ/লাভে যোগ হবে না।"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-supplier">সাপ্লায়ার</Label>
              <Input
                id="purchase-supplier"
                data-testid="purchase-supplier"
                value={supplier}
                onChange={(event) => setSupplier(event.target.value)}
                placeholder="সাপ্লায়ারের নাম"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-invoice">ইনভয়েস (ঐচ্ছিক)</Label>
              <Input
                id="purchase-invoice"
                value={invoiceNo}
                onChange={(event) => setInvoiceNo(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-date">তারিখ</Label>
              <Input
                id="purchase-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>আইটেম</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 bg-white"
                onClick={() => setLines((prev) => [...prev, emptyLine()])}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                লাইন
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => (
                <div
                  key={line.key}
                  className="grid grid-cols-2 gap-2 rounded-lg border border-maher-border p-2 sm:grid-cols-[minmax(0,2fr)_5.5rem_6rem_2rem]"
                >
                  <div className="col-span-2 space-y-1 sm:col-span-1">
                    <Label className="text-[11px]">প্রোডাক্ট</Label>
                    {servicePart ? null : (
                      <select
                        value={line.productId}
                        onChange={(event) =>
                          pickProduct(line.key, event.target.value)
                        }
                        aria-label={`লাইন ${index + 1} প্রোডাক্ট`}
                        className="h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                      >
                        <option value="">— নতুন/আনট্র্যাকড আইটেম —</option>
                        {availableProducts.map((product) => (
                          <option key={product.id} value={String(product.id)}>
                            {product.name}
                            {product.sku ? ` (${product.sku})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    {servicePart || !line.productId ? (
                      <Input
                        value={line.name}
                        onChange={(event) =>
                          updateLine(line.key, { name: event.target.value })
                        }
                        placeholder="আইটেমের নাম"
                        className="h-8"
                      />
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">পরিমাণ</Label>
                    <Input
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.key, { quantity: event.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">ক্রয় মূল্য</Label>
                    <Input
                      inputMode="numeric"
                      value={line.unitCost}
                      onChange={(event) =>
                        updateLine(line.key, { unitCost: event.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                  <div className="col-span-2 flex items-end justify-end sm:col-span-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label="লাইন মুছুন"
                      className="h-8 w-8 p-0 text-maher-due"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((prev) =>
                          prev.filter((item) => item.key !== line.key)
                        )
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-paid">এখনই পরিশোধ (ঐচ্ছিক)</Label>
              <Input
                id="purchase-paid"
                data-testid="purchase-paid"
                inputMode="numeric"
                value={paid}
                onChange={(event) => setPaid(event.target.value)}
                placeholder="০"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-method">মাধ্যম</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as PaymentMethod)}
              >
                <SelectTrigger id="purchase-method">
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
              <Label htmlFor="purchase-note">নোট (ঐচ্ছিক)</Label>
              <Input
                id="purchase-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-maher-border bg-maher-surface px-3 py-2 text-sm">
            <span className="font-medium text-muted-foreground">মোট</span>
            <span className="text-lg font-bold tabular-nums">
              {formatTaka(total)}
            </span>
          </div>

          {error ? (
            <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-xs font-medium text-maher-due">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="bg-white"
              onClick={() => onOpenChange(false)}
            >
              বাতিল
            </Button>
            <Button
              type="button"
              data-testid="purchase-submit"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              সেভ করুন
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
