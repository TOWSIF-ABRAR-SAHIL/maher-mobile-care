"use client";

import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  ChevronDown,
  Loader2,
  Lock,
  Package,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ProductPickerDialog } from "@/components/ProductPickerDialog";
import {
  PartsEditor,
  normalizePartDrafts,
  partDraftsFromDTO,
  partsPayloadFromDrafts,
  type PartDraft,
} from "@/components/PartsEditor";
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
  cn,
  computeDue,
  formatTaka,
  parseBnNumber,
  toBnDigits,
} from "@/lib/utils";
import { decodeShopExpense } from "@/lib/expense-code";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { dhakaDateKey, shiftDateKey } from "@/lib/dhaka";
import {
  MAX_CONDITION_LENGTH,
  OVERPAY_MESSAGE,
  parseServiceAmount,
  validateServicePayload,
} from "@/lib/service-validation";
import { CONDITION_PRESETS } from "@/lib/condition-presets";
import type {
  ProductCategoryDTO,
  ProductDTO,
  SaleItemDTO,
  ServiceDTO,
} from "@/lib/types";

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
  condition: "",
  deliveryDate: "",
  serviceDate: "",
  imei: "",
  customerAddress: "",
  warranty: "",
};

/** Shared focus treatment for every editable field in the POS form. */
const FIELD_FOCUS =
  "focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10";

/**
 * Premium, Stripe-grade field treatment shared by every editable control in
 * the POS form: a deliberate slate-300 edge, an inset hairline plus a soft
 * outer lift at rest, a darker boundary on hover, and a slate-900 focus ring.
 * The `xl` height override keeps the shop's counter PC compact so the whole
 * desk still fits at 1920x1080.
 */
const PREMIUM_FIELD =
  "h-10 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-slate-900 focus:ring-[3px] focus:ring-slate-900/10 focus:outline-none focus-visible:border-slate-900 focus-visible:ring-[3px] focus-visible:ring-slate-900/10 xl:h-8";

/** Sharp, dark field labels that read clearly above the input surface. */
const PREMIUM_LABEL =
  "mb-1.5 flex items-center justify-between text-xs font-semibold tracking-tight text-slate-800 2xl:mb-1";

/** Label wrapper so every field inherits the same typography at once. */
function FieldLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return <Label className={cn(PREMIUM_LABEL, className)} {...props} />;
}

/**
 * One-tap warranty terms. Labels use Bengali digits; `value` stays in the
 * existing ASCII form so saved rows, receipts and API payloads are unchanged.
 */
const WARRANTY_CHIPS = [
  { label: "নেই", value: "" },
  { label: "৭ দিন", value: "7 দিন" },
  { label: "১৫ দিন", value: "15 দিন" },
  { label: "১ মাস", value: "1 মাস" },
  { label: "৩ মাস", value: "3 মাস" },
  { label: "৬ মাস", value: "6 মাস" },
] as const;

/** One device in a shared-customer visit. Money/status live on the visit. */
interface VisitDevice {
  key: number;
  model: string;
  problem: string;
  totalBill: string;
  /** Expected handover day for THIS device; blank until the shop chooses. */
  deliveryDate: string;
  /** Optional handset IMEI (persisted as text on this device row). */
  imei: string;
  /** Optional warranty term for THIS device, printed on the customer slip. */
  warranty: string;
  /** Optional itemized parts bought for THIS device (replaces দোকান খরচ). */
  parts: PartDraft[];
}

function blankDevice(key: number): VisitDevice {
  return {
    key,
    model: "",
    problem: "",
    totalBill: "",
    deliveryDate: "",
    imei: "",
    warranty: "",
    parts: [],
  };
}

/** Optional delivery day with one-tap choices. Blank means "not promised". */
function DeliveryDateField({
  id,
  testId,
  value,
  onChange,
  deliveredAt,
  fieldKey,
  errors = {},
}: {
  id: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  deliveredAt?: string | Date | null;
  fieldKey?: string;
  errors?: Record<string, string>;
}) {
  const today = dhakaDateKey(new Date());
  const choices = [
    { label: "আজ", date: today },
    { label: "কাল", date: shiftDateKey(today, 1) },
    { label: "৩ দিন", date: shiftDateKey(today, 3) },
    { label: "৭ দিন", date: shiftDateKey(today, 7) },
  ];
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>ডেলিভারি তারিখ</FieldLabel>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="ডেলিভারি তারিখ মুছুন"
            className="rounded px-1 text-sm leading-none text-muted-foreground transition-colors hover:bg-maher-surface hover:text-maher-navy focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-maher-blue"
          >
            ×
          </button>
        ) : null}
      </div>
      <Input
        id={id}
        data-testid={testId}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={PREMIUM_FIELD}
        {...(fieldKey ? fieldA11y(fieldKey, errors) : {})}
      />
      {fieldKey ? <FieldError fieldKey={fieldKey} errors={errors} /> : null}
      {/* Four equal cells on ONE row — every Bengali label stays complete,
          with no clipped shortcuts and no extra form height. */}
      <div className="mt-1 flex gap-1">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            aria-pressed={value === choice.date}
            onClick={() => onChange(choice.date)}
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100/90 px-2 text-[11px] font-medium leading-none text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-slate-900/10 sm:text-xs",
              value === choice.date
                ? "bg-slate-900 font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                : "hover:bg-slate-200/80 hover:text-slate-900"
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {deliveredAt ? (
        <p className="mt-1 text-xs text-maher-done">
          ✅ ডেলিভারি সম্পন্ন: {dhakaDateKey(deliveredAt)}
        </p>
      ) : null}
    </div>
  );
}

/** Optional warranty term with one-tap chips; custom text is still allowed. */
function WarrantyField({
  id,
  testId,
  value,
  onChange,
  fieldKey,
  chipTestIdPrefix,
  errors = {},
}: {
  id: string;
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  fieldKey?: string;
  chipTestIdPrefix: string;
  errors?: Record<string, string>;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>ওয়ারেন্টির মেয়াদ</FieldLabel>
      {/* On the 1920px desk the chips sit beside the input so this optional
          field adds no extra row; narrower widths keep the stacked layout. */}
      <div className="2xl:flex 2xl:items-center 2xl:gap-2">
        <Input
          id={id}
          data-testid={testId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder=""
          maxLength={100}
          className={cn(PREMIUM_FIELD, "2xl:w-20 2xl:shrink-0")}
          {...(fieldKey ? fieldA11y(fieldKey, errors) : {})}
        />
        {/* A uniform grid keeps ৬ মাস in an even row — it never isolates on
            an uneven last line. Six columns on wide desks, three when tight. */}
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6 2xl:mt-0 2xl:grid-cols-3">
          {WARRANTY_CHIPS.map((chip, index) => {
            const chipValue = chip.value;
            return (
              <button
                key={chip.label}
                type="button"
                data-testid={`${chipTestIdPrefix}-${index}`}
                aria-pressed={value === chipValue}
                onClick={() => onChange(chipValue)}
                className={cn(
                  "inline-flex h-7 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-slate-200 bg-slate-100/90 px-2 text-[11px] font-medium leading-none text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.05)] outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-slate-900/10 sm:text-xs",
                  value === chipValue
                    ? "bg-slate-900 font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
                    : "hover:bg-slate-200/80 hover:text-slate-900"
                )}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>
      {fieldKey ? <FieldError fieldKey={fieldKey} errors={errors} /> : null}
    </div>
  );
}

/** Inline error shown directly under its own input and announced by screen readers. */
function FieldError({
  fieldKey,
  errors,
}: {
  fieldKey: string;
  errors: Record<string, string>;
}) {
  const message = errors[fieldKey];
  if (!message) return null;
  return (
    <p
      id={`err-${fieldKey}`}
      role="alert"
      className="mt-0.5 text-[11px] leading-snug text-maher-due"
    >
      {message}
    </p>
  );
}

/** Spread onto a control so its invalid state and message are associated. */
function fieldA11y(fieldKey: string, errors: Record<string, string>) {
  const message = errors[fieldKey];
  return {
    "data-field": fieldKey,
    "aria-invalid": message ? (true as const) : undefined,
    "aria-describedby": message ? `err-${fieldKey}` : undefined,
  };
}

const looksLikeDateKey = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value.trim());

/** One product line inside the visit. Money is the customer's selling price. */
interface ProductLineDraft {
  key: number;
  /** Existing SaleItem id — only set while editing a saved visit. */
  id?: number;
  productId: number;
  name: string;
  sku: string | null;
  quantity: string;
  unitPrice: string;
  /** The product's shelf price; a different value needs a reason note. */
  basePrice: number;
  priceNote: string;
  /** Largest quantity the shelf can cover (existing line keeps its own qty). */
  maxQty: number;
}

const DRAFT_KEY = "maher:new-entry-draft";
// Separate from the navigation-only session draft above: this one survives a
// power cut and is only consumed through the explicit recovery banner.
const CRASH_DRAFT_KEY = "maher_service_entry_draft_v1";
const CRASH_DRAFT_DEBOUNCE_MS = 400;
type EntryMode = "device" | "product";
interface EntryDraft {
  f: typeof empty;
  devices: VisitDevice[];
  products: ProductLineDraft[];
  mode: EntryMode;
  visitTotalBill: string;
  extrasOpen: boolean;
  internalOpen: boolean;
}
function normalizeLineDrafts(raw: unknown): ProductLineDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (line): line is ProductLineDraft =>
        !!line && typeof line === "object" && Number(line.productId) > 0
    )
    .map((line, index) => ({
      key: Number(line.key) || index,
      ...(Number(line.id) > 0 ? { id: Number(line.id) } : {}),
      productId: Number(line.productId),
      name: String(line.name ?? ""),
      sku: line.sku == null ? null : String(line.sku),
      quantity: String(line.quantity ?? "1"),
      unitPrice: String(line.unitPrice ?? ""),
      basePrice: Number(line.basePrice) || 0,
      priceNote: String(line.priceNote ?? ""),
      maxQty: Math.max(1, Number(line.maxQty) || 1),
    }));
}
function readDraft(): EntryDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      f: { ...empty, ...(parsed.f || {}) },
      devices:
        Array.isArray(parsed.devices) && parsed.devices.length > 0
          ? parsed.devices.map((device: Partial<VisitDevice>, index: number) => ({
              ...blankDevice(Number(device.key) || index),
              ...device,
              parts: normalizePartDrafts(device.parts),
            }))
          : [blankDevice(0)],
      products: normalizeLineDrafts(parsed.products),
      mode: parsed.mode === "product" ? "product" : "device",
      visitTotalBill: String(parsed.visitTotalBill ?? ""),
      extrasOpen: Boolean(parsed.extrasOpen),
      internalOpen: Boolean(parsed.internalOpen),
    };
  } catch {
    return null;
  }
}
function writeDraft(draft: EntryDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}
function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}

