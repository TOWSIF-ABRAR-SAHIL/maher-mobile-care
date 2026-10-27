"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { dhakaDateKey } from "@/lib/dhaka";
import { formatTaka, STATUS_BN } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

/**
 * One internal ledger dialog for the two new adjustments:
 *  - return an unfinished job and refund the full advance
 *  - record a technician-damage loss (never shown on a customer receipt)
 */
export function ServiceAdjustDialog({
  service,
  onClose,
  onChanged,
}: {
  service: ServiceDTO;
  onClose: () => void;
  onChanged: () => void;
}) {
  const returned = service.status === "Returned";
  const [refundNote, setRefundNote] = useState("");
  const [refunding, setRefunding] = useState(false);
  // A returned job with a parts cost must say what happened to that cost:
  // unused/returned parts are written off, used/broken parts stay a loss.
  const [expenseChoice, setExpenseChoice] = useState<"writeoff" | "keep" | "">(
    ""
  );
  const hasExpense = service.expenseAmount > 0;
  const needsExpenseChoice = hasExpense && !returned;
  const [loss, setLoss] = useState(
    service.damageLoss > 0 ? String(service.damageLoss) : ""
  );
  const [lossNote, setLossNote] = useState(service.damageNote ?? "");
  const [savingLoss, setSavingLoss] = useState(false);

  const refund = async () => {
    if (refunding) return;
    if (needsExpenseChoice && !expenseChoice) {
      toast.error("দোকান খরচের সিদ্ধান্ত বেছে নিন");
      return;
    }
    setRefunding(true);
    try {
      const res = await fetch(`/api/services/${service.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: refundNote,
          ...(needsExpenseChoice ? { expenseAction: expenseChoice } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ফেরত দেওয়া যায়নি");
      toast.success(
        service.advance > 0
          ? `${formatTaka(service.advance)} ফেরত দেওয়া হয়েছে`
          : "কাজ ফেরত হিসাবে বন্ধ হয়েছে"
      );
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ফেরত দেওয়া যায়নি");
    } finally {
      setRefunding(false);
    }
  };

  const saveLoss = async () => {
    if (savingLoss) return;
    setSavingLoss(true);
    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          damageLoss: loss.trim() === "" ? 0 : loss,
          damageNote: lossNote,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ক্ষতি সেভ করা যায়নি");
      toast.success("ড্যামেজ ক্ষতি সেভ হয়েছে");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "ক্ষতি সেভ করা যায়নি"
      );
    } finally {
      setSavingLoss(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="service-adjust-dialog"
        className="max-h-[92dvh] sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>⚖️ ফেরত ও ড্যামেজ হিসাব</DialogTitle>
          <DialogDescription>
            ID #{service.id} — {service.customerName} ({service.model})
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-maher-border bg-maher-surface px-3 py-2 text-sm">
          <span>
            বিল: <strong>{formatTaka(service.totalBill)}</strong>
          </span>
          <span className="text-maher-done">
            জমা: <strong>{formatTaka(service.advance)}</strong>
          </span>
          <span className="text-muted-foreground">
            অবস্থা:{" "}
            <strong>
              {(STATUS_BN as Record<string, string>)[service.status] ??
                service.status}
            </strong>
          </span>
        </div>

        <Tabs defaultValue="refund" data-testid="adjust-tabs">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="refund" data-testid="adjust-refund-tab">
              ↩️ ফেরত / রিফান্ড
            </TabsTrigger>
            <TabsTrigger value="damage" data-testid="adjust-damage-tab">
              ⚠️ ড্যামেজ ক্ষতি
            </TabsTrigger>
          </TabsList>

          <TabsContent value="refund" className="space-y-3">
            {returned ? (
              <div className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-sm text-maher-ink">
                <p className="font-semibold">এই কাজটি ফেরত দেওয়া হয়েছে।</p>
                <p className="mt-1">
                  ফেরত দেওয়া হয়েছে:{" "}
                  <strong>{formatTaka(service.refundAmount)}</strong>
                </p>
                {service.returnedAt ? (
                  <p className="mt-1 text-xs text-maher-money">
                    তারিখ: {dhakaDateKey(service.returnedAt)}
                  </p>
                ) : null}
                {service.refundNote ? (
                  <p className="mt-1 text-xs text-maher-money">
                    নোট: {service.refundNote}
                  </p>
                ) : null}
                {hasExpense ? (
                  <p
                    data-testid="adjust-expense-written-off"
                    className="mt-1 text-xs text-maher-money"
                  >
                    দোকান খরচ:{" "}
                    <strong>{formatTaka(service.expenseAmount)}</strong> —{" "}
                    {service.expenseWrittenOff
                      ? "বাদ দেওয়া হয়েছে (রিপোর্টে যোগ হবে না)"
                      : "ক্ষতি হিসেবে রাখা হয়েছে"}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-maher-due/30 bg-maher-due/10 p-3 text-sm text-maher-ink">
                  <p className="font-semibold">
                    কাজ সম্পন্ন না হলে এই কাজটি ফেরত হিসাবে বন্ধ হবে।
                  </p>
                  <p className="mt-1">
                    পুরো জমা{" "}
                    <strong>{formatTaka(service.advance)}</strong> কাস্টমারকে
                    ফেরত দেওয়া হবে। বিল ও বাকি হিসাব থেকে বাদ যাবে।
                  </p>
                </div>

                {hasExpense ? (
                  <div
                    data-testid="adjust-expense-choice"
                    className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-sm text-maher-ink"
                  >
                    <p className="font-semibold">
                      দোকান খরচ: {formatTaka(service.expenseAmount)}{" "}
                      <span className="font-mono text-xs">
                        ({service.shopExpense})
                      </span>
                    </p>
                    <p className="mt-1 text-xs leading-snug">
                      পার্টস ব্যবহার হয়েছে বা নষ্ট হয়েছে? একটি বেছে নিন —
                      এটা ছাড়া ফেরত সম্পন্ন হবে না।
                    </p>
                    <div
                      role="radiogroup"
                      aria-label="দোকান খরচের সিদ্ধান্ত"
                      className="mt-2 grid gap-2"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={expenseChoice === "writeoff"}
                        data-testid="adjust-expense-writeoff"
                        onClick={() => setExpenseChoice("writeoff")}
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          expenseChoice === "writeoff"
                            ? "border-maher-done bg-maher-done/15 ring-1 ring-maher-done"
                            : "border-maher-border bg-white hover:bg-maher-warning/10"
                        }`}
                      >
                        <span className="block font-semibold">
                          খরচ হয়নি — বাদ দিন
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          পার্টস ফেরত পাওয়া গেছে / ব্যবহার হয়নি। রিপোর্টে কোনো
                          খরচ বা ক্ষতি থাকবে না।
                        </span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={expenseChoice === "keep"}
                        data-testid="adjust-expense-keep"
                        onClick={() => setExpenseChoice("keep")}
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          expenseChoice === "keep"
                            ? "border-maher-due bg-maher-due/15 ring-1 ring-maher-due"
                            : "border-maher-border bg-white hover:bg-maher-warning/10"
                        }`}
                      >
                        <span className="block font-semibold">
                          খরচ হয়েছে — ক্ষতি হিসেবে রাখুন
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          পার্টস ব্যবহার/নষ্ট হয়েছে। {formatTaka(service.expenseAmount)}{" "}
                          দোকানের ক্ষতি হিসাবে রিপোর্টে থাকবে।
                        </span>
                      </button>
                    </div>
                  </div>
                ) : null}

                <div>
                  <Label htmlFor="adjust-refund-note">
                    ফেরতের নোট (ঐচ্ছিক)
                  </Label>
                  <Textarea
                    id="adjust-refund-note"
                    data-testid="adjust-refund-note"
                    value={refundNote}
                    onChange={(e) => setRefundNote(e.target.value)}
                    maxLength={300}
                    placeholder="যেমন: সমস্যা সমাধান হয়নি, মোবাইল অক্ষত অবস্থায় ফেরত"
                    className="mt-1"
                  />
                </div>
                <Button
                  type="button"
                  data-testid="adjust-refund-confirm"
                  disabled={refunding || (needsExpenseChoice && !expenseChoice)}
                  onClick={() => void refund()}
                  className="w-full bg-maher-warning text-white hover:bg-maher-money disabled:opacity-50"
                >
                  {refunding ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  {service.advance > 0
                    ? `ফেরত দিন (${formatTaka(service.advance)})`
                    : "ফেরত হিসাবে বন্ধ করুন"}
                </Button>
                {needsExpenseChoice && !expenseChoice ? (
                  <p className="text-center text-xs text-maher-money">
                    আগে দোকান খরচের সিদ্ধান্ত বেছে নিন।
                  </p>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="damage" className="space-y-3">
            <div className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-xs leading-snug text-maher-ink">
              এই খরচ শুধু দোকানের হিসাবের জন্য। কাস্টমার রিসিট/PDF-এ কখনো
              যাবে না। বিল আলাদা থাকবে; profit থেকে এই ক্ষতি বাদ যাবে।
            </div>
            <div>
              <Label htmlFor="adjust-damage-loss">ড্যামেজ ক্ষতি (৳)</Label>
              <Input
                id="adjust-damage-loss"
                data-testid="adjust-damage-loss"
                value={loss}
                onChange={(e) => setLoss(e.target.value)}
                inputMode="numeric"
                placeholder="যেমন: 500"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="adjust-damage-note">
                কী হয়েছে / নোট (ঐচ্ছিক)
              </Label>
              <Textarea
                id="adjust-damage-note"
                data-testid="adjust-damage-note"
                value={lossNote}
                onChange={(e) => setLossNote(e.target.value)}
                maxLength={300}
                placeholder="যেমন: ডিসপ্লে ফ্লেক্স ভেঙে গেছে"
                className="mt-1"
              />
            </div>
            <Button
              type="button"
              data-testid="adjust-damage-save"
              disabled={savingLoss}
              onClick={() => void saveLoss()}
              className="w-full bg-maher-warning text-white hover:bg-maher-money"
            >
              {savingLoss ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : null}
              ক্ষতি সেভ করুন
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
