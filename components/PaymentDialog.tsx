"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
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
import type {
  CustomerLedgerResponse,
  OutstandingSlipDTO,
  ServiceDTO,
} from "@/lib/types";

const METHODS: PaymentMethod[] = ["CASH", "BKASH", "OTHER"];

function allocatePreview(slips: OutstandingSlipDTO[], amount: number) {
  let remaining = amount;
  return slips.map((slip) => {
    const take = Math.max(0, Math.min(slip.due, remaining));
    remaining -= take;
    return { ...slip, take };
  });
}

/**
 * "টাকা নিন" — one customer receipt, allocated to that customer's open slips
 * oldest-first. The preview is computed here so the shopkeeper sees exactly
 * which slips the money covers before saving; the server applies the same
 * rule and refuses an overpay.
 */
export function PaymentDialog({
  service,
  onClose,
  onChanged,
}: {
  service: ServiceDTO | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [ledger, setLedger] = useState<CustomerLedgerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phone = service?.phone ?? "";
  const name = service?.customerName ?? "";

  useEffect(() => {
    if (!service) return;
    let live = true;
    setLoading(true);
    setError(null);
    setLedger(null);
    setAmount("");
    setNote("");
    setMethod("CASH");
    const params = new URLSearchParams();
    if (phone.trim()) params.set("phone", phone);
    params.set("name", name);
    fetch(`/api/payments?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "বাকি আনা যায়নি");
        if (live) setLedger(json as CustomerLedgerResponse);
      })
      .catch((err) => {
        if (live) {
          setError(err instanceof Error ? err.message : "বাকি আনা যায়নি");
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [service, phone, name]);

  const totalDue = ledger?.totalDue ?? 0;
  const parsedAmount = Math.floor(Number(amount.replace(/[^\d]/g, "")) || 0);
  const overpay = parsedAmount > totalDue;
  const invalid = parsedAmount <= 0 || overpay;
  const preview = useMemo(
    () => allocatePreview(ledger?.slips ?? [], invalid ? 0 : parsedAmount),
    [ledger?.slips, parsedAmount, invalid]
  );

  const submit = async () => {
    if (!service || saving || invalid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          customerName: name,
          amount: parsedAmount,
          method,
          note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "পেমেন্ট সেভ করা যায়নি");
        return;
      }
      toast.success(`${formatTaka(parsedAmount)} গ্রহণ করা হয়েছে`);
      onChanged();
      onClose();
    } catch {
      setError("পেমেন্ট সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!service} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="payment-dialog"
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-maher-navy" />
            টাকা নিন
          </DialogTitle>
          <DialogDescription>
            {name}
            {phone ? ` • ${phone}` : ""} — পুরোনো বাকি আগে সমন্বয় হবে।
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            বাকি হিসাব আনা হচ্ছে…
          </div>
        ) : (
          <div className="space-y-4">
            <div
              data-testid="payment-total-due"
              className="flex items-center justify-between rounded-lg border border-maher-border bg-maher-surface px-3 py-2"
            >
              <span className="text-sm font-medium text-muted-foreground">
                মোট বাকি
              </span>
              <span className="text-lg font-bold tabular-nums text-maher-due-ink">
                {formatTaka(totalDue)}
              </span>
            </div>

            {totalDue === 0 ? (
              <p className="rounded-lg border border-maher-done/30 bg-maher-done/10 px-3 py-2 text-sm text-maher-done">
                এই কাস্টমারের কোনো বাকি নেই।
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="payment-amount">টাকার পরিমাণ</Label>
                  <div className="flex gap-2">
                    <Input
                      id="payment-amount"
                      data-testid="payment-amount"
                      inputMode="numeric"
                      value={amount}
                      onChange={(event) =>
                        setAmount(event.target.value.replace(/[^\d০-৯]/g, ""))
                      }
                      placeholder="০"
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setAmount(String(totalDue))}
                      className="shrink-0 bg-white"
                    >
                      সব বাকি
                    </Button>
                  </div>
                  {overpay ? (
                    <p
                      data-testid="payment-overpay"
                      className="text-xs font-medium text-maher-due"
                    >
                      বাকির চেয়ে বেশি টাকা নেওয়া যাবে না।
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="payment-method">মাধ্যম</Label>
                  <Select
                    value={method}
                    onValueChange={(value) => setMethod(value as PaymentMethod)}
                  >
                    <SelectTrigger id="payment-method" data-testid="payment-method">
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

                <div className="space-y-1.5">
                  <Label htmlFor="payment-note">নোট (ঐচ্ছিক)</Label>
                  <Textarea
                    id="payment-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    placeholder="যেমন: বিকাশে পাঠিয়েছেন"
                  />
                </div>

                <div className="rounded-lg border border-maher-border">
                  <div className="border-b border-maher-border bg-maher-surface/60 px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    কোন স্লিপে কত যাবে
                  </div>
                  <ul
                    data-testid="payment-preview"
                    className="divide-y divide-maher-border/70"
                  >
                    {preview.map((slip) => (
                      <li
                        key={slip.id}
                        data-testid={`payment-preview-${slip.id}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono font-semibold">#{slip.id}</span>{" "}
                          {slip.model} • {dhakaDateKey(slip.serviceDate)}
                          <span className="ml-1 text-muted-foreground">
                            (বাকি {formatTaka(slip.due)})
                          </span>
                        </span>
                        <span
                          className={`shrink-0 font-semibold tabular-nums ${
                            slip.take > 0 ? "text-maher-done" : "text-muted-foreground"
                          }`}
                        >
                          {formatTaka(slip.take)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {error ? (
              <p className="rounded border border-maher-due/30 bg-maher-due/10 px-2 py-1.5 text-xs font-medium text-maher-due">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} className="bg-white">
                বাতিল
              </Button>
              <Button
                type="button"
                data-testid="payment-submit"
                disabled={totalDue === 0 || invalid || saving}
                onClick={() => void submit()}
              >
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                জমা দিন
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
