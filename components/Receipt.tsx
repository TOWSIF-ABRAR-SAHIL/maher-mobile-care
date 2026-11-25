"use client";

import { Printer } from "lucide-react";
import { PaidStamp } from "@/components/PaidStamp";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useShopSettings,
  type ClientShopSettings,
} from "@/components/ShopSettingsProvider";
import { dhakaDateKey } from "@/lib/dhaka";
import { STATUS_BN, formatTaka, type ServiceStatus } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Customer bill — paper-perfect, black on white.                       */
/* NEVER shows shopExpense: this copy is for the customer.              */
/* ------------------------------------------------------------------ */

export const RECEIPT_SHOP_NAME_FALLBACK = "আপনার দোকানের নাম";

export function Receipt({
  service,
  profile,
}: {
  service: ServiceDTO;
  /** Explicit profile for detached PDF renders outside the settings provider. */
  profile?: ClientShopSettings;
}) {
  const { settings: contextSettings } = useShopSettings();
  const settings = profile ?? contextSettings;
  const shopName = settings.shopName || RECEIPT_SHOP_NAME_FALLBACK;
  const statusBn =
    STATUS_BN[(service.status as ServiceStatus) ?? "Pending"] ??
    service.status;
  const isReturned = service.status === "Returned";
  const isPaid =
    !isReturned && service.totalBill > 0 && service.due === 0;
  return (
    <div
      data-receipt
      className="mx-auto w-full max-w-xl bg-white p-4 text-sm text-black sm:p-6"
    >
      {/* Shop header */}
      <div className="text-center">
        <h1 className="text-2xl font-extrabold tracking-wide">{shopName}</h1>
        {settings.slogan ? (
          <p className="mt-0.5 text-xs text-gray-600">{settings.slogan}</p>
        ) : null}
        {settings.address ? (
          <p className="mt-0.5 text-xs text-gray-700">ঠিকানা: {settings.address}</p>
        ) : null}
        {settings.phone ? (
          <p className="mt-0.5 text-xs font-semibold text-gray-800">
            মোবাইল: {settings.phone}
          </p>
        ) : null}
      </div>

      <hr className="my-3 border-t-2 border-black" />

      {/* Bill meta */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p>
          বিল নং: <span className="font-bold">#{service.id}</span>
        </p>
        <p>
          তারিখ:{" "}
          <span className="font-semibold">
            {dhakaDateKey(service.serviceDate)}
          </span>
        </p>
        <p>
          অবস্থা: <span className="font-semibold">{statusBn}</span>
        </p>
      </div>

      <hr className="my-3 border-t border-gray-400" />

      {/* Customer + job */}
      <table className="w-full">
        <tbody>
          <tr>
            <td className="w-24 py-0.5 align-top text-gray-600 sm:w-28">গ্রাহক</td>
            <td className="py-0.5 font-semibold">{service.customerName}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top text-gray-600">মোবাইল</td>
            <td className="py-0.5">{service.phone}</td>
          </tr>
          {service.customerAddress ? (
            <tr data-testid="receipt-customer-address">
              <td className="py-0.5 align-top text-gray-600">ঠিকানা:</td>
              <td className="py-0.5 break-words">{service.customerAddress}</td>
            </tr>
          ) : null}
          <tr>
            <td className="py-0.5 align-top text-gray-600">মডেল</td>
            <td className="py-0.5 font-medium">{service.model}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top text-gray-600">সমস্যা</td>
            <td className="py-0.5">{service.problem}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top text-gray-600">টেকনিশিয়ান</td>
            <td className="py-0.5 font-semibold">{service.technician}</td>
          </tr>
          {service.warranty ? (
            <tr>
              <td className="py-0.5 align-top text-gray-600">ওয়ারেন্টি:</td>
              <td
                data-testid="receipt-warranty"
                className="py-0.5 font-medium"
              >
                {service.warranty}
              </td>
            </tr>
          ) : null}
          {service.deliveredAt ? (
            <tr>
              <td className="py-0.5 align-top text-gray-600">ডেলিভারি</td>
              <td className="py-0.5 font-medium">
                {dhakaDateKey(service.deliveredAt)}
              </td>
            </tr>
          ) : service.deliveryDate ? (
            <tr>
              <td className="py-0.5 align-top text-gray-600">ডেলিভারির তারিখ</td>
              <td className="py-0.5 font-medium">
                {dhakaDateKey(service.deliveryDate)}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {service.condition ? (
        <div
          data-testid="receipt-condition"
          className="my-2 rounded border border-gray-400 px-3 py-2 text-xs"
        >
          <p className="font-semibold">শর্ত</p>
          <p className="mt-0.5 whitespace-pre-wrap">{service.condition}</p>
        </div>
      ) : null}

      {settings.terms ? (
        <div
          data-testid="receipt-terms"
          className="my-2 rounded border border-gray-400 px-3 py-2 text-xs"
        >
          <p className="font-semibold">সাধারণ শর্তাবলী</p>
          <p className="mt-0.5 whitespace-pre-wrap">{settings.terms}</p>
        </div>
      ) : null}

      <hr className="my-3 border-t border-gray-400" />

      {isReturned ? (
        <div className="my-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900">
          ↩️ কাজটি সম্পন্ন হয়নি — মোবাইল ফেরত দেওয়া হয়েছে
          {service.refundAmount > 0
            ? ` এবং ${formatTaka(service.refundAmount)} ফেরত দেওয়া হয়েছে`
            : ""}
          ।
        </div>
      ) : null}

      {/* Product lines on a sale-only receipt (or any visit with products). */}
      {Array.isArray(service.saleItems) && service.saleItems.length > 0 ? (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold text-gray-700">
            প্রোডাক্ট:
          </p>
          <table className="w-full table-fixed text-xs">
            <thead>
              <tr className="border-b border-gray-400">
                <th className="py-1 text-left font-semibold">নাম</th>
                <th className="w-10 py-1 text-center font-semibold">পরিমাণ</th>
                <th className="w-20 py-1 text-right font-semibold">একক</th>
                <th className="w-20 py-1 text-right font-semibold">মোট</th>
              </tr>
            </thead>
            <tbody>
              {service.saleItems.map((line) => (
                <tr key={line.id} className="border-b border-gray-200">
                  <td className="py-1 pr-2">{line.name}</td>
                  <td className="py-1 text-center">{line.quantity}</td>
                  <td className="py-1 text-right">
                    {formatTaka(line.unitPrice)}
                  </td>
                  <td className="py-1 text-right font-semibold">
                    {formatTaka(line.lineTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Money — bill / advance / due only, never shop cost */}
      <table className="w-full">
        <tbody>
          <tr>
            <td className="py-1 text-gray-700">মোট বিল</td>
            <td className="py-1 text-right font-semibold">
              {formatTaka(service.totalBill)}
            </td>
          </tr>
          <tr>
            <td className="py-1 text-gray-700">জমা</td>
            <td className="py-1 text-right font-semibold">
              {formatTaka(service.advance)}
            </td>
          </tr>
          {isReturned ? (
            <tr>
              <td className="py-1 text-amber-800">ফেরত দেওয়া হয়েছে</td>
              <td className="py-1 text-right font-semibold text-amber-800">
                {formatTaka(service.refundAmount)}
              </td>
            </tr>
          ) : null}
          <tr className="border-t-2 border-black">
            <td className="py-1.5 text-base font-bold">বাকি</td>
            <td className="py-1.5 text-right text-base font-extrabold">
              {formatTaka(service.due)}
            </td>
          </tr>
        </tbody>
      </table>

      {isPaid ? (
        <div className="mt-2 flex justify-end pr-2">
          <PaidStamp className="h-28 w-28 -rotate-6" />
        </div>
      ) : null}

      <hr className="my-3 border-t-2 border-black" />

      {/* Signatures */}
      <div className="mt-6 flex justify-between gap-4 sm:gap-8">
        <div className="flex-1 text-center">
          <div className="border-t border-gray-500 pt-1">
            <div
              data-customer-signature
              className="break-words text-sm font-semibold text-black"
            >
              {service.customerName}
            </div>
            <div className="mt-0.5 text-[10px] text-gray-600">
              গ্রাহকের স্বাক্ষর
            </div>
          </div>
        </div>
        <div className="flex-1 text-center">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            দোকান কর্তৃপক্ষ
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        ধন্যবাদ, আবার আসবেন
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Multiple devices from one visit — every device on its own row.      */
/* Also customer-safe: no shop cost, parts shop or damage values.      */
/* ------------------------------------------------------------------ */

export function ReceiptBundle({
  services,
  profile,
}: {
  services: ServiceDTO[];
  profile?: ClientShopSettings;
}) {
  const { settings: contextSettings } = useShopSettings();
  const settings = profile ?? contextSettings;
  const shopName = settings.shopName || RECEIPT_SHOP_NAME_FALLBACK;
  if (services.length === 0) return null;
  if (services.length === 1) {
    return <Receipt service={services[0]} profile={profile} />;
  }

  const first = services[0];
  // A Returned row keeps its original bill/advance for the ledger audit line,
  // but only its retained inspection fee is still live money. Counting the raw
  // figures here (and in the footer) would inflate a group after a refund,
  // especially when the advance was transferred to a sibling device.
  const liveBill = (r: ServiceDTO) =>
    r.status === "Returned" ? r.inspectionFee ?? 0 : r.totalBill;
  const liveAdvance = (r: ServiceDTO) =>
    r.status === "Returned" ? 0 : r.advance;
  const totalBill = services.reduce((s, r) => s + liveBill(r), 0);
  const totalAdvance = services.reduce((s, r) => s + liveAdvance(r), 0);
  const totalDue = services.reduce(
    (s, r) => s + (r.status === "Returned" ? 0 : r.due),
    0
  );
  const totalRefund = services.reduce(
    (s, r) => s + (r.status === "Returned" ? r.refundAmount : 0),
    0
  );
  const allPaid =
    totalBill > 0 &&
    totalDue === 0 &&
    services.every((r) => r.status !== "Returned");
  // One visit = one bill. The header date is only used when every device is
  // promised for the same day; otherwise each row prints its own date.
  const expectedKeys = services.map((r) =>
    r.deliveryDate ? dhakaDateKey(r.deliveryDate) : ""
  );
  const sharedExpected =
    expectedKeys.length > 0 &&
    expectedKeys.every((key) => key !== "" && key === expectedKeys[0])
      ? expectedKeys[0]
      : null;

  return (
    <div
      data-receipt
      data-receipt-group
      className="mx-auto w-full max-w-xl bg-white p-4 text-sm text-black sm:p-6"
    >
      <div className="text-center">
        <h1 className="text-2xl font-extrabold tracking-wide">{shopName}</h1>
        {settings.slogan ? (
          <p className="mt-0.5 text-xs text-gray-600">{settings.slogan}</p>
        ) : null}
        {settings.address ? (
          <p className="mt-0.5 text-xs text-gray-700">ঠিকানা: {settings.address}</p>
        ) : null}
        {settings.phone ? (
          <p className="mt-0.5 text-xs font-semibold text-gray-800">
            মোবাইল: {settings.phone}
          </p>
        ) : null}
      </div>

      <hr className="my-3 border-t-2 border-black" />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p>
          বিল নং: <span className="font-bold">#{first.id}</span>
        </p>
        <p>
          তারিখ:{" "}
          <span className="font-semibold">
            {dhakaDateKey(first.serviceDate)}
          </span>
        </p>
        <p>
          ডিভাইস: <span className="font-semibold">{services.length}টি</span>
        </p>
      </div>

      <hr className="my-3 border-t border-gray-400" />

      <table className="w-full">
        <tbody>
          <tr>
            <td className="w-24 py-0.5 align-top text-gray-600 sm:w-28">গ্রাহক</td>
            <td className="py-0.5 font-semibold">{first.customerName}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top text-gray-600">মোবাইল</td>
            <td className="py-0.5">{first.phone}</td>
          </tr>
          {first.customerAddress ? (
            <tr data-testid="receipt-customer-address">
              <td className="py-0.5 align-top text-gray-600">ঠিকানা:</td>
              <td className="py-0.5 break-words">{first.customerAddress}</td>
            </tr>
          ) : null}
          <tr>
            <td className="py-0.5 align-top text-gray-600">টেকনিশিয়ান</td>
            <td className="py-0.5 font-semibold">{first.technician}</td>
          </tr>
          {sharedExpected ? (
            <tr>
              <td className="py-0.5 align-top text-gray-600">
                ডেলিভারির তারিখ
              </td>
              <td className="py-0.5 font-medium">{sharedExpected}</td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <hr className="my-3 border-t border-gray-400" />

      <table className="w-full table-fixed border-collapse text-xs">
        <thead>
          <tr className="border-b border-gray-500">
            <th className="w-7 py-1 text-left font-semibold">#</th>
            <th className="py-1 text-left font-semibold">মডেল ও সমস্যা</th>
            <th className="w-16 py-1 text-right font-semibold">বিল</th>
            <th className="w-16 py-1 text-right font-semibold">জমা</th>
            <th className="w-16 py-1 text-right font-semibold">বাকি</th>
          </tr>
        </thead>
        <tbody>
          {services.map((s, i) => (
            <tr key={s.id} className="border-b border-gray-300 align-top">
              <td className="py-1">{i + 1}</td>
              <td className="break-words py-1 pr-1">
                <span className="font-medium">{s.model}</span>
                <span className="block text-[10px] text-gray-600">
                  {s.problem}
                </span>
                {s.warranty ? (
                  <span
                    data-testid={`receipt-warranty-${s.id}`}
                    className="mt-0.5 block text-[10px] font-medium text-gray-700"
                  >
                    ওয়ারেন্টি: {s.warranty}
                  </span>
                ) : null}
                {s.status === "Returned" ? (
                  <span className="mt-0.5 block font-semibold text-amber-800">
                    ↩️ ফেরত
                    {s.refundAmount > 0
                      ? ` — ${formatTaka(s.refundAmount)} ফেরত`
                      : ""}
                  </span>
                ) : s.deliveredAt ? (
                  <span className="mt-0.5 block text-[10px] text-emerald-700">
                    ডেলিভারি: {dhakaDateKey(s.deliveredAt)}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-[10px] text-gray-500">
                    {STATUS_BN[(s.status as ServiceStatus) ?? "Pending"] ??
                      s.status}
                  </span>
                )}
                {!sharedExpected &&
                s.deliveryDate &&
                !s.deliveredAt &&
                s.status !== "Returned" ? (
                  <span className="mt-0.5 block text-[10px] text-gray-600">
                    প্রত্যাশিত ডেলিভারি: {dhakaDateKey(s.deliveryDate)}
                  </span>
                ) : null}
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatTaka(s.totalBill)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {formatTaka(s.advance)}
              </td>
              <td className="py-1 text-right tabular-nums">
                {s.status === "Returned" ? "—" : formatTaka(s.due)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td className="py-1.5" colSpan={2}>
              <span className="text-sm font-bold">মোট</span>
            </td>
            <td className="py-1.5 text-right text-sm font-extrabold tabular-nums">
              {formatTaka(totalBill)}
            </td>
            <td className="py-1.5 text-right text-sm font-extrabold tabular-nums">
              {formatTaka(totalAdvance)}
            </td>
            <td className="py-1.5 text-right text-sm font-extrabold tabular-nums">
              {formatTaka(totalDue)}
            </td>
          </tr>
        </tfoot>
      </table>

      {first.condition ? (
        <div
          data-testid="receipt-condition"
          className="my-2 rounded border border-gray-400 px-3 py-2 text-xs"
        >
          <p className="font-semibold">শর্ত</p>
          <p className="mt-0.5 whitespace-pre-wrap">{first.condition}</p>
        </div>
      ) : null}

      {settings.terms ? (
        <div
          data-testid="receipt-terms"
          className="my-2 rounded border border-gray-400 px-3 py-2 text-xs"
        >
          <p className="font-semibold">সাধারণ শর্তাবলী</p>
          <p className="mt-0.5 whitespace-pre-wrap">{settings.terms}</p>
        </div>
      ) : null}

      {totalRefund > 0 ? (
        <p className="mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-center text-xs font-semibold text-amber-900">
          ↩️ ফেরত দেওয়া হয়েছে: {formatTaka(totalRefund)}
        </p>
      ) : null}

      {allPaid ? (
        <div className="mt-2 flex justify-end pr-2">
          <PaidStamp className="h-28 w-28 -rotate-6" />
        </div>
      ) : null}

      <hr className="my-3 border-t-2 border-black" />

      <div className="mt-6 flex justify-between gap-4 sm:gap-8">
        <div className="flex-1 text-center">
          <div className="border-t border-gray-500 pt-1">
            <div className="break-words text-sm font-semibold text-black">
              {first.customerName}
            </div>
            <div className="mt-0.5 text-[10px] text-gray-600">
              গ্রাহকের স্বাক্ষর
            </div>
          </div>
        </div>
        <div className="flex-1 text-center">
          <div className="border-t border-gray-500 pt-1 text-xs text-gray-600">
            দোকান কর্তৃপক্ষ
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-500">
        ধন্যবাদ, আবার আসবেন
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Screen preview dialog — Print button sends ONLY the receipt to paper */
/* ------------------------------------------------------------------ */

export function ReceiptDialog({
  service,
  services,
  onClose,
  onPrint,
}: {
  service: ServiceDTO | null;
  /** Group rows for a multi-device visit; null/1 renders the normal receipt. */
  services?: ServiceDTO[] | null;
  onClose: () => void;
  onPrint: () => void;
}) {
  const bundle = services && services.length > 1 ? services : null;
  return (
    <div className="print:hidden">
      <Dialog
        open={service !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto p-4 sm:max-w-lg sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {bundle ? "একসাথে সব ডিভাইসের বিল" : "বিল প্রিভিউ (কাস্টমার কপি)"}
            </DialogTitle>
          </DialogHeader>
          {service ? (
            <div className="rounded-lg border bg-gray-50 p-2">
              {bundle ? (
                <ReceiptBundle services={bundle} />
              ) : (
                <Receipt service={service} />
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={onClose}>
              বন্ধ করুন
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={onPrint}
            >
              <Printer className="mr-1 h-4 w-4" />
              প্রিন্ট
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
