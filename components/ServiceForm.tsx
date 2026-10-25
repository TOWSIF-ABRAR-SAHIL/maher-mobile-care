"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  STATUS_BN,
  FLOW_STATUSES,
  FALLBACK_TECHNICIANS,
  computeDue,
  formatTaka,
  formatTakaBn,
  parseBnNumber,
} from "@/lib/utils";
import { normalizeShopExpense } from "@/lib/expense-code";
import { dhakaDateKey } from "@/lib/dhaka";
import { validateServicePayload } from "@/lib/service-validation";
import type { ServiceDTO } from "@/lib/types";

const empty = {
  customerName: "",
  phone: "",
  model: "",
  // Filled from the fetched roster on mount (see the reconciliation effect) —
  // there is no hardcoded default name any more.
  technician: "",
  problem: "",
  totalBill: "",
  advance: "",
  status: "In-Progress",
  shopExpense: "",
  partsShop: "",
  deliveryDate: "",
  serviceDate: "",
};

/** One extra device in a shared-customer multi-device entry. */
interface ExtraDevice {
  key: number;
  model: string;
  problem: string;
  totalBill: string;
  advance: string;
  status: string;
  shopExpense: string;
  partsShop: string;
}

function blankDevice(key: number): ExtraDevice {
  return {
    key,
    model: "",
    problem: "",
    totalBill: "",
    advance: "",
    status: "In-Progress",
    shopExpense: "",
    partsShop: "",
  };
}

/**
 * Product-sale mode is a UI-only convenience: the DB has no mode column, so
 * the row is saved in the existing `model`/`problem` fields. A roster member
 * named SALES/দোকান is used as the marker when editing a product row.
 */
function isSalesTechnician(name: string): boolean {
  return /sales|দোকান/i.test(name);
}

/**
 * Build form state from a row. Used in useState initializer (NOT an effect):
 * the parent remounts this form per editing id (key), so values are correct
 * from the very first render. Setting Select values in an effect instead
 * makes Radix fire onValueChange("") and silently wipe technician/status.
 */
function toForm(s: ServiceDTO) {
  return {
    customerName: s.customerName,
    phone: s.phone,
    model: s.model,
    technician: s.technician,
    problem: s.problem,
    totalBill: String(s.totalBill),
    advance: String(s.advance),
    status: s.status,
    shopExpense: s.shopExpense ?? "",
    partsShop: s.partsShop ?? "",
    deliveryDate: s.deliveryDate ? dhakaDateKey(s.deliveryDate) : "",
    serviceDate: dhakaDateKey(s.serviceDate),
  };
}

