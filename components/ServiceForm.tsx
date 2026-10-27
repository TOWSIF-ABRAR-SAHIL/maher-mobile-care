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
  toBnDigits,
} from "@/lib/utils";
import { normalizeShopExpense } from "@/lib/expense-code";
import { dhakaDateKey } from "@/lib/dhaka";
import {
  OVERPAY_MESSAGE,
  parseServiceAmount,
  validateServicePayload,
} from "@/lib/service-validation";
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
  imei: "",
};

/** One device in a shared-customer visit. Money/status live on the visit. */
interface VisitDevice {
  key: number;
  model: string;
  problem: string;
  totalBill: string;
  /** Expected handover day for THIS device; defaults to the entry day. */
  deliveryDate: string;
  /** Optional handset IMEI (persisted as text on this device row). */
  imei: string;
}

function blankDevice(key: number, entryDay: string): VisitDevice {
  return {
    key,
    model: "",
    problem: "",
    totalBill: "",
    deliveryDate: entryDay,
    imei: "",
  };
}

/** Blank optional money fields mean zero; anything else must be a valid amount. */
function parseEntryAmount(raw: string, field: string): number {
  const text = String(raw ?? "").trim();
  return text === "" ? 0 : parseServiceAmount(text, field);
}

/**
 * A single visit advance is split across device bills in order. Each row gets
 * at most its own bill, so no row is ever overpaid and the group due is simply
 * the visit bill minus the visit advance.
 */
function allocateAdvance(bills: number[], advance: number): number[] {
  let remaining = advance;
  return bills.map((bill) => {
    const share = Math.min(bill, Math.max(0, remaining));
    remaining -= share;
    return share;
  });
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
    ...empty,
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
    imei: s.imei ?? "",
  };
}

