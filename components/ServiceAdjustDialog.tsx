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
import { hasRepairCost } from "@/lib/refund-cost-choice";
import { formatTaka, STATUS_BN } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

type BulkPartResolution =
  | "RETURNED"
  | "MOVED_TO_STOCK"
  | "DAMAGED"
  | "KEPT_IN_LEDGER";

/** An active device in the same visit, offered as a transfer target. */
export interface ReturnSibling {
  id: number;
  model: string;
  advance: number;
  due: number;
}

/**
 * One internal ledger dialog for the return/refund workflow and the
 * technician-damage loss (never shown on a customer receipt):
 *  - retain a diagnostic fee and refund the rest
 *  - reverse a delivered/warranty job, full or custom cash refund
 *  - move a grouped device's advance to an active sibling instead of cash
 *  - resolve every attached part to supplier / stock / damage / parts ledger
 *    in one click
 */
export function ServiceAdjustDialog({
  service,
  productLines = [],
  siblings = [],
  onClose,
  onChanged,
}: {
  service: ServiceDTO;
  productLines?: { id: number; name: string }[];
  siblings?: ReturnSibling[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const returned = service.status === "Returned";
  const [returnProducts, setReturnProducts] = useState(true);
  const [refundNote, setRefundNote] = useState(service.returnReason ?? "");
  const [refunding, setRefunding] = useState(false);

  const [inspectionFee, setInspectionFee] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [advanceAction, setAdvanceAction] = useState<"cash" | "transfer">("cash");
  const [transferTo, setTransferTo] = useState("");
  const [partResolution, setPartResolution] = useState<BulkPartResolution | "">("");

  // A returned job with any repair cost must say what happened to that cost:
  // unused/returned parts are written off, used/broken parts stay a loss.
  // Itemized ServicePart rows answer that question through their own one-click
  // resolution, so the legacy lumpsum choice is only for rows WITHOUT parts.
  const [expenseChoice, setExpenseChoice] = useState<"writeoff" | "keep" | "">(
    ""
  );
  const parts = service.parts ?? [];
  const hasParts = parts.length > 0;
  const repairCost = Math.max(service.expenseAmount, service.partsCost ?? 0);
  const needsPartChoice = hasParts && !returned;
  const needsExpenseChoice =
    hasRepairCost(service) && !returned && !hasParts && !partResolution;
  const [loss, setLoss] = useState(
    service.damageLoss > 0 ? String(service.damageLoss) : ""
  );
  const [lossNote, setLossNote] = useState(service.damageNote ?? "");
  const [savingLoss, setSavingLoss] = useState(false);

  const advance = Math.max(0, service.advance);
  const fee = Math.max(0, parseInt(inspectionFee, 10) || 0);
  const defaultRefund = Math.max(0, advance - fee);
  const typedRefund = refundAmount.trim() === "" ? null : parseInt(refundAmount, 10);
  const cashRefund =
    typedRefund !== null && Number.isFinite(typedRefund)
      ? Math.max(0, typedRefund)
      : defaultRefund;
  const isTransfer = advanceAction === "transfer" && siblings.length > 0;
  // A fee and a custom cash refund split the same advance; the API only
  // accepts the derived pair, so mirror that rule here. A transfer is a
  // book-keeping move and never pays cash out of the drawer.
  const effectiveRefund = isTransfer ? 0 : fee > 0 ? defaultRefund : cashRefund;
  const hasGroup = siblings.length > 0;
  const refundTooHigh = !isTransfer && effectiveRefund > advance;
  const feeTooHigh = !isTransfer && fee > advance;
  const splitTooHigh = !isTransfer && fee + effectiveRefund > advance;

  const refund = async () => {
    if (refunding) return;
    if (feeTooHigh) {
      toast.error("চেকিং ফি জমার চেয়ে বেশি হতে পারবে না");
      return;
    }
    if (refundTooHigh) {
      toast.error("জমার চেয়ে বেশি টাকা ফেরত দেওয়া যাবে না");
      return;
    }
    if (splitTooHigh) {
      toast.error("ফি ও ফেরতের টাকা একসাথে জমার চেয়ে বেশি");
      return;
    }
    if (isTransfer && !transferTo) {
      toast.error("গ্রুপের অন্য ডিভাইস বেছে নিন");
      return;
    }
    if (needsPartChoice && !partResolution) {
      toast.error("সংযুক্ত পার্টসের নিষ্পত্তি বেছে নিন");
      return;
    }
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
          returnReason: refundNote,
          inspectionFee: isTransfer ? 0 : fee,
          refundAmount: effectiveRefund,
          ...(hasGroup ? { advanceAction, transferToId: Number(transferTo) || null } : {}),
          ...(partResolution ? { partResolution } : {}),
          ...(needsExpenseChoice ? { expenseAction: expenseChoice } : {}),
          ...(productLines.length > 0 && !returned
            ? { returnProducts }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "ফেরত দেওয়া যায়নি");
      toast.success(
        isTransfer
          ? `জমা ডিভাইস #${transferTo}-এ স্থানান্তরিত হয়েছে`
          : effectiveRefund > 0
            ? `${formatTaka(effectiveRefund)} ফেরত দেওয়া হয়েছে`
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
        className="max-h-[92dvh] overflow-y-auto sm:max-w-lg"
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
                {service.inspectionFee > 0 ? (
                  <p className="mt-1 text-xs text-maher-done">
                    চেকিং / সার্ভিস ফি:{" "}
                    <strong>{formatTaka(service.inspectionFee)}</strong> — শ্রমের
                    আয় হিসেবে রিপোর্টে যোগ হয়েছে
                  </p>
                ) : null}
                {service.returnReason ? (
                  <p className="mt-1 text-xs text-maher-money">
                    কারণ: {service.returnReason}
                  </p>
                ) : null}
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
                {hasRepairCost(service) ? (
                  <p
                    data-testid="adjust-expense-written-off"
                    className="mt-1 text-xs text-maher-money"
                  >
                    দোকান খরচ: <strong>{formatTaka(repairCost)}</strong> —{" "}
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
                    {service.status === "Delivered"
                      ? "ওয়ারেন্টি ফেরত: ডেলিভারির পরও এই কাজটি ফেরত হিসাবে বন্ধ করা যাবে।"
                      : "কাজ সম্পন্ন না হলে এই কাজটি ফেরত হিসাবে বন্ধ হবে।"}
                  </p>
                  <p className="mt-1">
                    জমা{" "}
                    <strong>{formatTaka(defaultRefund)}</strong> কাস্টমারকে ফেরত
                    দেওয়া হবে—চেকিং ফি রাখলে তার চেয়ে কম। বিল ও বাকি হিসাব থেকে
                    বাদ যাবে।
                  </p>
                </div>

                {productLines.length > 0 && !returned ? (
                  <div
                    data-testid="adjust-product-return"
                    className="rounded-lg border border-maher-navy/30 bg-maher-navy/10 p-3 text-sm text-maher-ink"
                  >
                    <p className="font-semibold">প্রোডাক্ট ফেরত নেবেন?</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        data-testid="adjust-product-return-yes"
                        onClick={() => setReturnProducts(true)}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${returnProducts ? "border-maher-done bg-maher-done/15 text-maher-done" : "border-maher-border bg-white"}`}
                      >
                        হ্যাঁ
                      </button>
                      <button
                        type="button"
                        data-testid="adjust-product-return-no"
                        onClick={() => setReturnProducts(false)}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-semibold transition ${!returnProducts ? "border-maher-due bg-maher-due/15 text-maher-due" : "border-maher-border bg-white"}`}
                      >
                        না
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="adjust-inspection-fee">
                      চেকিং / সার্ভিস ফি (৳)
                    </Label>
                    <Input
                      id="adjust-inspection-fee"
                      data-testid="adjust-inspection-fee"
                      value={inspectionFee}
                      onChange={(e) => setInspectionFee(e.target.value)}
                      inputMode="numeric"
                      placeholder="যেমন: 100"
                      disabled={isTransfer}
                      className="mt-1 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="adjust-refund-amount">
                      কাস্টমারকে ফেরত (৳)
                    </Label>
                    <Input
                      id="adjust-refund-amount"
                      data-testid="adjust-refund-amount"
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      inputMode="numeric"
                      placeholder={`ফি বাদে ${formatTaka(defaultRefund)}`}
                      disabled={isTransfer || fee > 0}
                      className="mt-1 disabled:opacity-50"
                    />
                  </div>
                </div>
                {isTransfer ? (
                  <p className="mt-1 text-xs text-maher-money">
                    জমা স্থানান্তরের সময় কোনো ফি বা নগদ ফেরত দেওয়া যাবে না।
                  </p>
                ) : fee > 0 ? (
                  <p className="mt-1 text-xs text-maher-money">
                    চেকিং ফি আছে, তাই ফেরতের টাকা স্বয়ংক্রিয়ভাবে{" "}
                    {formatTaka(defaultRefund)} ধরা হয়েছে।
                  </p>
                ) : null}

                {hasGroup ? (
                  <div
                    data-testid="adjust-advance-choice"
                    className="rounded-lg border border-maher-navy/30 bg-maher-navy/10 p-3 text-sm text-maher-ink"
                  >
                    <p className="font-semibold">এই ডিভাইসের জমা কী করবেন?</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        data-testid="adjust-advance-cash"
                        onClick={() => setAdvanceAction("cash")}
                        className={`rounded-md border px-3 py-2 text-left transition ${advanceAction === "cash" ? "border-maher-done bg-maher-done/15 ring-1 ring-maher-done" : "border-maher-border bg-white"}`}
                      >
                        কাস্টমারকে ক্যাশ ফেরত দিন
                      </button>
                      <button
                        type="button"
                        data-testid="adjust-advance-transfer"
                        onClick={() => setAdvanceAction("transfer")}
                        className={`rounded-md border px-3 py-2 text-left transition ${advanceAction === "transfer" ? "border-maher-done bg-maher-done/15 ring-1 ring-maher-done" : "border-maher-border bg-white"}`}
                      >
                        গ্রুপের অন্য ডিভাইসে জমা করুন
                      </button>
                    </div>
                    {isTransfer ? (
                      <div className="mt-2">
                        <Label htmlFor="adjust-transfer-to">ডিভাইস বেছে নিন</Label>
                        <select
                          id="adjust-transfer-to"
                          data-testid="adjust-transfer-to"
                          value={transferTo}
                          onChange={(e) => setTransferTo(e.target.value)}
                          className="mt-1 h-9 w-full rounded-md border border-maher-border bg-white px-2 text-sm"
                        >
                          <option value="">-- ডিভাইস নির্বাচন --</option>
                          {siblings.map((s) => (
                            <option key={s.id} value={s.id}>
                              #{s.id} — {s.model} (বাকি {formatTaka(s.due)})
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatTaka(advance)} জমা স্থানান্তর হবে; কোনো ক্যাশ
                          ফেরত হবে না।
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {hasParts && !returned ? (
                  <div
                    data-testid="adjust-parts-list"
                    className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-sm text-maher-ink"
                  >
                    <p className="font-semibold">
                      সংযুক্ত পার্টস ({parts.length}) — এক ক্লিকে নিষ্পত্তি করুন
                    </p>
                    <ul className="mt-2 space-y-1 text-xs text-maher-money">
                      {parts.map((p) => (
                        <li
                          key={p.id}
                          data-testid={`adjust-part-row-${p.id}`}
                        >
                          {p.name} × {p.quantity} — {formatTaka(p.lineCost)}
                        </li>
                      ))}
                    </ul>
                    <div
                      role="radiogroup"
                      aria-label="পার্টস নিষ্পত্তি"
                      className="mt-2 grid gap-2"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={partResolution === "RETURNED"}
                        data-testid="adjust-parts-returned"
                        onClick={() => setPartResolution("RETURNED")}
                        className={`rounded-md border px-3 py-2 text-left transition ${partResolution === "RETURNED" ? "border-maher-done bg-maher-done/15 ring-1 ring-maher-done" : "border-maher-border bg-white"}`}
                      >
                        সব পার্টস মহাজনে ফেরত
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={partResolution === "MOVED_TO_STOCK"}
                        data-testid="adjust-parts-stock"
                        onClick={() => setPartResolution("MOVED_TO_STOCK")}
                        className={`rounded-md border px-3 py-2 text-left transition ${partResolution === "MOVED_TO_STOCK" ? "border-maher-done bg-maher-done/15 ring-1 ring-maher-done" : "border-maher-border bg-white"}`}
                      >
                        সব পার্টস দোকানের স্টকে জমা
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={partResolution === "DAMAGED"}
                        data-testid="adjust-parts-damage"
                        onClick={() => setPartResolution("DAMAGED")}
                        className={`rounded-md border px-3 py-2 text-left transition ${partResolution === "DAMAGED" ? "border-maher-due bg-maher-due/15 ring-1 ring-maher-due" : "border-maher-border bg-white"}`}
                      >
                        কাজের সময় নষ্ট হয়েছে
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={partResolution === "KEPT_IN_LEDGER"}
                        data-testid="adjust-parts-kept"
                        onClick={() => setPartResolution("KEPT_IN_LEDGER")}
                        className={`rounded-md border px-3 py-2 text-left transition ${partResolution === "KEPT_IN_LEDGER" ? "border-maher-navy bg-maher-navy/10 ring-1 ring-maher-navy" : "border-maher-border bg-white"}`}
                      >
                        সব পার্টস খাতায় রাখি (স্টকে যাবে না)
                      </button>
                    </div>
                  </div>
                ) : null}

                {needsExpenseChoice ? (
                  <div
                    data-testid="adjust-expense-choice"
                    className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-sm text-maher-ink"
                  >
                    <p className="font-semibold">
                      দোকান খরচ: {formatTaka(repairCost)}{" "}
                      <span className="font-mono text-xs">
                        (
                        {(service.partsCost ?? 0) > service.expenseAmount
                          ? "পার্টস"
                          : service.shopExpense}
                        )
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
                          পার্টস ব্যবহার/নষ্ট হয়েছে। {formatTaka(repairCost)}{" "}
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
                  disabled={
                    refunding ||
                    (needsPartChoice && !partResolution) ||
                    (needsExpenseChoice && !expenseChoice) ||
                    (isTransfer && !transferTo) ||
                    feeTooHigh ||
                    refundTooHigh ||
                    splitTooHigh
                  }
                  onClick={() => void refund()}
                  className="w-full bg-maher-warning text-white hover:bg-maher-money disabled:opacity-50"
                >
                  {refunding ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : null}
                  {isTransfer
                    ? "জমা স্থানান্তর করে ফেরত বন্ধ করুন"
                    : effectiveRefund > 0
                      ? `ফেরত দিন (${formatTaka(effectiveRefund)})`
                      : "ফেরত হিসাবে বন্ধ করুন"}
                </Button>
                {needsPartChoice && !partResolution ? (
                  <p className="text-center text-xs text-maher-money">
                    আগে সংযুক্ত পার্টসের নিষ্পত্তি বেছে নিন।
                  </p>
                ) : needsExpenseChoice && !expenseChoice ? (
                  <p className="text-center text-xs text-maher-money">
                    আগে দোকান খরচের সিদ্ধান্ত বেছে নিন।
                  </p>
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="damage" className="space-y-3">
            <div className="rounded-lg border border-maher-warning/40 bg-maher-warning/10 p-3 text-xs leading-snug text-maher-ink">
              শুধু দোকানের হিসাব — রিসিট/PDF-এ যাবে না; বিল আলাদা, profit
              থেকে ক্ষতি বাদ।
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