/** Read the power-cut draft without ever silently applying it. */
function readCrashDraft(): EntryDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CRASH_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      f: { ...empty, ...(parsed.f || {}) },
      devices:
        Array.isArray(parsed.devices) && parsed.devices.length > 0
          ? parsed.devices.map((device: Partial<VisitDevice>, index: number) => ({
              ...blankDevice(Number(device.key) || index),
              ...device,
              parts: normalizePartDrafts(device.parts),
            }))
          : [blankDevice(0)],
      products: normalizeLineDrafts(parsed.products),
      mode: parsed.mode === "product" ? "product" : "device",
      visitTotalBill: String(parsed.visitTotalBill ?? ""),
      extrasOpen: Boolean(parsed.extrasOpen),
      internalOpen: Boolean(parsed.internalOpen),
    };
  } catch {
    return null;
  }
}

const hasDraftText = (value: unknown) => String(value ?? "").trim().length > 0;

/** Never banner a pristine form — the roster's default technician is not input. */
function crashDraftIsDirty(draft: EntryDraft): boolean {
  const f = draft.f;
  return (
    [
      f.customerName,
      f.phone,
      f.customerAddress,
      f.problem,
      f.totalBill,
      f.advance,
      f.shopExpense,
      f.partsShop,
      f.condition,
      f.deliveryDate,
      f.imei,
      f.warranty,
      draft.visitTotalBill,
    ].some(hasDraftText) ||
    draft.devices.some(
      (device) =>
        device.key !== 0 ||
        [
          device.model,
          device.problem,
          device.totalBill,
          device.deliveryDate,
          device.imei,
          device.warranty,
        ].some(hasDraftText) ||
        device.parts.length > 0
    ) ||
    draft.products.length > 0
  );
}

function writeCrashDraft(draft: EntryDraft) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CRASH_DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function clearCrashDraft() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CRASH_DRAFT_KEY);
  } catch {}
}

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
    condition: s.condition ?? "",
    deliveryDate: s.deliveryDate ? dhakaDateKey(s.deliveryDate) : "",
    serviceDate: dhakaDateKey(s.serviceDate),
    imei: s.imei ?? "",
    customerAddress: s.customerAddress ?? "",
    warranty: s.warranty ?? "",
  };
}