export function ServiceForm({
  initial,
  serviceDate,
  technicians,
  partsShops = [],
  initialProductMode = false,
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
  /** Deep link `/service?mode=product` opens the product-sale variant. */
  initialProductMode?: boolean;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const [f, setF] = useState(() => {
    const base = initial ? toForm(initial) : empty;
    // Editing a product sale (inferred from its sales technician) must show
    // the product labels and the delivered state from the first render.
    // A returned product stays Returned — its status is locked.
    if (
      initial &&
      isSalesTechnician(initial.technician) &&
      initial.status !== "Returned"
    ) {
      return { ...base, status: "Delivered" };
    }
    // Product-sale deep link starts delivered at the counter, same as the
    // mode toggle would do on click.
    if (!initial && initialProductMode) {
      return { ...base, status: "Delivered" };
    }
    return base;
  });
  const [isProductSale, setIsProductSale] = useState(
    () =>
      (!!initial && isSalesTechnician(initial.technician)) ||
      (!initial && initialProductMode)
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
  // The first device is always present; extras are added one at a time. Each
  // device carries its own expected delivery day, defaulting to the entry day.
  const [devices, setDevices] = useState<VisitDevice[]>(() => [
    blankDevice(0, serviceDate),
  ]);
  const [visitTotalBill, setVisitTotalBill] = useState("");
  const deviceSeq = useRef(1);
  const addDevice = () => {
    if (devices.length >= 8) return;
    const key = deviceSeq.current;
    deviceSeq.current += 1;
    setDevices((prev) =>
      prev.length >= 8 ? prev : [...prev, blankDevice(key, serviceDate)]
    );
  };
  const removeDevice = (key: number) =>
    setDevices((prev) =>
      prev.length > 1 ? prev.filter((d) => d.key !== key) : prev
    );
  /** Patch one device row only, so extra cards never leak into each other. */
  const patchDevice = (
    key: number,
    patch: Partial<Omit<VisitDevice, "key">>
  ) =>
    setDevices((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d))
    );
  const setDevice =
    (
      key: number,
      field: "model" | "problem" | "totalBill" | "deliveryDate" | "imei"
    ) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      patchDevice(key, { [field]: e.target.value });

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

  // The selected day is the default delivery day for every device. When the
  // shop moves the dashboard to another day, devices still sitting on the
  // previous default follow it; a date the user picked deliberately stays.
  const lastServiceDate = useRef(serviceDate);
  useEffect(() => {
    const previous = lastServiceDate.current;
    if (previous === serviceDate) return;
    lastServiceDate.current = serviceDate;
    setDevices((prev) =>
      prev.map((d) =>
        d.deliveryDate === previous || d.deliveryDate === ""
          ? { ...d, deliveryDate: serviceDate }
          : d
      )
    );
  }, [serviceDate]);

  const set = (key: keyof typeof empty) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const billNum = parseBnNumber(f.totalBill) ?? 0;
  const advNum = parseBnNumber(f.advance) ?? 0;
  const due = computeDue(billNum, advNum);
  const normalizedExpense = normalizeShopExpense(f.shopExpense);

  // New service entry: device bills add up to the visit bill. If no device
  // bill is filled, the visit total is entered once and lands on device 1.
  const hasDeviceBills = devices.some((d) => d.totalBill.trim() !== "");
  const deviceBillsTotal = devices.reduce(
    (sum, d) => sum + (parseBnNumber(d.totalBill) ?? 0),
    0
  );
  const visitBillText = hasDeviceBills
    ? String(deviceBillsTotal)
    : visitTotalBill;
  const visitBillNum = parseBnNumber(visitBillText) ?? 0;
  const visitAdvanceNum = parseBnNumber(f.advance) ?? 0;
  const visitDue = computeDue(visitBillNum, visitAdvanceNum);

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

    let payload: ReturnType<typeof validateServicePayload>;
    const extraPayloads: ReturnType<typeof validateServicePayload>[] = [];
    try {
      if (!editing && !isProductSale) {
        // New service entry: every numbered device card is one row. A blank
        // extra card is ignored; the first card is always validated.
        const entryDevices = devices.filter(
          (d, index) =>
            index === 0 ||
            [d.model, d.problem, d.totalBill, d.imei].some((v) => v.trim())
        );
        const bills = entryDevices.map((d, index) =>
          parseEntryAmount(
            hasDeviceBills ? d.totalBill : index === 0 ? visitTotalBill : "",
            "মোট বিল"
          )
        );
        const visitBill = bills.reduce((sum, amount) => sum + amount, 0);
        const visitAdvance = parseEntryAmount(f.advance, "জমা");
        if (visitAdvance > visitBill) throw new Error(OVERPAY_MESSAGE);
        const advances = allocateAdvance(bills, visitAdvance);
        const validated = entryDevices.map((d, index) =>
          validateServicePayload(
            {
              customerName: f.customerName,
              phone: f.phone,
              model: d.model,
              technician: f.technician,
              problem: d.problem,
              totalBill: String(bills[index]),
              advance: String(advances[index]),
              status: f.status,
              // Shop cost belongs to the visit, so keep it on device 1 only;
              // repeating it would multiply the shop's expense reports.
              shopExpense: index === 0 ? f.shopExpense : "",
              partsShop: index === 0 ? f.partsShop : "",
              // Each device keeps its own expected handover day.
              deliveryDate: d.deliveryDate,
              // Optional per-device IMEI; a blank one becomes NULL.
              imei: d.imei,
              serviceDate,
            },
            { allowedTechnicians: techOptions }
          )
        );
        payload = validated[0];
        extraPayloads.push(...validated.slice(1));
      } else {
        payload = validateServicePayload(
          {
            customerName: f.customerName,
            phone: f.phone,
            model: f.model,
            technician: f.technician,
            problem: f.problem,
            totalBill: f.totalBill,
            advance: f.advance,
            // Returned is terminal and accepted only by the refund endpoint,
            // so validate with a neutral flow status; omitted below.
            status: isReturnedRow
              ? "Pending"
              : isProductSale
                ? "Delivered"
                : f.status,
            shopExpense: f.shopExpense,
            partsShop: f.partsShop,
            deliveryDate: f.deliveryDate,
            imei: f.imei,
            serviceDate: editing ? f.serviceDate : serviceDate,
          },
          // An inactive technician's own historical job stays editable, so the
          // option list (not the active-only roster) is what we validate against.
          { allowedTechnicians: techOptions, productSale: isProductSale }
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
        // The validated payload already holds this row's own date (per device
        // for a visit, the single form field when editing one row).
        deliveryDate: p.deliveryDate ? dhakaDateKey(p.deliveryDate) : "",
        imei: p.imei ?? "",
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
            // Each device row carries its own delivery date.
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
        setDevices([blankDevice(0, serviceDate)]);
        deviceSeq.current = 1;
        setVisitTotalBill("");
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

  // Shared controls appear once per form. The two branches below never render
  // them at the same time, so ids stay unique.
  const technicianField = (
    <>
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
            hasSalesTechnician ? "text-muted-foreground" : "text-maher-money"
          }`}
        >
          {hasSalesTechnician
            ? "প্রোডাক্ট সেলের জন্য SALES/দোকান টেকনিশিয়ান বেছে নিন।"
            : "SALES/দোকান টেকনিশিয়ান দরকার হলে টেকনিশিয়ান ম্যানেজার থেকে যোগ করুন।"}
        </p>
      ) : null}
    </>
  );

  const statusField = (
    <>
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
        <p className="mt-1 text-xs text-muted-foreground">
          অটো: ডেলিভারি (প্রোডাক্ট হাতে দেওয়া হয়েছে)
        </p>
      ) : null}
    </>
  );

  const deliveryDateField = (
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
        <p className="mt-1 text-xs text-maher-done">
          ✅ ডেলিভারি সম্পন্ন: {dhakaDateKey(initial.deliveredAt)}
        </p>
      ) : null}
    </div>
  );

  return (
    <section className="rounded-xl border border-maher-border bg-card p-2.5 shadow-card sheen print:hidden">
      <h2 className="mb-1.5 flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
        <Plus className="h-4 w-4 text-maher-navy" />
        নতুন সার্ভিস এন্ট্রি
      </h2>
      <form onSubmit={submit} className="space-y-2">
        {/* Mode toggle — lives at the very top of the form. */}
        <div>
          <div
            role="radiogroup"
            aria-label="এন্ট্রির ধরন"
            data-testid="service-mode-toggle"
            className="grid grid-cols-2 gap-1 rounded-lg border border-maher-border bg-maher-surface/50 p-1"
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
                  ? "bg-maher-navy text-white hover:bg-maher-navy-light"
                  : "text-muted-foreground hover:bg-white"
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
                  ? "bg-maher-money text-white hover:brightness-90"
                  : "text-muted-foreground hover:bg-white"
              }
            >
              🛍️ প্রোডাক্ট সেল
            </Button>
          </div>
          {isProductSale ? (
            <p className="mt-1 text-xs leading-snug text-maher-navy">
              প্রোডাক্টের নাম ও বিবরণ লিখুন; কাজের অবস্থা অটো “ডেলিভারি” হবে।
            </p>
          ) : null}
        </div>

        {isReturnedRow ? (
          <div className="rounded-lg border border-maher-money bg-maher-money/10 px-3 py-2 text-xs leading-snug text-maher-money">
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

        {editing || isProductSale ? (
          <>
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
              <div>{technicianField}</div>
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
                  isProductSale
                    ? "যেমন: Type-C, 1 মিটার"
                    : "যেমন: ডিসপ্লে পরিবর্তন"
                }
                className="h-9 xl:h-8"
              />
            </div>

            {isProductSale ? null : (
              <div>
                <Label htmlFor="svc-imei">IMEI Number</Label>
                <Input
                  id="svc-imei"
                  data-testid="svc-imei"
                  value={f.imei}
                  onChange={set("imei")}
                  placeholder="Enter IMEI number (optional)"
                  inputMode="numeric"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  className="h-9 xl:h-8"
                />
              </div>
            )}

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
                  className="h-9 xl:h-8 read-only:bg-maher-surface/50"
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
                  className="h-9 xl:h-8 read-only:bg-maher-surface/50"
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
                  className="h-9 bg-maher-surface/50 font-semibold xl:h-8"
                />
              </div>
              <div>{statusField}</div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>{technicianField}</div>
            </div>

            <div data-testid="extra-devices" className="space-y-2">
              {devices.map((d, index) => {
                const isFirst = index === 0;
                const prefix = isFirst ? "svc" : `svc-device-${d.key}`;
                return (
                  <div
                    key={d.key}
                    data-testid={
                      isFirst ? "device-1" : `extra-device-${index}`
                    }
                    className="rounded-lg border border-maher-border bg-card p-2 shadow-card"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-maher-navy px-1 text-[11px] font-bold text-white">
                          {toBnDigits(index + 1)}
                        </span>
                        ডিভাইস {toBnDigits(index + 1)}
                      </p>
                      {!isFirst ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-maher-due hover:bg-maher-due/10 hover:text-maher-due"
                          onClick={() => removeDevice(d.key)}
                        >
                          সরান
                        </Button>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <Label htmlFor={`${prefix}-model`}>
                          মোবাইলের মডেল
                        </Label>
                        <Input
                          id={`${prefix}-model`}
                          value={d.model}
                          onChange={setDevice(d.key, "model")}
                          placeholder="যেমন: Redmi Note 10"
                          className="h-9 xl:h-8"
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <Label htmlFor={`${prefix}-problem`}>সমস্যা</Label>
                          <Input
                            id={`${prefix}-problem`}
                            value={d.problem}
                            onChange={setDevice(d.key, "problem")}
                            placeholder="যেমন: ডিসপ্লে পরিবর্তন"
                            className="h-9 xl:h-8"
                          />
                        </div>
                        <div>
                          <Label htmlFor={`${prefix}-bill`}>বিল (৳)</Label>
                          <Input
                            id={`${prefix}-bill`}
                            value={d.totalBill}
                            onChange={setDevice(d.key, "totalBill")}
                            inputMode="numeric"
                            placeholder="ঐচ্ছিক"
                            className="h-9 xl:h-8"
                          />
                        </div>
                      </div>
                      <div>
                        <Label htmlFor={`${prefix}-delivery-date`}>
                          ডেলিভারির সম্ভাব্য তারিখ (ঐচ্ছিক)
                        </Label>
                        <Input
                          id={`${prefix}-delivery-date`}
                          type="date"
                          value={d.deliveryDate}
                          onChange={setDevice(d.key, "deliveryDate")}
                          data-testid={`device-delivery-${d.key}`}
                          className="h-9 xl:h-8"
                        />
                        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                          ডিফল্ট এন্ট্রির দিন — চাইলে এই ডিভাইসের জন্য অন্য দিন
                          বেছে নিন।
                        </p>
                      </div>
                      <div>
                        <Label htmlFor={`${prefix}-imei`}>IMEI Number</Label>
                        <Input
                          id={`${prefix}-imei`}
                          data-testid={`device-imei-${d.key}`}
                          value={d.imei}
                          onChange={setDevice(d.key, "imei")}
                          placeholder="Enter IMEI number (optional)"
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={32}
                          className="h-9 xl:h-8"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="space-y-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="add-device"
                  onClick={addDevice}
                  disabled={devices.length >= 8}
                  className="h-9 w-full border-dashed border-maher-border bg-card text-maher-navy hover:bg-maher-surface disabled:opacity-60"
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  {devices.length >= 8
                    ? "সর্বোচ্চ ৮টি ডিভাইস"
                    : "আরেকটি ডিভাইস যোগ করুন"}
                </Button>
                <p className="px-1 text-xs leading-snug text-muted-foreground">
                  নাম, ফোন ও টেকনিশিয়ান সব ডিভাইসের জন্য একই। প্রতিটি ডিভাইসের
                  ডেলিভারি তারিখ আলাদা দিতে পারবেন — ডিফল্ট এন্ট্রির দিন।
                </p>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-maher-border bg-maher-surface/50 p-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="svc-total-bill">মোট বিল (৳)</Label>
                  <Input
                    id="svc-total-bill"
                    value={visitBillText}
                    onChange={(e) => setVisitTotalBill(e.target.value)}
                    placeholder="0"
                    inputMode="numeric"
                    readOnly={hasDeviceBills}
                    className="h-9 xl:h-8 read-only:bg-white read-only:font-semibold"
                  />
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {hasDeviceBills
                      ? "ডিভাইসগুলোর বিলের যোগফল"
                      : "ডিভাইসে বিল না দিলে এখানে লিখুন"}
                  </p>
                </div>
                <div>
                  <Label htmlFor="svc-adv">জমা (৳)</Label>
                  <Input
                    id="svc-adv"
                    value={f.advance}
                    onChange={set("advance")}
                    placeholder="0"
                    inputMode="numeric"
                    className="h-9 xl:h-8"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="svc-due">বাকি (৳)</Label>
                  <Input
                    id="svc-due"
                    value={formatTaka(visitDue).replace("৳", "").trim()}
                    readOnly
                    className="h-9 bg-white font-semibold xl:h-8"
                  />
                </div>
                <div>{statusField}</div>
              </div>
            </div>
          </>
        )}

        <div className="space-y-1.5 rounded-lg border border-maher-money/30 bg-maher-money/10 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="svc-expense" className="flex items-center gap-1.5 text-maher-money">
                <KeyRound className="h-3.5 w-3.5 text-maher-money" />
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
                    ? "border-maher-due focus-visible:ring-maher-due"
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
                  <span className="font-medium text-maher-done">
                    গোপন কোড: {normalizedExpense.stored} ➔{" "}
                    {formatTakaBn(normalizedExpense.amount)}
                  </span>
                ) : normalizedExpense.kind === "number" &&
                  normalizedExpense.amount !== null ? (
                  <span className="font-medium text-maher-done">
                    সেভ করলে কোড হবে: {normalizedExpense.stored} ➔{" "}
                    {formatTakaBn(normalizedExpense.amount)}
                  </span>
                ) : normalizedExpense.kind === "invalid" ? (
                  <span className="font-medium text-maher-due">
                    {normalizedExpense.error}
                  </span>
                ) : (
                  <span className="text-maher-money/80">
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
          <p className="flex items-start gap-1.5 text-xs leading-snug text-maher-money/80">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              এই খরচ ও দোকানের নাম শুধু দোকানের হিসাবের জন্য — কাস্টমার
              রিসিট/PDF-এ যাবে না।
            </span>
          </p>
        </div>

        {editing || isProductSale ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {deliveryDateField}
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
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-2.5 -mb-2.5 border-t border-maher-border bg-card/95 px-2.5 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          {editing ? (
            <div className="flex gap-2">
              <Button type="submit" className="flex-1 bg-maher-navy hover:bg-maher-navy-light" disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "আপডেট করুন"}
              </Button>
              <Button type="button" variant="outline" onClick={onCancelEdit}>
                বাতিল
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              className="w-full bg-maher-navy text-base hover:bg-maher-navy-light"
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
