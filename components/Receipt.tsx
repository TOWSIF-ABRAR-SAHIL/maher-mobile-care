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
import { SHOP } from "@/lib/shop";
import { STATUS_BN, formatTaka, type ServiceStatus } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

/* ------------------------------------------------------------------ */
/* Customer bill — paper-perfect, black on white.                       */
/* NEVER shows shopExpense: this copy is for the customer.              */
/* ------------------------------------------------------------------ */

export function Receipt({ service }: { service: ServiceDTO }) {
  const statusBn =
    STATUS_BN[(service.status as ServiceStatus) ?? "Pending"] ??
    service.status;
  const isPaid = service.totalBill > 0 && service.due === 0;
  return (
    <div
      data-receipt
      className="mx-auto w-full max-w-xl bg-white p-6 text-sm text-black"
    >
      {/* Shop header */}
      <div className="text-center">
        <h1 className="text-2xl font-extrabold tracking-wide">{SHOP.name}</h1>
        <p className="mt-0.5 text-xs text-gray-600">{SHOP.tagline}</p>
        {SHOP.address ? (
          <p className="mt-0.5 text-xs text-gray-700">ঠিকানা: {SHOP.address}</p>
        ) : null}
        {SHOP.phone ? (
          <p className="mt-0.5 text-xs font-semibold text-gray-800">
            মোবাইল: {SHOP.phone}
          </p>
        ) : null}
      </div>

      <hr className="my-3 border-t-2 border-black" />

      {/* Bill meta */}
      <div className="flex items-center justify-between">
        <p>
          বিল নং: <span className="font-bold">#{service.id}</span>
        </p>
        <p>
          তারিখ:{" "}
          <span className="font-semibold">
            {service.serviceDate.slice(0, 10)}
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
            <td className="w-28 py-0.5 align-top text-gray-600">গ্রাহক</td>
            <td className="py-0.5 font-semibold">{service.customerName}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top text-gray-600">মোবাইল</td>
            <td className="py-0.5">{service.phone}</td>
          </tr>
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
        </tbody>
      </table>

      <hr className="my-3 border-t border-gray-400" />

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
      <div className="mt-6 flex justify-between gap-8">
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
/* Screen preview dialog — Print button sends ONLY the receipt to paper */
/* ------------------------------------------------------------------ */

export function ReceiptDialog({
  service,
  onClose,
  onPrint,
}: {
  service: ServiceDTO | null;
  onClose: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="print:hidden">
      <Dialog
        open={service !== null}
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>বিল প্রিভিউ (কাস্টমার কপি)</DialogTitle>
          </DialogHeader>
          {service ? (
            <div className="rounded-lg border bg-gray-50 p-2">
              <Receipt service={service} />
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