export function ServiceForm({
  initial,
  serviceDate,
  technicians,
  partsShops = [],
  onSaved,
  onCancelEdit,
}: {
  /** Service being edited, or null for a new entry. */
  initial: ServiceDTO | null;
  /** Selected day (YYYY-MM-DD) — new entries are booked on this day. */
  serviceDate: string;
  /** Active roster from /api/technicians. */
  technicians: string[];
  /** Previously used parts-buying shops (datalist suggestions). */
  partsShops?: string[];
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const [f, setF] = useState(() => {
    const base = initial ? toForm(initial) : empty;
    // Editing a product sale (inferred from its sales technician) must show
    // the product labels and the delivered state from the first render.
    // A returned product stays Returned — its status is locked.
    return initial &&
      isSalesTechnician(initial.technician) &&
      initial.status !== "Returned"
      ? { ...base, status: "Delivered" }
      : base;
  });
  const [isProductSale, setIsProductSale] = useState(
    () => !!initial && isSalesTechnician(initial.technician)
  );
  // Remember the service status so switching back from product mode restores
  // it instead of leaving every service job as "Delivered".
  const statusBeforeProduct = useRef(initial?.status ?? "In-Progress");
  const [saving, setSaving] = useState(false);
  // A ref, not the `saving` state: three clicks inside one tick all see
  // saving===false because React has not re-rendered yet, which created three
  // duplicate entries. The ref flips synchronously.
  const savingRef = useRef(false);
  const editing = initial !== null;
  /** Returned rows can be edited, but the ledger fields stay frozen. */
  const isReturnedRow = editing && initial?.status === "Returned";
  const [devices, setDevices] = useState<ExtraDevice[]>([]);
  const deviceSeq = useRef(0);
  const addDevice = () => {
    deviceSeq.current += 1;
    setDevices((prev) =>
      prev.length >= 7 ? prev : [...prev, blankDevice(deviceSeq.current)]
    );
  };
  const removeDevice = (key: number) =>
    setDevices((prev) => prev.filter((d) => d.key !== key));
  const setDevice =
    (key: number, field: keyof Omit<ExtraDevice, "key">) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setDevices((prev) =>
        prev.map((d) => (d.key === key ? { ...d, [field]: e.target.value } : d))
      );

  /**
   * Options = active roster, PLUS the edited row's own technician when that
   * person has since been deactivated (F11). Without this, saving an old job of
   * a technician who left the shop would silently reassign the job to somebody
   * else, because their name is no longer selectable.
   */
  const techOptions = useMemo(() => {
    const active = technicians.length > 0 ? technicians : [...FALLBACK_TECHNICIANS];
    const current = initial?.technician ?? "";
    const options =
      !current || active.includes(current) ? active : [...active, current];
    // In product mode put SALES/দোকান first so the right technician is easy to
    // pick. Nothing is hardcoded — the roster still owns the name and the API
    // still rejects technicians that do not exist.
    return isProductSale
      ? [...options].sort(
          (a, b) =>
            Number(isSalesTechnician(b)) - Number(isSalesTechnician(a))
        )
      : options;
  }, [technicians, initial?.technician, isProductSale]);

  const hasSalesTechnician = useMemo(
    () => techOptions.some(isSalesTechnician),
    [techOptions]
  );

  const isInactiveOption = useMemo(
    () =>
      technicians.length > 0 &&
      !!initial?.technician &&
      !technicians.includes(initial.technician),
    [technicians, initial?.technician]
  );

  // Roster changed under an open form (rename/delete elsewhere): keep the
  // stored value if it is still offered, otherwise fall back to the first one.
  useEffect(() => {
    setF((prev) => {
      const stillValid = techOptions.includes(prev.technician);
      const next = stillValid ? prev.technician : techOptions[0] ?? "";
      return stillValid || next === prev.technician
        ? prev
        : { ...prev, technician: next };
    });
  }, [techOptions]);

  const set = (key: keyof typeof empty) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const billNum = parseBnNumber(f.totalBill) ?? 0;
  const advNum = parseBnNumber(f.advance) ?? 0;
  const due = computeDue(billNum, advNum);
  const normalizedExpense = normalizeShopExpense(f.shopExpense);

  const chooseService = () => {
    if (!isProductSale) return;
    setIsProductSale(false);
    setF((p) => ({
      ...p,
      status: statusBeforeProduct.current || "In-Progress",
    }));
  };

  const chooseProduct = () => {
    if (isProductSale) return;
    statusBeforeProduct.current = f.status;
    setIsProductSale(true);
    // A product is handed over at the counter: force the delivered state.
    setF((p) => ({ ...p, status: "Delivered" }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;

    // Extra rows are optional. Ignore a blank row the user added but never
    // filled, so it cannot block the main entry.
    const filledDevices = devices.filter((d) =>
      [d.model, d.problem, d.totalBill, d.advance, d.shopExpense, d.partsShop]
        .map((v) => v.trim())
        .some(Boolean)
    );

    let payload: ReturnType<typeof validateServicePayload>;
    const extraPayloads: ReturnType<typeof validateServicePayload>[] = [];
    try {
      payload = validateServicePayload(
        {
          customerName: f.customerName,
          phone: f.phone,
          model: f.model,
          technician: f.technician,
          problem: f.problem,
          totalBill: f.totalBill,
          advance: f.advance,
          // Returned is terminal and accepted only by the refund endpoint, so
          // validate with a neutral flow status; the field is omitted below.
          status: isReturnedRow
            ? "Pending"
            : isProductSale
              ? "Delivered"
              : f.status,
          shopExpense: f.shopExpense,
          partsShop: f.partsShop,
          deliveryDate: f.deliveryDate,
          serviceDate: editing ? f.serviceDate : serviceDate,
        },
        // An inactive technician's own historical job stays editable, so the
        // option list (not the active-only roster) is what we validate against.
        { allowedTechnicians: techOptions, productSale: isProductSale }
      );
      for (const d of filledDevices) {
        extraPayloads.push(
          validateServicePayload(
            {
              customerName: f.customerName,
              phone: f.phone,
              model: d.model,
              technician: f.technician,
              problem: d.problem,
              totalBill: d.totalBill,
              advance: d.advance,
              status: d.status,
              shopExpense: d.shopExpense,
              partsShop: d.partsShop,
              deliveryDate: f.deliveryDate,
              serviceDate,
            },
            { allowedTechnicians: techOptions }
          )
        );
      }
    } catch (err) {
      return toast.error(
        err instanceof Error ? err.message : "সঠিক তথ্য দিন"
      );
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const toDto = (
        p: ReturnType<typeof validateServicePayload>,
        includeMoney: boolean
      ) => ({
        customerName: p.customerName,
        phone: p.phone,
        model: p.model,
        technician: p.technician,
        problem: p.problem,
        // Returned rows keep bill/advance/status locked by the API, so those
        // fields must be omitted rather than sent unchanged.
        ...(includeMoney
          ? { totalBill: p.totalBill, advance: p.advance, status: p.status }
          : {}),
        shopExpense: p.shopExpense ?? "",
        partsShop: p.partsShop ?? "",
        deliveryDate: f.deliveryDate,
        serviceDate: editing ? p.serviceDateKey : serviceDate,
      });

      let res: Response;
      let data: { error?: string } & Record<string, unknown>;
      if (!editing && extraPayloads.length > 0) {
        // One customer visit, one transaction, one shared groupId.
        res = await fetch("/api/services/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: f.customerName,
            phone: f.phone,
            technician: f.technician,
            serviceDate,
            deliveryDate: f.deliveryDate,
            devices: [payload, ...extraPayloads].map((p) => ({
              ...toDto(p, true),
            })),
          }),
        });
      } else {
        res = await fetch(
          editing ? `/api/services/${initial!.id}` : "/api/services",
          {
            method: editing ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toDto(payload, !isReturnedRow)),
          }
        );
      }
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "সেভ করা যায়নি");
      toast.success(
        !editing && extraPayloads.length > 0
          ? `${extraPayloads.length + 1}টি ডিভাইস একসাথে সেভ হয়েছে`
          : editing
            ? "আপডেট হয়েছে"
            : "সেভ হয়েছে"
      );
      // Reset with a valid technician: the roster-change effect below only runs
      // when `techOptions` changes, so a plain `setF(empty)` left the select
      // blank and the NEXT save failed with "সঠিক টেকনিশিয়ান বাছুন".
      if (!editing) {
        // Use the normal (unsorted) roster head, not the product-mode sorted
        // head, or the next service entry would default to SALES.
        const defaultTech =
          technicians.length > 0
            ? technicians[0]
            : FALLBACK_TECHNICIANS[0];
        setF({ ...empty, technician: defaultTech ?? "" });
        setDevices([]);
        setIsProductSale(false);
        statusBeforeProduct.current = "In-Progress";
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "সেভ করা যায়নি");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-2.5 print:hidden">
      <h2 className="mb-1.5 flex items-center gap-2 text-base font-semibold tracking-tight text-gray-800">
        <Plus className="h-4 w-4 text-blue-700" />
        নতুন সার্ভিস এন্ট্রি
      </h2>
      <form onSubmit={submit} className="space-y-2">
        {/* Mode toggle — lives at the very top of the form. */}
        <div>
          <div
            role="radiogroup"
            aria-label="এন্ট্রির ধরন"
            data-testid="service-mode-toggle"
            className="grid grid-cols-2 gap-1 rounded-lg border border-blue-200 bg-blue-50/70 p-1"
          >
            <Button
              type="button"
              role="radio"
              aria-checked={!isProductSale}
              data-testid="mode-service"
              size="sm"
              variant={!isProductSale ? "default" : "ghost"}
              disabled={isReturnedRow}
              onClick={chooseService}
              className={
                !isProductSale
                  ? "bg-blue-700 text-white hover:bg-blue-800"
                  : "text-gray-700 hover:bg-white"
              }
            >
              🛠️ সার্ভিসিং
            </Button>
            <Button
              type="button"
              role="radio"
              aria-checked={isProductSale}
              data-testid="mode-product"
              size="sm"
              variant={isProductSale ? "default" : "ghost"}
              disabled={isReturnedRow}
              onClick={chooseProduct}
              className={
                isProductSale
                  ? "bg-amber-600 text-white hover:bg-amber-700"
                  : "text-gray-700 hover:bg-white"
              }
            >
              🛍️ প্রোডাক্ট সেল
            </Button>
          </div>
          {isProductSale ? (
            <p className="mt-1 text-xs leading-snug text-blue-800">
              প্রোডাক্টের নাম ও বিবরণ লিখুন; কাজের অবস্থা অটো “ডেলিভারি” হবে।
            </p>
          ) : null}
        </div>

        {isReturnedRow ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
            ↩️ এই কাজটি ফেরত দেওয়া হয়েছে। বিল, জমা ও অবস্থা লক করা আছে —
            কাস্টমার, ফোন, মডেল, সমস্যা, টেকনিশিয়ান, খরচ ও তারিখ এডিট করতে
            পারবেন।
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-name">কাস্টমারের নাম</Label>
            <Input id="svc-name" value={f.customerName} onChange={set("customerName")} className="h-9 xl:h-8" />
          </div>
          <div>
            <Label htmlFor="svc-phone">মোবাইল নম্বর (WhatsApp)</Label>
            <Input
              id="svc-phone"
              value={f.phone}
              onChange={set("phone")}
              placeholder="017xxxxxxxx"
              inputMode="tel"
              className="h-9 xl:h-8"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-model">
              {isProductSale
                ? "প্রোডাক্টের নাম (যেমন: Charger, Cable)"
                : "মোবাইলের মডেল"}
            </Label>
            <Input
              id="svc-model"
              value={f.model}
              onChange={set("model")}
              placeholder={
                isProductSale ? "যেমন: 18W Charger" : "যেমন: Redmi Note 10"
              }
              className="h-9 xl:h-8"
            />
          </div>
          <div>
            <Label>টেকনিশিয়ান</Label>
            <Select
              value={f.technician}
              onValueChange={(v) => {
                // Belt-and-braces: Radix can emit "" for a controlled value
                // whose item never mounted — never accept a blank.
                if (!v) return;
                setF((p) => ({ ...p, technician: v }));
              }}
            >
              <SelectTrigger id="svc-tech" className="h-9 xl:h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {techOptions.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                    {isInactiveOption && t === initial?.technician
                      ? " (নিষ্ক্রিয়)"
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isProductSale ? (
              <p
                className={`mt-1 text-xs leading-snug ${
                  hasSalesTechnician ? "text-gray-500" : "text-amber-700"
                }`}
              >
                {hasSalesTechnician
                  ? "প্রোডাক্ট সেলের জন্য SALES/দোকান টেকনিশিয়ান বেছে নিন।"
                  : "SALES/দোকান টেকনিশিয়ান দরকার হলে টেকনিশিয়ান ম্যানেজার থেকে যোগ করুন।"}
              </p>
            ) : null}
          </div>
        </div>

        <div>
          <Label htmlFor="svc-problem">
            {isProductSale ? "বিবরণ (যেমন: 18W Type-C)" : "সমস্যা"}
          </Label>
          <Input
            id="svc-problem"
            value={f.problem}
            onChange={set("problem")}
            placeholder={
              isProductSale ? "যেমন: Type-C, 1 মিটার" : "যেমন: ডিসপ্লে পরিবর্তন"
            }
            className="h-9 xl:h-8"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="svc-bill">মোট বিল (৳)</Label>
            <Input
              id="svc-bill"
              value={f.totalBill}
              onChange={set("totalBill")}
              placeholder="0"
              inputMode="numeric"
              readOnly={isReturnedRow}
              className="h-9 xl:h-8 read-only:bg-gray-50"
            />
          </div>
          <div>
            <Label htmlFor="svc-adv">জমা (৳)</Label>
            <Input
              id="svc-adv"
              value={f.advance}
              onChange={set("advance")}
              placeholder="0"
              inputMode="numeric"
              readOnly={isReturnedRow}
              className="h-9 xl:h-8 read-only:bg-gray-50"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="svc-due">বাকি (৳)</Label>
            <Input
              id="svc-due"
              value={formatTaka(due).replace("৳", "").trim()}
              readOnly
              className="h-9 bg-gray-50 font-semibold xl:h-8"
            />
          </div>
          <div>
            <Label>কাজের অবস্থা</Label>
            <Select
              value={isProductSale && !isReturnedRow ? "Delivered" : f.status}
              disabled={isProductSale || isReturnedRow}
              onValueChange={(v) => {
                if (!v) return;
                setF((p) => ({ ...p, status: v }));
              }}
            >
              <SelectTrigger
                id="svc-status"
                disabled={isProductSale || isReturnedRow}
                className="h-9 xl:h-8"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOW_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_BN[s]}
                  </SelectItem>
                ))}
                {/* Display-only: lets the locked trigger show ফেরত instead of
                    a blank value. The select is disabled for returned rows,
                    and the API/validation still reject a manual Returned. */}
                {isReturnedRow ? (
                  <SelectItem value="Returned">{STATUS_BN.Returned}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
            {isProductSale && !isReturnedRow ? (
              <p className="mt-1 text-xs text-gray-500">
                অটো: ডেলিভারি (প্রোডাক্ট হাতে দেওয়া হয়েছে)
              </p>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-orange-200 bg-orange-50/60 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="svc-expense" className="flex items-center gap-1.5 text-orange-950">
                <KeyRound className="h-3.5 w-3.5 text-orange-700" />
                দোকান খরচ (কোড বা সংখ্যা)
              </Label>
              <Input
                id="svc-expense"
                value={f.shopExpense}
                onChange={set("shopExpense")}
                placeholder="যেমন: *J# বা 1500"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
                aria-invalid={normalizedExpense.kind === "invalid"}
                aria-describedby="svc-expense-help"
                className={`h-9 xl:h-8 ${
                  normalizedExpense.kind === "invalid"
                    ? "border-red-500 focus-visible:ring-red-500"
                    : ""
                }`}
              />
              <div
                id="svc-expense-help"
                aria-live="polite"
                className="mt-1 min-h-[18px] text-xs"
              >
                {normalizedExpense.kind === "code" &&
                normalizedExpense.amount !== null ? (
                  <span className="font-medium text-emerald-700">
                    গোপন কোড: {normalizedExpense.stored} ➔{" "}
                    {formatTakaBn(normalizedExpense.amount)}
                  </span>
                ) : normalizedExpense.kind === "number" &&
                  normalizedExpense.amount !== null ? (
                  <span className="font-medium text-emerald-700">
                    সেভ করলে কোড হবে: {normalizedExpense.stored} ➔{" "}
                    {formatTakaBn(normalizedExpense.amount)}
                  </span>
                ) : normalizedExpense.kind === "invalid" ? (
                  <span className="font-medium text-red-600">
                    {normalizedExpense.error}
                  </span>
                ) : (
                  <span className="text-orange-900/70">
                    খালি রাখলে দোকান খরচ ০ ধরা হবে।
                  </span>
                )}
              </div>
            </div>
            <div>
              <Label htmlFor="svc-parts-shop">পার্টস কেনার দোকান</Label>
              <Input
                id="svc-parts-shop"
                value={f.partsShop}
                onChange={set("partsShop")}
                list="parts-shop-options"
                maxLength={100}
                placeholder="দোকানের নাম (ঐচ্ছিক)"
                autoComplete="off"
                className="h-9 xl:h-8"
              />
              <datalist id="parts-shop-options">
                {partsShops.map((shop) => (
                  <option key={shop} value={shop} />
                ))}
              </datalist>
            </div>
          </div>
          <p className="flex items-start gap-1.5 text-xs leading-snug text-orange-900/80">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              এই খরচ ও দোকানের নাম শুধু দোকানের হিসাবের জন্য — কাস্টমার
              রিসিট/PDF-এ যাবে না।
            </span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-delivery-date">
              ডেলিভারির সম্ভাব্য তারিখ (ঐচ্ছিক)
            </Label>
            <Input
              id="svc-delivery-date"
              type="date"
              value={f.deliveryDate}
              onChange={set("deliveryDate")}
              className="h-9 xl:h-8"
            />
            {initial?.deliveredAt ? (
              <p className="mt-1 text-xs text-emerald-700">
                ✅ ডেলিভারি সম্পন্ন: {dhakaDateKey(initial.deliveredAt)}
              </p>
            ) : null}
          </div>
          {editing ? (
            <div>
              <Label htmlFor="svc-date">তারিখ (ভুল দিনে হলে বদলান)</Label>
              <Input
                id="svc-date"
                type="date"
                value={f.serviceDate}
                onChange={set("serviceDate")}
                className="h-9 xl:h-8"
              />
            </div>
          ) : null}
        </div>
        {!editing && !isProductSale ? (
          <div
            data-testid="extra-devices"
            className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/50 p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-blue-950">
                  👥 এক কাস্টমারের একাধিক ডিভাইস
                </p>
                <p className="text-xs leading-snug text-blue-900/80">
                  নাম, ফোন, টেকনিশিয়ান ও তারিখ সব ডিভাইসের জন্য একই থাকবে।
                  চাইলে আলাদা আলাদাভাবেও এন্ট্রি করতে পারবেন।
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="add-device"
                onClick={addDevice}
                disabled={devices.length >= 7}
                className="shrink-0 border-blue-300 bg-white text-blue-800 hover:bg-blue-100"
              >
                <Plus className="mr-1 h-4 w-4" />
                আরেকটি ডিভাইস
              </Button>
            </div>

            {devices.map((d, index) => {
              const dBill = parseBnNumber(d.totalBill) ?? 0;
              const dAdv = parseBnNumber(d.advance) ?? 0;
              return (
                <div
                  key={d.key}
                  data-testid={`extra-device-${index + 1}`}
                  className="space-y-2 rounded-lg border border-blue-200 bg-white p-2"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">
                      📱 ডিভাইস {index + 2}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                      onClick={() => removeDevice(d.key)}
                    >
                      সরান
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-model`}>
                        মোবাইলের মডেল
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-model`}
                        value={d.model}
                        onChange={setDevice(d.key, "model")}
                        className="h-9 xl:h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-problem`}>
                        সমস্যা
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-problem`}
                        value={d.problem}
                        onChange={setDevice(d.key, "problem")}
                        className="h-9 xl:h-8"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-bill`}>
                        মোট বিল (৳)
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-bill`}
                        value={d.totalBill}
                        onChange={setDevice(d.key, "totalBill")}
                        inputMode="numeric"
                        placeholder="0"
                        className="h-9 xl:h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-adv`}>
                        জমা (৳)
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-adv`}
                        value={d.advance}
                        onChange={setDevice(d.key, "advance")}
                        inputMode="numeric"
                        placeholder="0"
                        className="h-9 xl:h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-due`}>
                        বাকি (৳)
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-due`}
                        value={formatTaka(computeDue(dBill, dAdv)).replace(
                          "৳",
                          ""
                        ).trim()}
                        readOnly
                        className="h-9 bg-gray-50 font-semibold xl:h-8"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-status`}>
                        কাজের অবস্থা
                      </Label>
                      <select
                        id={`svc-device-${d.key}-status`}
                        value={d.status}
                        onChange={(e) =>
                          setDevices((prev) =>
                            prev.map((row) =>
                              row.key === d.key
                                ? { ...row, status: e.target.value }
                                : row
                            )
                          )
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm xl:h-8"
                      >
                        {FLOW_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_BN[st]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-expense`}>
                        দোকান খরচ (কোড)
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-expense`}
                        value={d.shopExpense}
                        onChange={setDevice(d.key, "shopExpense")}
                        placeholder="যেমন: *J#"
                        maxLength={24}
                        autoComplete="off"
                        spellCheck={false}
                        className="h-9 xl:h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`svc-device-${d.key}-parts-shop`}>
                        পার্টসের দোকান
                      </Label>
                      <Input
                        id={`svc-device-${d.key}-parts-shop`}
                        value={d.partsShop}
                        onChange={setDevice(d.key, "partsShop")}
                        list="parts-shop-options"
                        maxLength={100}
                        autoComplete="off"
                        placeholder="ঐচ্ছিক"
                        className="h-9 xl:h-8"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-2.5 -mb-2.5 border-t border-slate-200 bg-white/95 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-white/80">
          {editing ? (
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 bg-blue-700 hover:bg-blue-800" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "আপডেট করুন"}
              </Button>
              <Button type="button" variant="outline" onClick={onCancelEdit}>
                বাতিল
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              className="w-full bg-blue-700 text-base hover:bg-blue-800"
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "সেভ করুন"}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