export function ServiceForm({
  initial,
  initialProducts = [],
  initialAnchorId = null,
  serviceDate,
  technicians,
  partsShops = [],
  onAddPartShop,
  initialProductMode = false,
  onSaved,
  onCancelEdit,
}: {
  /** Service being edited, or null for a new entry. */
  initial: ServiceDTO | null;
  /** Active product lines of the edited visit (empty for a plain job). */
  initialProducts?: SaleItemDTO[];
  /** The visit's product anchor row, when it has product lines. */
  initialAnchorId?: number | null;
  /** Selected day (YYYY-MM-DD) — new entries are booked on this day. */
  serviceDate: string;
  /** Active roster from /api/technicians. */
  technicians: string[];
  /** Previously used parts-buying shops (datalist suggestions). */
  partsShops?: string[];
  /** Persist a shop typed in a new entry to the shared shop list. */
  onAddPartShop?: (name: string) => void;
  /** Deep link `/service?mode=product` opens the product-sale variant. */
  initialProductMode?: boolean;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const editingProduct = initial?.entryKind === "PRODUCT";
  const { cipher } = useShopSettings();

  const [f, setF] = useState(() => {
    const base = initial ? toForm(initial) : empty;
    // A product-only deep link starts delivered at the counter.
    if (!initial && initialProductMode) {
      return { ...base, status: "Delivered" };
    }
    return base;
  });
  const [entryMode, setEntryMode] = useState<EntryMode>(() => {
    if (editingProduct) return "product";
    if (!initial && initialProductMode) return "product";
    return "device";
  });
  const [saving, setSaving] = useState(false);
  // Power-cut recovery is explicit: a saved draft shows a banner and waits for
  // the shopkeeper, instead of silently replacing the form they just opened.
  const [recoveryDraft, setRecoveryDraft] = useState<EntryDraft | null>(null);
  const crashDraftTimer = useRef<number | null>(null);
  // A ref, not the `saving` state: three clicks inside one tick all see
  // saving===false because React has not re-rendered yet, which created three
  // duplicate entries. The ref flips synchronously.
  const savingRef = useRef(false);
  const editing = initial !== null;
  const deviceSeq = useRef(1);
  const productSeq = useRef(1);
  const [visitTotalBill, setVisitTotalBillState] = useState("");
  const isReturnedRow = editing && initial?.status === "Returned";
  // Optional per-device fields and the shop-only cost live in collapsible
  // sections so the everyday entry form stays short. They stay mounted.
  // The device section is the primary entry area, so it starts open on a new
  // visit. Each device card now holds the device's FULL information (model,
  // problem, bill, delivery date, IMEI, parts) and "আরেকটি ডিভাইস যোগ করুন"
  // sits after the last card — not hidden away above the extra fields.
  // The device card is the primary surface in both entry and Edit, so it is
  // open from the first render in either mode.
  const [extrasOpen, setExtrasOpen] = useState(() => true);
  const [internalOpen, setInternalOpen] = useState(
    () =>
      editing &&
      !!(initial?.shopExpense || initial?.partsShop || initial?.parts?.length)
  );
  // Customer terms are optional and only matter for some jobs, so they live in
  // their own collapsed section: the desk must still show bill + due above the
  // sticky save bar on a 585px-tall laptop screen.
  const [conditionOpen, setConditionOpen] = useState(
    () => editing && !!initial?.condition
  );
  // The first device is always present; extras are added one at a time. Each
  // device carries its own optional delivery day, blank until chosen.
  const [devices, setDevices] = useState<VisitDevice[]>(() => [
    blankDevice(0),
  ]);
  // Device cards collapse independently. Keys are the stable device keys, so
  // adding a later device never re-opens or discards the earlier cards' state.
  const [expandedDevices, setExpandedDevices] = useState<Record<string, boolean>>({});
  const isDeviceExpanded = (key: number) => expandedDevices[String(key)] !== false;
  // Field-keyed inline errors, the field to focus, and a signal that makes a
  // collapsed PartsEditor open when its own validation fails.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [partsSignal, setPartsSignal] = useState(0);
  // Editing a saved row: its itemized parts load once and merge back by id.
  const [editParts, setEditParts] = useState<PartDraft[]>(() =>
    partDraftsFromDTO(initial?.parts)
  );
  // New part lines default to today's Dhaka date — never the service date.
  const partToday = dhakaDateKey(new Date());
  // Shop names typed into part rows but not yet in the shared list. Plain data
  // (no helper component) so the quick-add stays inside this LOW-risk symbol.
  const knownShopKeys = new Set(
    partsShops.map((shop) => shop.toLocaleLowerCase())
  );
  const newShopNames = [
    ...new Map(
      [
        ...devices.flatMap((d) => d.parts.map((p) => p.supplier.trim())),
        ...editParts.map((p) => p.supplier.trim()),
      ]
        .filter((name) => name && !knownShopKeys.has(name.toLocaleLowerCase()))
        .map((name) => [name.toLocaleLowerCase(), name] as const)
    ).values(),
  ];
  const [products, setProducts] = useState<ProductDTO[]>([]);
  const [categories, setCategories] = useState<ProductCategoryDTO[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productLines, setProductLines] = useState<ProductLineDraft[]>(() =>
    initialProducts
      .filter((line) => !line.returnedAt && line.productId)
      .map((line, index) => ({
        key: index,
        id: line.id,
        productId: line.productId as number,
        name: line.name,
        sku: line.sku ?? null,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
        basePrice: line.unitPrice,
        priceNote: line.priceNote ?? "",
        // Without the catalog yet we can at least keep the current quantity.
        maxQty: Math.max(1, line.quantity),
      }))
  );
  // One submit retried after a network hiccup must resolve to the same visit
  // instead of selling the goods twice. The key is minted once per form.
  const saleRef = useRef<string>("");
  if (!saleRef.current) {
    saleRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  const clearErrors = () => {
    setFieldErrors((prev) => (Object.keys(prev).length ? {} : prev));
  };

  /** Editing the visit total clears a stale bill/advance error immediately. */
  const setVisitTotalBill = (value: string) => {
    clearErrors();
    setVisitTotalBillState(value);
  };

  const addDevice = () => {
    if (devices.length >= 8) return;
    const key = deviceSeq.current;
    deviceSeq.current += 1;
    // A fresh card opens immediately; the existing cards keep their own state,
    // so no already-typed device is collapsed or cleared by this click.
    setExpandedDevices((prev) => ({ ...prev, [String(key)]: true }));
    setDevices((prev) =>
      prev.length >= 8 ? prev : [...prev, blankDevice(key)]
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
  ) => {
    clearErrors();
    setDevices((prev) =>
      prev.map((d) => (d.key === key ? { ...d, ...patch } : d))
    );
  };
  const setDevice =
    (
      key: number,
      field:
        | "model"
        | "problem"
        | "totalBill"
        | "deliveryDate"
        | "imei"
        | "warranty"
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
    return options;
  }, [technicians, initial?.technician]);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/products");
        if (!response.ok) return;
        const data = await response.json();
        if (cancelled) return;
        setProducts(Array.isArray(data.products) ? data.products : []);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
      } catch {
        // product picker is optional; keep the form usable offline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the catalog arrives, refresh the draft lines' shelf price and the
  // largest quantity the stock can cover. An existing line already deducted
  // its own units, so those come back into the available pool.
  useEffect(() => {
    if (products.length === 0) return;
    setProductLines((prev) =>
      prev.map((line) => {
        const product = products.find((p) => p.id === line.productId);
        if (!product) return line;
        const own = line.id ? Math.max(0, Number(line.quantity) || 0) : 0;
        return {
          ...line,
          name: product.name,
          sku: product.sku,
          basePrice: product.sellingPrice,
          maxQty: Math.max(1, product.stock + own),
        };
      })
    );
  }, [products]);

  /* ------------------------------------------------------------------ */
  /* Product-line editing                                                */
  /* ------------------------------------------------------------------ */

  const lineNumber = (value: string) =>
    Math.max(0, Math.floor(parseBnNumber(value) ?? 0));

  const addProduct = (product: ProductDTO) => {
    setProductLines((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id
            ? {
                ...line,
                quantity: String(
                  Math.min(line.maxQty, Math.max(1, lineNumber(line.quantity)) + 1)
                ),
              }
            : line
        );
      }
      const key = productSeq.current;
      productSeq.current += 1;
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: product.name,
          sku: product.sku,
          quantity: "1",
          unitPrice: String(product.sellingPrice),
          basePrice: product.sellingPrice,
          priceNote: "",
          maxQty: Math.max(1, product.stock),
        },
      ];
    });
  };

  const patchLine = (key: number, patch: Partial<ProductLineDraft>) => {
    clearErrors();
    setProductLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  };

  const removeLine = (key: number) =>
    setProductLines((prev) => prev.filter((line) => line.key !== key));

  const productTotal = productLines.reduce((sum, line) => {
    const qty = lineNumber(line.quantity);
    const price = lineNumber(line.unitPrice);
    return sum + qty * price;
  }, 0);

  const productLineError = (): { fieldKey: string; message: string } | null => {
    for (const line of productLines) {
      const qty = lineNumber(line.quantity);
      const price = lineNumber(line.unitPrice);
      if (qty < 1) {
        return { fieldKey: `product:${line.key}:qty`, message: `"${line.name}" এর পরিমাণ অন্তত ১ দিন` };
      }
      if (qty > line.maxQty) {
        return {
          fieldKey: `product:${line.key}:qty`,
          message: `"${line.name}" এর স্টক যথেষ্ট নয় (সর্বোচ্চ ${line.maxQty}টি)`,
        };
      }
      if (price !== line.basePrice && !line.priceNote.trim()) {
        return {
          fieldKey: `product:${line.key}:note`,
          message: `"${line.name}" এর দাম বদলানোর কারণ লিখুন`,
        };
      }
    }
    return null;
  };

  const productPayload = () =>
    productLines.map((line) => ({
      ...(line.id ? { id: line.id } : {}),
      productId: line.productId,
      name: line.name,
      quantity: lineNumber(line.quantity),
      unitPrice: lineNumber(line.unitPrice),
      discount: 0,
      priceNote: line.priceNote.trim() || null,
    }));

  const deviceCountRef = useRef(devices.length);
  useEffect(() => {
    if (devices.length > deviceCountRef.current) setExtrasOpen(true);
    deviceCountRef.current = devices.length;
  }, [devices.length]);

  /** Map a shared validation message to its control when no context is given. */
  const locateErrorField = (message: string): string => {
    if (/কাস্টমারের নাম/.test(message)) return "customerName";
    if (/মোবাইল নম্বর/.test(message)) return "phone";
    if (/টেকনিশিয়ান/.test(message)) return "technician";
    if (/মডেল|প্রোডাক্টের নাম/.test(message)) return "model";
    if (/সমস্যা|বিবরণ/.test(message)) return "problem";
    if (/অবস্থা/.test(message)) return "status";
    if (/মোট বিল/.test(message)) return "bill";
    if (/জমা|বিলের বেশি/.test(message)) return "advance";
    if (/ডেলিভারি/.test(message)) return "delivery";
    if (/IMEI/.test(message)) return "imei";
    if (/ঠিকানা/.test(message)) return "customerAddress";
    if (/ওয়ারেন্টি/.test(message)) return "warranty";
    if (/শর্ত/.test(message)) return "condition";
    if (/পার্টস/.test(message)) return "parts";
    return "form";
  };

  /**
   * Put one validation message under the control that owns it, reveal the
   * device/section that contains it, and move focus there. The server rule set
   * is untouched — this only decides where its message is displayed.
   */
  const raiseError = (
    message: string,
    options: {
      fieldKey?: string;
      deviceKey?: number | null;
      partKey?: number | null;
      partField?: string;
    } = {}
  ) => {
    let fieldKey = options.fieldKey;
    let deviceKey = options.deviceKey;
    let partField = options.partField;
    if (!fieldKey && partField) {
      fieldKey = `part:${deviceKey ?? "edit"}:${options.partKey ?? 0}:${partField}`;
    }
    if (!fieldKey) fieldKey = locateErrorField(message);
    // Encoded part keys carry their device and field (e.g. part:3:1:price), so
    // a rejected part can reveal the right card without extra plumbing.
    const partMatch = fieldKey.match(/^part:([^:]+):\d+:(\w+)$/);
    if (partMatch) {
      if (deviceKey == null && partMatch[1] !== "edit") deviceKey = Number(partMatch[1]);
      partField = partField ?? partMatch[2];
    }
    setFieldErrors({ [fieldKey]: message });
    if (deviceKey != null) {
      setExtrasOpen(true);
      setExpandedDevices((prev) => ({ ...prev, [String(deviceKey)]: true }));
    }
    if (partField) {
      setPartsSignal((value) => value + 1);
      if (editing) setInternalOpen(true);
    }
    setFocusKey(fieldKey);
  };

  /** The first draft row whose named field would fail the shared rule. */
  const findPartField = (
    drafts: PartDraft[],
    field: "name" | "qty" | "price" | "supplier" | "date"
  ): number | null => {
    const index = drafts.findIndex((draft) => {
      if (field === "name") return !draft.name.trim();
      if (field === "qty") {
        const qty = parseBnNumber(draft.quantity);
        return qty === null || qty < 1 || qty > 999;
      }
      if (field === "price") {
        const decoded = decodeShopExpense(draft.price, cipher);
        return (
          decoded.kind === "empty" ||
          decoded.kind === "invalid" ||
          decoded.amount === null ||
          decoded.amount > 1_000_000
        );
      }
      if (field === "supplier") return !draft.supplier.trim();
      return !looksLikeDateKey(draft.purchaseDate);
    });
    return index === -1 ? (drafts[0]?.key ?? null) : drafts[index].key;
  };

  const set = (key: keyof typeof empty) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    clearErrors();
    setF((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const billNum = parseBnNumber(f.totalBill) ?? 0;
  const advNum = parseBnNumber(f.advance) ?? 0;
  const due = computeDue(billNum, advNum);

  // New service entry: device bills add up to the visit bill. If no device
  // bill is filled, the visit total is entered once and lands on device 1.
  const hasDeviceBills = devices.some((d) => d.totalBill.trim() !== "");
  const deviceBillsTotal = devices.reduce(
    (sum, d) => sum + (parseBnNumber(d.totalBill) ?? 0),
    0
  );
  // Editing one saved row: the device card's bill is the single source of
  // truth, so the visit summary mirrors it (never a second, stale copy).
  const visitBillText =
    editing && !editingProduct
      ? f.totalBill
      : hasDeviceBills
        ? String(deviceBillsTotal)
        : visitTotalBill;
  // Product-only visits already show their product total in this same block;
  // adding it again would double the bill. Device visits still add attached
  // product lines to the device bills exactly as the batch submit does.
  const visitBillNum =
    entryMode === "product"
      ? productTotal
      : (parseBnNumber(visitBillText) ?? 0) + productTotal;
  const visitAdvanceNum = parseBnNumber(f.advance) ?? 0;
  const visitDue = computeDue(visitBillNum, visitAdvanceNum);

  // Restore a half-typed new-entry draft after hydration. Doing this in a mount
  // effect (instead of in useState initializers) avoids server/client markup
  // mismatches (React error #418) while still recovering the user's input.
  useEffect(() => {
    if (initial) return;
    const d = readDraft();
    if (!d) return;
    setF(d.f);
    setEntryMode(d.mode);
    setDevices(d.devices);
    setVisitTotalBillState(d.visitTotalBill);
    setExtrasOpen(d.extrasOpen);
    setInternalOpen(d.internalOpen);
    setProductLines(d.products);
    if (d.products.length > 0) {
      productSeq.current = Math.max(...d.products.map((x) => x.key)) + 1;
    }
    deviceSeq.current = d.devices.length
      ? Math.max(...d.devices.map((x) => x.key)) + 1
      : 1;
  }, [initial]);

  // Persist new-entry draft across navigation/remounts so a half-typed visit
  // is never lost when the user clicks another button or page.
  useEffect(() => {
    if (initial) return;
    writeDraft({
      f,
      devices,
      products: productLines,
      mode: entryMode,
      visitTotalBill,
      extrasOpen,
      internalOpen,
    });
  }, [
    initial,
    f,
    devices,
    productLines,
    entryMode,
    visitTotalBill,
    extrasOpen,
    internalOpen,
  ]);

  // Detect a draft left by a sudden shutdown. Detection is deliberately
  // separate from applying it: the banner below is the only way back in.
  useEffect(() => {
    if (initial) return;
    const draft = readCrashDraft();
    if (draft && crashDraftIsDirty(draft)) setRecoveryDraft(draft);
  }, [initial]);

  // Debounced localStorage persistence for genuinely typed new entries. An
  // untouched form (including the roster's auto-filled technician) writes
  // nothing, so an idle visit never produces a phantom recovery banner.
  useEffect(() => {
    if (initial) return;
    const snapshot: EntryDraft = {
      f,
      devices,
      products: productLines,
      mode: entryMode,
      visitTotalBill,
      extrasOpen,
      internalOpen,
    };
    if (crashDraftTimer.current !== null) {
      window.clearTimeout(crashDraftTimer.current);
    }
    crashDraftTimer.current = window.setTimeout(() => {
      crashDraftTimer.current = null;
      if (crashDraftIsDirty(snapshot)) writeCrashDraft(snapshot);
      else clearCrashDraft();
    }, CRASH_DRAFT_DEBOUNCE_MS);
    return () => {
      if (crashDraftTimer.current !== null) {
        window.clearTimeout(crashDraftTimer.current);
        crashDraftTimer.current = null;
      }
    };
  }, [
    initial,
    f,
    devices,
    productLines,
    entryMode,
    visitTotalBill,
    extrasOpen,
    internalOpen,
  ]);

  const cancelCrashDraftTimer = () => {
    if (crashDraftTimer.current !== null) {
      window.clearTimeout(crashDraftTimer.current);
      crashDraftTimer.current = null;
    }
  };

  const restoreCrashDraft = () => {
    if (!recoveryDraft) return;
    cancelCrashDraftTimer();
    setF(recoveryDraft.f);
    setEntryMode(recoveryDraft.mode);
    setDevices(recoveryDraft.devices);
    setVisitTotalBillState(recoveryDraft.visitTotalBill);
    setExtrasOpen(recoveryDraft.extrasOpen);
    setInternalOpen(recoveryDraft.internalOpen);
    setProductLines(recoveryDraft.products);
    if (recoveryDraft.products.length > 0) {
      productSeq.current =
        Math.max(...recoveryDraft.products.map((line) => line.key)) + 1;
    }
    deviceSeq.current = recoveryDraft.devices.length
      ? Math.max(...recoveryDraft.devices.map((device) => device.key)) + 1
      : 1;
    setRecoveryDraft(null);
  };

  const discardCrashDraft = () => {
    cancelCrashDraftTimer();
    clearCrashDraft();
    // Also drop the navigation-only draft of the same half-typed visit, so
    // "বাতিল" really leaves a blank form instead of silently restoring it.
    clearDraft();
    setRecoveryDraft(null);
  };

  // Focus only once the target is actually rendered — expanding a device card
  // or a parts section happens in the same React batch as the error itself.
  useEffect(() => {
    if (!focusKey) return;
    const target = document.querySelector<HTMLElement>(`[data-field="${focusKey}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    setFocusKey(null);
  }, [focusKey, fieldErrors, expandedDevices, extrasOpen, internalOpen, partsSignal]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Three clicks inside one tick all see saving===false (React has not
    // re-rendered), so the ref must flip synchronously before any await —
    // otherwise one visit becomes three duplicate rows.
    if (savingRef.current) return;
    let payload: ReturnType<typeof validateServicePayload> | null = null;
    const extraPayloads: ReturnType<typeof validateServicePayload>[] = [];
    const startingProductOnly = !editing && entryMode === "product";
    try {
      // A product line whose price differs from the shelf price must explain
      // why, and quantity can never exceed what the shelf holds.
      const lineError = productLineError();
      if (lineError) {
        throw Object.assign(new Error(lineError.message), { fieldKey: lineError.fieldKey });
      }
      if (startingProductOnly && productLines.length === 0) {
        throw Object.assign(new Error("অন্তত একটি প্রোডাক্ট যোগ করুন"), {
          fieldKey: "product",
        });
      }
      if (!editing || editingProduct) {
        if (!f.customerName.trim()) {
          throw Object.assign(new Error("কাস্টমারের নাম দিন"), { fieldKey: "customerName" });
        }
        if (!f.phone.trim()) {
          throw Object.assign(new Error("মোবাইল নম্বর দিন"), { fieldKey: "phone" });
        }
      }

      if (!editing && !startingProductOnly) {
        // New service entry: every numbered device card is one row. A blank
        // extra card is ignored; the first card is always validated.
        const entryDevices = devices.filter(
          (d, index) =>
            index === 0 ||
            [d.model, d.problem, d.totalBill, d.imei, d.warranty].some((v) =>
              v.trim()
            ) ||
            d.parts.some(
              (part) =>
                part.name.trim() || part.price.trim() || part.supplier.trim()
            )
        );
        const bills = entryDevices.map((d, index) =>
          parseEntryAmount(
            hasDeviceBills ? d.totalBill : index === 0 ? visitTotalBill : "",
            "মোট বিল"
          )
        );
        const visitBill =
          bills.reduce((sum, amount) => sum + amount, 0) + productTotal;
        const visitAdvance = parseEntryAmount(f.advance, "জমা");
        if (visitAdvance > visitBill) {
          throw Object.assign(new Error(OVERPAY_MESSAGE), { fieldKey: "advance" });
        }
        const advances = allocateAdvance(bills, visitAdvance);
        const validated = entryDevices.map((d, index) => {
          try {
            return validateServicePayload(
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
              // Customer terms belong to the visit; the work-done note is now
              // written from the service list at handover, not in this form.
              condition: f.condition,
              // Each device keeps its own expected handover day.
              deliveryDate: d.deliveryDate,
              // Optional per-device IMEI; a blank one becomes NULL.
              imei: d.imei,
              // Address is shared by the visit; warranty is per device.
              customerAddress: f.customerAddress,
              warranty: d.warranty,
              // Optional itemized parts for this device only.
              parts: partsPayloadFromDrafts(d.parts),
              serviceDate,
              },
              { allowedTechnicians: techOptions, cipher }
            );
          } catch (err) {
            const error = err as Error & { fieldKey?: string };
            const message = error.message;
            const partField = /পার্টস/.test(message)
              ? /নাম/.test(message)
                ? "name"
                : /পরিমাণ/.test(message)
                  ? "qty"
                  : /দাম/.test(message)
                    ? "price"
                    : /দোকান|সাপ্লায়ার/.test(message)
                      ? "supplier"
                      : /তারিখ/.test(message)
                        ? "date"
                        : null
              : null;
            throw Object.assign(error, {
              fieldKey:
                error.fieldKey ??
                (partField
                  ? `part:${d.key}:${findPartField(d.parts, partField as "name" | "qty" | "price" | "supplier" | "date") ?? 0}:${partField}`
                  : locateErrorField(message) === "model"
                    ? `model:${d.key}`
                    : locateErrorField(message) === "problem"
                      ? `problem:${d.key}`
                      : locateErrorField(message) === "bill"
                        ? `bill:${d.key}`
                        : locateErrorField(message) === "delivery"
                          ? `delivery:${d.key}`
                          : locateErrorField(message) === "imei"
                            ? `imei:${d.key}`
                            : locateErrorField(message) === "warranty"
                              ? `warranty:${d.key}`
                              : locateErrorField(message)),
              deviceKey: d.key,
            });
          }
        });
        payload = validated[0];
        extraPayloads.push(...validated.slice(1));
      } else if (editing && !editingProduct) {
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
            // Returned is terminal and accepted only by the refund endpoint,
            // so validate with a neutral flow status; omitted below.
            status: isReturnedRow ? "Pending" : f.status,
            shopExpense: f.shopExpense,
            partsShop: f.partsShop,
            condition: f.condition,
            deliveryDate: f.deliveryDate,
            imei: f.imei,
            customerAddress: f.customerAddress,
            warranty: f.warranty,
            // Returned rows freeze their parts server-side: omit the list so
            // the PUT is accepted and the existing lines stay untouched.
            parts: isReturnedRow
              ? undefined
              : partsPayloadFromDrafts(editParts),
            serviceDate: editing ? f.serviceDate : serviceDate,
          },
          // An inactive technician's own historical job stays editable, so the
          // option list (not the active-only roster) is what we validate against.
          // Existing part lines may omit supplier/date (the merge keeps them).
            {
              allowedTechnicians: techOptions,
              partsRequirePurchaseInfo: false,
              cipher,
            }
          );
        } catch (err) {
          const error = err as Error & { fieldKey?: string };
          const message = error.message;
          const partField = /পার্টস/.test(message)
            ? /নাম/.test(message)
              ? "name"
              : /পরিমাণ/.test(message)
                ? "qty"
                : /দাম/.test(message)
                  ? "price"
                  : /দোকান|সাপ্লায়ার/.test(message)
                    ? "supplier"
                    : /তারিখ/.test(message)
                      ? "date"
                      : null
            : null;
          throw Object.assign(error, {
            fieldKey:
              error.fieldKey ??
              (partField
                ? `part:edit:${findPartField(editParts, partField as "name" | "qty" | "price" | "supplier" | "date") ?? 0}:${partField}`
                : locateErrorField(message)),
          });
        }
      }
    } catch (err) {
      const error = err as Error & {
        fieldKey?: string;
        deviceKey?: number;
      };
      const message = error.message ?? "সঠিক তথ্য দিন";
      // Descriptive customer terms live in their own section — reveal it too.
      if (/শর্ত/.test(message)) setConditionOpen(true);
      raiseError(message, {
        fieldKey: error.fieldKey,
        deviceKey: error.deviceKey,
      });
      return toast.error(message);
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const toDto = (
        p: ReturnType<typeof validateServicePayload>,
        includeMoney: boolean,
        includeParts: boolean
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
        condition: p.condition ?? "",
        // The validated payload already holds this row's own date (per device
        // for a visit, the single form field when editing one row).
        deliveryDate: p.deliveryDate ? dhakaDateKey(p.deliveryDate) : "",
        imei: p.imei ?? "",
        customerAddress: p.customerAddress ?? "",
        warranty: p.warranty ?? "",
        // Itemized parts are per device. Sent back by id so the server merges
        // (and never silently rewrites a legacy unknown-date line).
        ...(includeParts
          ? {
              parts: p.parts.map((part) => ({
                ...(part.id ? { id: part.id } : {}),
                name: part.nameSnapshot,
                quantity: part.quantity,
                price: part.priceCode ?? String(part.unitCost),
                supplier: part.supplier ?? "",
                purchaseDate: part.purchaseDateKey ?? "",
                partStatus: part.partStatus,
              })),
            }
          : {}),
        serviceDate: editing ? p.serviceDateKey : serviceDate,
      });

      const productLinesBody =
        productLines.length > 0 ? productPayload() : undefined;
      let res: Response;
      let data: { error?: string } & Record<string, unknown>;
      if (!editing) {
        // A product-only visit is a real visit: its own বিল নং comes from the
        // product anchor row, and it lands in the same list/receipt flow.
        const deviceDtos = [payload, ...extraPayloads]
          .filter((p): p is ReturnType<typeof validateServicePayload> => !!p)
          .map((p) => toDto(p, true, true));
        if (startingProductOnly || productLinesBody || deviceDtos.length > 1) {
          res = await fetch("/api/services/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerName: f.customerName,
              phone: f.phone,
              customerAddress: f.customerAddress,
              technician: f.technician,
              serviceDate,
              // One visit advance: the server waterfalls it devices-first,
              // then across the product lines.
              visitAdvance: f.advance,
              // Customer terms apply to every row of the visit.
              condition: f.condition,
              devices: startingProductOnly ? [] : deviceDtos,
              ...(productLinesBody
                ? { products: productLinesBody, saleRef: saleRef.current }
                : {}),
            }),
          });
        } else {
          res = await fetch("/api/services", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toDto(payload!, true, true)),
          });
        }
      } else if (editingProduct) {
        res = await fetch(`/api/services/${initial!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: f.customerName,
            phone: f.phone,
            customerAddress: f.customerAddress,
            condition: f.condition,
            products: productLinesBody ?? [],
            anchorId: initial!.id,
          }),
        });
      } else {
        res = await fetch(`/api/services/${initial!.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...toDto(payload!, !isReturnedRow, !isReturnedRow),
            ...(initialAnchorId
              ? {
                  anchorId: initialAnchorId,
                  products: productLinesBody ?? [],
                }
              : {}),
          }),
        });
      }
      data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "সেভ করা যায়নি");
      const deviceCount = (!editing && !startingProductOnly ? extraPayloads.length : 0) + (payload ? 1 : 0);
      toast.success(
        !editing && startingProductOnly
          ? "প্রোডাক্ট বিক্রি সেভ হয়েছে"
          : !editing && deviceCount > 1
            ? `${deviceCount}টি ডিভাইস একসাথে সেভ হয়েছে`
            : editing
              ? "আপডেট হয়েছে"
              : "সেভ হয়েছে"
      );
      // Reset with a valid technician: the roster-change effect below only runs
      // when `techOptions` changes, so a plain `setF(empty)` left the select
      // blank and the NEXT save failed with "সঠিক টেকনিশিয়ান বাছুন".
      if (!editing) {
        // A saved visit is no longer an unsaved draft. Clear both the debounce
        // timer and storage before the reset state triggers another write.
        cancelCrashDraftTimer();
        clearCrashDraft();
        setRecoveryDraft(null);
        const defaultTech =
          technicians.length > 0
            ? technicians[0]
            : FALLBACK_TECHNICIANS[0];
        setF({ ...empty, technician: defaultTech ?? "" });
        setDevices([blankDevice(0)]);
        deviceSeq.current = 1;
        setProductLines([]);
        productSeq.current = 1;
        setEntryMode("device");
        setVisitTotalBill("");
        setExtrasOpen(true);
        setInternalOpen(false);
        saleRef.current =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `sale-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      <FieldLabel>টেকনিশিয়ান</FieldLabel>
      <Select
        value={f.technician}
        onValueChange={(v) => {
          // Belt-and-braces: Radix can emit "" for a controlled value
          // whose item never mounted — never accept a blank.
          if (!v) return;
          clearErrors();
          setF((p) => ({ ...p, technician: v }));
        }}
      >
        <SelectTrigger
          id="svc-tech"
          className={PREMIUM_FIELD}
          {...fieldA11y("technician", fieldErrors)}
        >
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
      <FieldError fieldKey="technician" errors={fieldErrors} />
    </>
  );

  const statusField = (
    <>
      <FieldLabel>{editing ? "অবস্থা বদলান" : "কাজের অবস্থা"}</FieldLabel>
      <Select
        value={f.status}
        disabled={isReturnedRow}
        onValueChange={(v) => {
          if (!v) return;
          clearErrors();
          setF((p) => ({ ...p, status: v }));
        }}
      >
        <SelectTrigger
          id="svc-status"
          disabled={isReturnedRow}
          className={PREMIUM_FIELD}
          {...fieldA11y("status", fieldErrors)}
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
    </>
  );

  const deliveryDateField = (
    <DeliveryDateField
      id="svc-delivery-date"
      value={f.deliveryDate}
      onChange={(value) => {
        clearErrors();
        setF((prev) => ({ ...prev, deliveryDate: value }));
      }}
      deliveredAt={initial?.deliveredAt}
      fieldKey="delivery"
      errors={fieldErrors}
    />
  );

  const showDevices =
    (editing && !editingProduct) || (!editing && entryMode === "device");
  const showProducts = !editing || editingProduct || productLines.length > 0 || !!initialAnchorId;
  // While editing a service row, the row-specific bill/advance fields above are
  // the editable ones. The shared visit summary below is only a preview there,
  // so it must not duplicate an inline error id or steal error focus.
  const summaryMoneyEditing = editing && !editingProduct;
  const sharedBillKey = summaryMoneyEditing ? "visitBill" : "bill";
  const sharedAdvanceKey = summaryMoneyEditing ? "visitAdvance" : "advance";
  const sharedMoneyErrors = summaryMoneyEditing ? {} : fieldErrors;

  const productLinesField = (
    <div
      data-testid="product-lines"
      className="space-y-2 rounded-lg border border-slate-200/90 bg-slate-50/40 p-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Package className="h-4 w-4 text-maher-navy" />
          প্রোডাক্ট
          {productLines.length > 0 ? (
            <span className="rounded-full bg-maher-navy px-1.5 py-0.5 text-[10px] font-bold text-white">
              {productLines.length}
            </span>
          ) : null}
        </p>
        {productLines.length > 0 ? (
          <span className="text-xs font-semibold tabular-nums text-maher-navy">
            মোট {formatTaka(productTotal)}
          </span>
        ) : null}
      </div>
      {productLines.map((line) => {
        const qty = lineNumber(line.quantity);
        const price = lineNumber(line.unitPrice);
        const overridden = price !== line.basePrice;
        const lineId = line.id ?? line.productId;
        return (
          <div
            key={line.key}
            data-testid={`product-line-${lineId}`}
            className="rounded-md border border-maher-border bg-card p-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {line.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {line.sku ? <span className="font-mono">SKU {line.sku}</span> : "প্রোডাক্ট"}
                  <span className="ml-1">• স্টক {line.maxQty}</span>
                </p>
              </div>
              <button
                type="button"
                aria-label={`${line.name} লাইন মুছুন`}
                title="লাইন মুছুন"
                onClick={() => removeLine(line.key)}
                className="rounded p-1 text-muted-foreground transition hover:bg-maher-due/10 hover:text-maher-due"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              <div>
                <FieldLabel htmlFor={`product-line-qty-${lineId}`}>পরিমাণ</FieldLabel>
                <Input
                  id={`product-line-qty-${lineId}`}
                  data-testid={`product-line-qty-${lineId}`}
                  value={line.quantity}
                  onChange={(e) =>
                    patchLine(line.key, { quantity: e.target.value })
                  }
                  inputMode="numeric"
                  className={PREMIUM_FIELD}
                  {...fieldA11y(`product:${line.key}:qty`, fieldErrors)}
                />
                <FieldError fieldKey={`product:${line.key}:qty`} errors={fieldErrors} />
              </div>
              <div>
                <FieldLabel htmlFor={`product-line-price-${lineId}`}>
                  একক দাম (৳)
                </FieldLabel>
                <Input
                  id={`product-line-price-${lineId}`}
                  data-testid={`product-line-price-${lineId}`}
                  value={line.unitPrice}
                  onChange={(e) =>
                    patchLine(line.key, { unitPrice: e.target.value })
                  }
                  inputMode="numeric"
                  className={PREMIUM_FIELD}
                  {...fieldA11y(`product:${line.key}:price`, fieldErrors)}
                />
                <FieldError fieldKey={`product:${line.key}:price`} errors={fieldErrors} />
              </div>
              <div>
                <FieldLabel>লাইনমোট</FieldLabel>
                <div className="flex h-9 items-center rounded-lg border border-slate-200/90 bg-slate-50 px-3.5 text-sm font-semibold tabular-nums text-slate-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)] xl:h-8">
                  {formatTaka(qty * price)}
                </div>
              </div>
            </div>
            {overridden ? (
              <div className="mt-1.5">
                <FieldLabel htmlFor={`product-line-note-${lineId}`}>
                  দাম বদলানোর কারণ (আবশ্যক)
                </FieldLabel>
                <Input
                  id={`product-line-note-${lineId}`}
                  data-testid={`product-line-note-${lineId}`}
                  value={line.priceNote}
                  onChange={(e) =>
                    patchLine(line.key, { priceNote: e.target.value })
                  }
                  maxLength={200}
                  placeholder=""
                  className={PREMIUM_FIELD}
                  {...fieldA11y(`product:${line.key}:note`, fieldErrors)}
                />
                <FieldError fieldKey={`product:${line.key}:note`} errors={fieldErrors} />
              </div>
            ) : null}
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="add-product"
        data-field="product"
        onClick={() => setPickerOpen(true)}
        className="h-9 w-full border-dashed border-maher-border bg-card text-maher-navy hover:bg-maher-surface"
      >
        <Plus className="mr-1.5 h-4 w-4" />
        প্রোডাক্ট যোগ
      </Button>
      {productLines.length === 0 && entryMode === "product" ? (
        <p className="px-1 text-[11px] leading-snug text-muted-foreground">
          এই বিক্রিতে অন্তত একটি প্রোডাক্ট দিন — বিল নং নিজে তৈরি হবে।
        </p>
      ) : null}
    </div>
  );


  return (
    <section className="rounded-xl border border-maher-border bg-card p-2.5 shadow-card sheen print:hidden">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="mr-auto flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
          <Plus className="h-4 w-4 text-maher-navy" />
          নতুন সার্ভিস এন্ট্রি
        </h2>
       </div>
      <form onSubmit={submit} className="space-y-2 2xl:space-y-1">
        {!editing && recoveryDraft ? (
          <div
            data-testid="draft-recovery-banner"
            role="status"
            className="mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] leading-snug text-amber-900"
          >
            <span className="mr-auto">⚡ অসম্পূর্ণ ড্রাফট উদ্ধার করা হয়েছে —</span>
            <button
              type="button"
              data-testid="draft-restore"
              onClick={restoreCrashDraft}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 font-semibold text-amber-900 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              🔄 রিস্টোর করুন
            </button>
            <button
              type="button"
              data-testid="draft-discard"
              onClick={discardCrashDraft}
              className="rounded-md px-2 py-1 font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              ✕ বাতিল
            </button>
          </div>
        ) : null}

        {isReturnedRow ? (
          <div className="rounded-lg border border-maher-money bg-maher-money/10 px-3 py-2 text-xs leading-snug text-maher-money">
            ↩️ এই কাজটি ফেরত দেওয়া হয়েছে। বিল, জমা ও অবস্থা লক করা আছে —
            কাস্টমার, ফোন, মডেল, সমস্যা, টেকনিশিয়ান, খরচ ও তারিখ এডিট করতে
            পারবেন।
          </div>
        ) : null}

        {!editing ? (
          <div
            role="tablist"
            aria-label="এন্ট্রির ধরন"
            data-testid="entry-mode"
            className="flex gap-1 rounded-lg border border-slate-200/90 bg-slate-100/80 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={entryMode === "device"}
              data-testid="entry-mode-device"
              onClick={() => {
                setEntryMode("device");
                setExtrasOpen(true);
              }}
              className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition ${
                entryMode === "device"
                  ? "bg-white text-maher-navy shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              সার্ভিস / মেরামত
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={entryMode === "product"}
              data-testid="entry-mode-product"
              onClick={() => setEntryMode("product")}
              className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-semibold transition ${
                entryMode === "product"
                  ? "bg-white text-maher-navy shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Package className="h-4 w-4" />
              শুধু প্রোডাক্ট বিক্রি
            </button>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          <div>
            <FieldLabel htmlFor="svc-name">কাস্টমারের নাম</FieldLabel>
            <Input
              id="svc-name"
              value={f.customerName}
              onChange={set("customerName")}
              className={PREMIUM_FIELD}
              {...fieldA11y("customerName", fieldErrors)}
            />
            <FieldError fieldKey="customerName" errors={fieldErrors} />
          </div>
          <div>
            <FieldLabel htmlFor="svc-phone">মোবাইল নম্বর (WhatsApp)</FieldLabel>
            <Input
              id="svc-phone"
              value={f.phone}
              onChange={set("phone")}
              placeholder=""
              inputMode="tel"
              className={PREMIUM_FIELD}
              {...fieldA11y("phone", fieldErrors)}
            />
            <FieldError fieldKey="phone" errors={fieldErrors} />
          </div>
          <div>
            <FieldLabel htmlFor="svc-address">কাস্টমারের ঠিকানা</FieldLabel>
            <Input
              id="svc-address"
              data-testid="svc-address"
              value={f.customerAddress ?? ""}
              onChange={set("customerAddress")}
              placeholder=""
              className={PREMIUM_FIELD}
              maxLength={200}
              {...fieldA11y("customerAddress", fieldErrors)}
            />
            <FieldError fieldKey="customerAddress" errors={fieldErrors} />
          </div>
        </div>

        <details
          data-testid="form-condition"
          open={conditionOpen}
          onToggle={(event) => setConditionOpen(event.currentTarget.open)}
          className="group rounded-xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
        >
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 group-open:rounded-b-none group-open:border-b group-open:border-slate-300 [&::-webkit-details-marker]:hidden xl:min-h-0 xl:p-1.5 2xl:p-1">
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
            কাস্টমারের শর্ত
            {f.condition.trim() ? (
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                লেখা আছে
              </span>
            ) : null}
          </summary>
          <div className="space-y-2 border-t border-slate-200/80 p-3">
            <Textarea
              id="svc-condition"
              data-testid="svc-condition"
              value={f.condition}
              onChange={(event) => {
                clearErrors();
                setF((prev) => ({ ...prev, condition: event.target.value }));
              }}
              maxLength={MAX_CONDITION_LENGTH}
              rows={1}
              className={cn(PREMIUM_FIELD, "min-h-[36px] resize-y")}
              {...fieldA11y("condition", fieldErrors)}
            />
            <FieldError fieldKey="condition" errors={fieldErrors} />
            {/* Two tidy columns of complete terms. The wording is short enough
                to stay legible in the 340px laptop column without a sideways
                scroll or a wall of truncated pills. */}
            <div className="grid grid-cols-2 gap-1">
              {CONDITION_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  title="এই শর্ত যোগ করুন"
                  onClick={() => {
                    clearErrors();
                    setF((prev) => {
                      const current = prev.condition.trim();
                      if (!current) return { ...prev, condition: preset };
                      if (current.includes(preset)) return prev;
                      return {
                        ...prev,
                        condition: `${current}\n${preset}`.slice(
                          0,
                          MAX_CONDITION_LENGTH
                        ),
                      };
                    });
                  }}
                  className="w-full rounded-md border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-left text-xs font-medium leading-tight text-slate-700 transition-colors duration-150 hover:bg-slate-200/90 hover:text-slate-900 active:scale-95"
                >
                  {preset}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              কাস্টমারের রিসিটে ছাপা হবে।
            </p>
          </div>
        </details>

        {editing && !editingProduct ? (
          <>
            <div>{technicianField}</div>

            {/* Edit must look like the visit that was entered: the same
                numbered device card inside ডিভাইসের তথ্য, the same labels and
                the parts editor on that card — never a second flat layout. */}
            <details
              data-testid="form-more"
              open={extrasOpen}
              onToggle={(event) => setExtrasOpen(event.currentTarget.open)}
              className="group"
            >
              {/* Kept as a visually hidden summary so the shared accordion
                  helper still finds a details/summary pair; the numbered device
                  card below is the single visible header. */}
              <summary className="sr-only">ডিভাইসের তথ্য</summary>
              <div className="space-y-2 pt-0.5">
                <div
                  data-testid="device-1"
                  className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] xl:space-y-0 xl:p-2 2xl:p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-expanded={isDeviceExpanded(0)}
                      aria-controls="device-body-0"
                      onClick={() =>
                        setExpandedDevices((prev) => ({
                          ...prev,
                          "0": !isDeviceExpanded(0),
                        }))
                      }
                      className={cn(
                        "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-left text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 focus-visible:outline-none xl:h-9 xl:min-h-0 xl:p-1.5 2xl:p-1",
                        FIELD_FOCUS
                      )}
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200",
                          isDeviceExpanded(0) && "rotate-180"
                        )}
                      />
                      <span className="shrink-0 text-sm font-semibold text-slate-800">
                        ডিভাইস #১
                      </span>
                    </button>
                  </div>

                  {isDeviceExpanded(0) ? (
                    <div
                      id="device-body-0"
                      className="mt-2 space-y-2 2xl:space-y-1.5"
                    >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div>
                        <FieldLabel htmlFor="svc-model">মোবাইলের মডেল</FieldLabel>
                        <Input
                          id="svc-model"
                          value={f.model}
                          onChange={set("model")}
                          placeholder=""
                          className={PREMIUM_FIELD}
                          {...fieldA11y("model", fieldErrors)}
                        />
                        <FieldError fieldKey="model" errors={fieldErrors} />
                      </div>
                      <div>
                        <FieldLabel htmlFor="svc-problem">সমস্যা</FieldLabel>
                        <Input
                          id="svc-problem"
                          value={f.problem}
                          onChange={set("problem")}
                          placeholder=""
                          className={PREMIUM_FIELD}
                          {...fieldA11y("problem", fieldErrors)}
                        />
                        <FieldError fieldKey="problem" errors={fieldErrors} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 2xl:grid-cols-[1fr_1.6fr_1fr]">
                      <div className="min-w-0">
                        <FieldLabel htmlFor="svc-bill">
                          ডিভাইস বিল (৳)
                        </FieldLabel>
                        <Input
                          id="svc-bill"
                          value={f.totalBill}
                          onChange={set("totalBill")}
                          inputMode="numeric"
                          placeholder=""
                          readOnly={isReturnedRow}
                          className={cn(PREMIUM_FIELD, "read-only:bg-slate-50")}
                          {...fieldA11y("bill", fieldErrors)}
                        />
                        <FieldError fieldKey="bill" errors={fieldErrors} />
                      </div>
                      <div className="min-w-0">{deliveryDateField}</div>
                      <div className="col-span-2 min-w-0 2xl:col-span-1">
                        <FieldLabel htmlFor="svc-imei">IMEI নম্বর</FieldLabel>
                        <Input
                          id="svc-imei"
                          data-testid="svc-imei"
                          value={f.imei}
                          onChange={set("imei")}
                          placeholder=""
                          inputMode="numeric"
                          autoComplete="off"
                          spellCheck={false}
                          maxLength={32}
                          className={PREMIUM_FIELD}
                          {...fieldA11y("imei", fieldErrors)}
                        />
                        <FieldError fieldKey="imei" errors={fieldErrors} />
                      </div>
                      <div className="col-span-2 min-w-0 2xl:col-span-3">
                        <WarrantyField
                          id="svc-warranty"
                          testId="device-warranty-0"
                          value={f.warranty}
                          onChange={(value) => {
                            clearErrors();
                            setF((prev) => ({ ...prev, warranty: value }));
                          }}
                          fieldKey="warranty"
                          chipTestIdPrefix="svc-warranty-chip"
                          errors={fieldErrors}
                        />
                      </div>
                    </div>

                    <PartsEditor
                      testId="svc-parts"
                      drafts={editParts}
                      onChange={(next) => {
                        clearErrors();
                        setEditParts(next);
                      }}
                      today={partToday}
                      shops={partsShops}
                      disabled={isReturnedRow}
                      errors={fieldErrors}
                      fieldKeyPrefix="part:edit:"
                      expandSignal={partsSignal}
                    />
                    <p className="flex items-start gap-1.5 text-xs leading-snug text-maher-money/80">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        পার্টসের দাম ও দোকান শুধু দোকানের হিসাবের জন্য —
                        রিসিট/PDF-এ যাবে না।
                      </span>
                    </p>

                    </div>
                  ) : null}
                </div>
              </div>
            </details>
          </>
        ) : null}

        {showDevices && !editing ? (
          <>
            <div>{technicianField}</div>

            {/* The device area is the primary entry section. It starts open
                on a new visit and each card carries that device's COMPLETE
                information, so the "extra" fields are no longer separated
                from the model/problem boxes. */}
            <details
              data-testid="form-more"
              open={extrasOpen}
              onToggle={(event) => setExtrasOpen(event.currentTarget.open)}
              className="group"
            >
              {/* Kept as a visually hidden summary so the shared accordion
                  helper still finds a details/summary pair; the numbered device
                  card below is the single visible header. */}
              <summary className="sr-only">ডিভাইসের তথ্য</summary>
              <div className="space-y-2 pt-0.5">
                <div
                  data-testid="extra-devices"
                  className="space-y-2 2xl:space-y-1.5"
                >
                  {devices.map((d, index) => {
                    const isFirst = index === 0;
                    const prefix = isFirst ? "svc" : `svc-device-${d.key}`;
                    const expanded = isDeviceExpanded(d.key);
                    return (
                      <div
                        key={d.key}
                        data-testid={
                          isFirst ? "device-1" : `extra-device-${index}`
                        }
                        className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] xl:space-y-0 xl:p-2 2xl:p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-controls={`device-body-${d.key}`}
                            onClick={() =>
                              setExpandedDevices((prev) => ({
                                ...prev,
                                [String(d.key)]: !expanded,
                              }))
                            }
                            className={cn(
                              "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-left text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 focus-visible:outline-none xl:h-9 xl:min-h-0 xl:p-1.5 2xl:p-1",
                              FIELD_FOCUS
                            )}
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200",
                                expanded && "rotate-180"
                              )}
                            />
                            <span className="shrink-0 text-sm font-semibold text-slate-800">
                              ডিভাইস #{toBnDigits(index + 1)}
                            </span>
                          </button>
                          {!isFirst ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 shrink-0 px-2 text-maher-due hover:bg-maher-due/10 hover:text-maher-due"
                              onClick={() => removeDevice(d.key)}
                            >
                              সরান
                            </Button>
                          ) : null}
                        </div>

                        {expanded ? (
                          <div
                            id={`device-body-${d.key}`}
                            className="mt-2 space-y-2 2xl:space-y-1.5"
                          >
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div>
                                <FieldLabel htmlFor={`${prefix}-model`}>
                                  মোবাইলের মডেল
                                </FieldLabel>
                                <Input
                                  id={`${prefix}-model`}
                                  value={d.model}
                                  onChange={setDevice(d.key, "model")}
                                  placeholder=""
                                  className={PREMIUM_FIELD}
                                  {...fieldA11y(`model:${d.key}`, fieldErrors)}
                                />
                                <FieldError
                                  fieldKey={`model:${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                              <div>
                                <FieldLabel htmlFor={`${prefix}-problem`}>সমস্যা</FieldLabel>
                                <Input
                                  id={`${prefix}-problem`}
                                  value={d.problem}
                                  onChange={setDevice(d.key, "problem")}
                                  placeholder=""
                                  className={PREMIUM_FIELD}
                                  {...fieldA11y(`problem:${d.key}`, fieldErrors)}
                                />
                                <FieldError
                                  fieldKey={`problem:${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                            </div>

                            {/* Bill, delivery and IMEI share one row on the
                                1920px shop desk so the form and footer stay
                                inside 1080px; narrower widths keep two rows. */}
                            <div className="grid grid-cols-2 gap-2 2xl:grid-cols-[1fr_1.6fr_1fr]">
                              <div className="min-w-0">
                                <FieldLabel htmlFor={`${prefix}-bill`}>
                                  ডিভাইস বিল (৳)
                                </FieldLabel>
                                <Input
                                  id={`${prefix}-bill`}
                                  value={d.totalBill}
                                  onChange={setDevice(d.key, "totalBill")}
                                  inputMode="numeric"
                                  placeholder=""
                                  className={PREMIUM_FIELD}
                                  {...fieldA11y(`bill:${d.key}`, fieldErrors)}
                                />
                                <FieldError
                                  fieldKey={`bill:${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                              <div className="min-w-0">
                                <DeliveryDateField
                                  id={`${prefix}-delivery-date`}
                                  testId={`device-delivery-${d.key}`}
                                  value={d.deliveryDate}
                                  onChange={(value) =>
                                    patchDevice(d.key, { deliveryDate: value })
                                  }
                                  fieldKey={`delivery:${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                              <div className="col-span-2 min-w-0 2xl:col-span-1">
                                <FieldLabel htmlFor={`${prefix}-imei`}>IMEI নম্বর</FieldLabel>
                                <Input
                                  id={`${prefix}-imei`}
                                  data-testid={`device-imei-${d.key}`}
                                  value={d.imei}
                                  onChange={setDevice(d.key, "imei")}
                                  placeholder=""
                                  inputMode="numeric"
                                  autoComplete="off"
                                  spellCheck={false}
                                  maxLength={32}
                                  className={PREMIUM_FIELD}
                                  {...fieldA11y(`imei:${d.key}`, fieldErrors)}
                                />
                                <FieldError
                                  fieldKey={`imei:${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                              <div className="col-span-2 min-w-0 2xl:col-span-3">
                                <WarrantyField
                                  id={`device-warranty-${d.key}`}
                                  testId={`device-warranty-${d.key}`}
                                  value={d.warranty}
                                  onChange={(value) => {
                                    clearErrors();
                                    patchDevice(d.key, { warranty: value });
                                  }}
                                  fieldKey={`warranty:${d.key}`}
                                  chipTestIdPrefix={`device-warranty-chip-${d.key}`}
                                  errors={fieldErrors}
                                />
                              </div>
                            </div>

                            {!editing ? (
                              <PartsEditor
                                testId={
                                  isFirst ? "svc-parts" : `svc-parts-${d.key}`
                                }
                                drafts={d.parts}
                                onChange={(next) =>
                                  patchDevice(d.key, { parts: next })
                                }
                                today={partToday}
                                shops={partsShops}
                                errors={fieldErrors}
                                fieldKeyPrefix={`part:${d.key}:`}
                                expandSignal={partsSignal}
                              />
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* The add action stays after the complete cards, never
                      between a device and its own fields. */}
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
                  </div>
                </div>
              </div>
            </details>
          </>
        ) : null}

        {showProducts ? <div className="space-y-2">{productLinesField}</div> : null}

        {showDevices || (!editing && entryMode === "product") ? (
          <div className="rounded-xl border border-slate-200/90 bg-white p-3.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] ring-1 ring-slate-900/[0.02] xl:p-3">
            {/* Reading order is bill → advance → due. `বাকি` is always the
                last, clearly read-only result of the two amounts above it. */}
            <div className="grid grid-cols-2 gap-3 2xl:grid-cols-3 2xl:gap-2">
              <div>
                <FieldLabel htmlFor="svc-total-bill">
                  মোট বিল (৳)
                </FieldLabel>
                <Input
                  id="svc-total-bill"
                  data-testid="svc-total-bill"
                  value={
                    !editing && entryMode === "product"
                      ? String(productTotal)
                      : visitBillText
                  }
                  onChange={
                    summaryMoneyEditing
                      ? set("totalBill")
                      : (e) => setVisitTotalBill(e.target.value)
                  }
                  placeholder=""
                  inputMode="numeric"
                  readOnly={
                    editingProduct ||
                    isReturnedRow ||
                    entryMode === "product" ||
                    (!summaryMoneyEditing && hasDeviceBills)
                  }
                  title={
                    isReturnedRow
                      ? "ফেরত দেওয়া কাজের বিল লক করা আছে"
                      : summaryMoneyEditing
                        ? "এই ডিভাইসের বিলের সাথে একই — যেকোনো জায়গা বদলালে দুটোই বদলাবে"
                        : hasDeviceBills || entryMode === "product"
                          ? "ডিভাইসগুলোর বিলের যোগফল"
                          : "ডিভাইসে বিল না দিলে এখানে লিখুন"
                  }
                  className={cn(
                    PREMIUM_FIELD,
                    "read-only:bg-white read-only:font-semibold"
                  )}
                  {...fieldA11y(sharedBillKey, sharedMoneyErrors)}
                />
                <FieldError fieldKey={sharedBillKey} errors={sharedMoneyErrors} />
              </div>
              <div>
                <FieldLabel htmlFor="svc-adv">
                  জমা (৳)
                </FieldLabel>
                <Input
                  id="svc-adv"
                  value={f.advance}
                  onChange={set("advance")}
                  placeholder=""
                  inputMode="numeric"
                  readOnly={isReturnedRow}
                  className={cn(PREMIUM_FIELD, "read-only:bg-slate-50")}
                  {...fieldA11y(sharedAdvanceKey, sharedMoneyErrors)}
                />
                <FieldError fieldKey={sharedAdvanceKey} errors={sharedMoneyErrors} />
              </div>
              <div
                className={cn(
                  "flex h-9 items-center justify-between gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-bold tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-all duration-150 xl:h-8 xl:py-1 2xl:col-span-1 2xl:gap-1.5 2xl:px-2 2xl:text-xs",
                  visitDue > 0
                    ? "border-amber-200/90 bg-amber-50/90 text-amber-900"
                    : "border-emerald-200/90 bg-emerald-50/80 text-emerald-800"
                )}
              >
                <FieldLabel htmlFor="svc-due" className="sr-only">
                  বাকি (স্বয়ংক্রিয়)
                </FieldLabel>
                <span className="font-bold">বাকি:</span>
                <span className="ml-auto inline-flex items-baseline gap-1 font-bold tabular-nums">
                  <span aria-hidden className="text-xs font-bold">
                    ৳
                  </span>
                  <input
                    id="svc-due"
                    data-testid="svc-due"
                    value={formatTaka(visitDue).replace("৳", "").trim()}
                    readOnly
                    aria-label="বাকি (স্বয়ংক্রিয়)"
                    title="মোট বিল − জমা; এটি সম্পাদনা করা যায় না"
                    className="w-[68px] border-0 bg-transparent p-0 text-left text-sm font-bold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10 2xl:w-[58px] 2xl:text-xs"
                  />
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {editing && !editingProduct ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{statusField}</div>
        ) : null}

        {onAddPartShop && newShopNames.length > 0 ? (
          <div
            data-testid="svc-shop-quickadd"
            className="flex flex-wrap items-center gap-1 rounded-md bg-maher-blue-soft/60 px-2 py-1.5"
          >
            <span className="text-[10px] font-medium text-muted-foreground">
              নতুন দোকান হিসেবে সেভ:
            </span>
            {newShopNames.map((name, index) => (
              <button
                key={name.toLocaleLowerCase()}
                type="button"
                data-testid={`svc-shop-quickadd-${index}`}
                onClick={() => onAddPartShop(name)}
                title={`${name} দোকান তালিকায় যোগ করুন`}
                className="inline-flex max-w-full items-center gap-1 rounded border border-maher-blue/30 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-maher-blue transition-colors hover:bg-maher-blue-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-maher-blue"
              >
                <Plus className="h-3 w-3 shrink-0" />
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="sticky bottom-0 z-10 -mx-2.5 -mb-2.5 border-t border-slate-200 bg-white px-2.5 py-2 shadow-[0_-8px_20px_-16px_rgba(15,23,42,0.35)]">
          {editing ? (
            <div className="flex gap-2">
              <Button
                type="submit"
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.99]"
                disabled={saving}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "আপডেট করুন"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onCancelEdit}
                className="rounded-lg transition-all active:scale-[0.99]"
              >
                বাতিল
              </Button>
            </div>
          ) : (
            <Button
              type="submit"
              className="flex h-auto w-full items-center justify-center gap-2 rounded-lg bg-slate-900 py-2.5 text-base font-semibold text-white shadow-sm transition-all hover:bg-slate-800 active:scale-[0.99] xl:h-9 xl:py-2"
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "সেভ করুন"}
            </Button>
          )}
        </div>
      </form>
      <ProductPickerDialog
        open={pickerOpen}
        products={products}
        categories={categories}
        onClose={() => setPickerOpen(false)}
        onPick={addProduct}
      />
    </section>
  );
}
