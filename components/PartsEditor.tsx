"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, Plus, Store, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import type { CipherConfig } from "@/lib/secret-code";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  decodeShopExpense,
  normalizeShopExpense,
} from "@/lib/expense-code";
import { MAX_PARTS_PER_DEVICE, type PartInput } from "@/lib/parts";
import type { ServicePartDTO } from "@/lib/types";
import { cn, formatTaka, parseBnNumber } from "@/lib/utils";

/** Shared, quiet focus treatment for every editable field in the POS form. */
const FIELD_FOCUS =
  "focus-visible:border-slate-800 focus-visible:ring-2 focus-visible:ring-slate-900/10";

/** Presentational-only premium field treatment for the part lines. */
const PART_FIELD =
  "h-8 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04),0_1px_1px_rgba(0,0,0,0.02)] outline-none transition-all duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-slate-900 focus:ring-[3px] focus:ring-slate-900/10 focus:outline-none focus-visible:border-slate-900 focus-visible:ring-[3px] focus-visible:ring-slate-900/10";

/** Matching sharp, dark micro-typography for part-line labels. */
const PART_LABEL =
  "mb-1.5 flex items-center justify-between text-xs font-semibold tracking-tight text-slate-800 2xl:mb-1";

/**
 * One editable part line in the service form. `price` is ONE field: the
 * shopkeeper may type a plain amount ("1500") or a keypad code ("*J#") — the
 * former "দোকান খরচ" code now lives here as the part price. A plain amount is
 * encoded into a canonical code on save, a typed code stays as typed, and the
 * form previews the generated code with its decoded amount. `supplier` is the
 * shop where this part was purchased.
 */
export interface PartDraft {
  key: number;
  /** Existing ServicePart row id — omitted for a brand-new line. */
  id?: number;
  name: string;
  quantity: string;
  price: string;
  supplier: string;
  /** "YYYY-MM-DD"; defaults to today and is visibly editable. */
  purchaseDate: string;
  /** Broken at entry time — its cost goes to the shop's loss, not the bill. */
  damaged: boolean;
  /** Existing line already settled (return/stock/damage) — cannot be split. */
  resolved?: boolean;
  /** Existing whole-line paid marker (read-only in the form). */
  paidAt?: string | null;
}

export function blankPartDraft(
  key: number,
  today: string,
  supplier = ""
): PartDraft {
  return {
    key,
    name: "",
    quantity: "1",
    price: "",
    supplier,
    purchaseDate: today,
    damaged: false,
  };
}

export function partDraftsFromDTO(parts: readonly ServicePartDTO[] | undefined): PartDraft[] {
  return (parts ?? []).map((part, index) => ({
    key: index,
    id: part.id,
    name: part.name,
    quantity: String(part.quantity),
    // A line saved as a code shows the code again so re-saving keeps it a code.
    price: part.priceCode ?? String(part.unitCost),
    supplier: part.supplier ?? "",
    purchaseDate: part.purchaseDate ?? "",
    damaged: part.partStatus === "DAMAGED",
    resolved: part.partStatus !== "USED",
    paidAt: part.paidAt,
  }));
}

/** Restores a session draft's part rows defensively (storage is untrusted). */
export function normalizePartDrafts(raw: unknown): PartDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map((row, index) => ({
      key: Number(row.key) || index,
      ...(Number(row.id) > 0 ? { id: Number(row.id) } : {}),
      name: String(row.name ?? ""),
      quantity: String(row.quantity ?? "1"),
      price: String(row.price ?? ""),
      supplier: String(row.supplier ?? ""),
      purchaseDate: String(row.purchaseDate ?? ""),
      damaged: row.damaged === true || row.partStatus === "DAMAGED",
      resolved:
        row.resolved === true ||
        (typeof row.partStatus === "string" &&
          row.partStatus !== "" &&
          row.partStatus !== "USED"),
      paidAt: row.paidAt == null ? null : String(row.paidAt),
    }));
}

/** True when the shopkeeper actually typed something on this line. */
function hasContent(draft: PartDraft): boolean {
  return !!(
    draft.name.trim() ||
    draft.price.trim() ||
    draft.supplier.trim()
  );
}

/** Raw API payload: blank rows are dropped, ids are kept for a merge update. */
export function partsPayloadFromDrafts(
  drafts: readonly PartDraft[]
): PartInput[] {
  return drafts.filter(hasContent).map((draft) => ({
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name.trim(),
    quantity: Number(parseBnNumber(draft.quantity) ?? 0),
    price: draft.price.trim(),
    supplier: draft.supplier.trim(),
    purchaseDate: draft.purchaseDate.trim(),
    partStatus: draft.damaged ? "DAMAGED" : "USED",
  }));
}

export function partsDraftTotal(
  drafts: readonly PartDraft[],
  config?: CipherConfig
): number {
  return drafts.reduce((sum, draft) => {
    const qty = Math.max(0, Math.floor(parseBnNumber(draft.quantity) ?? 0));
    const decoded = decodeShopExpense(draft.price, config);
    const unit = decoded.amount ?? 0;
    return sum + qty * unit;
  }, 0);
}

function PricePreview({ price }: { price: string }) {
  const { cipher } = useShopSettings();
  const decoded = decodeShopExpense(price, cipher);
  if (decoded.kind === "empty") {
    return <span className="text-maher-money/80">দাম লিখুন</span>;
  }
  if (decoded.kind === "invalid") {
    return <span className="font-medium text-maher-due">{decoded.error}</span>;
  }
  // Plain amounts are encoded on save too — show the very same code here so
  // the shopkeeper sees what will be stored, not only the decoded money.
  const code = normalizeShopExpense(price, cipher).stored;
  return (
    <span className="font-medium text-maher-done">
      গোপন কোড: {code} ➔ {formatTaka(decoded.amount ?? 0)}
    </span>
  );
}

/** Inline error beside its own input, tied to it for screen readers. */
function PartError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-0.5 text-[11px] leading-snug text-maher-due">
      {message}
    </p>
  );
}

/**
 * Per-device parts editor. Parts capture the part name, its price (amount or
 * shop-expense code), the shop/supplier it was bought from, and purchase date.
 * Zero rows means no part/payable row is written for the device.
 *
 * The section stays collapsed until the shopkeeper needs it: an optional line
 * is still obvious (label + add action), but it no longer fills the narrow
 * form panel with empty boxes before any part exists.
 */
export function PartsEditor({
  drafts,
  onChange,
  today,
  shops = [],
  disabled = false,
  testId,
  errors = {},
  fieldKeyPrefix = "part:",
  expandSignal = 0,
}: {
  drafts: PartDraft[];
  onChange: (next: PartDraft[]) => void;
  today: string;
  /** Known shop/supplier names (created in সার্ভিস খাতা + known from data). */
  shops?: string[];
  /** A returned job's parts are frozen server-side. */
  disabled?: boolean;
  testId?: string;
  /** Field-keyed validation messages from the parent form. */
  errors?: Record<string, string>;
  /** Prefix used to build matching `data-field` / error keys. */
  fieldKeyPrefix?: string;
  /** Increment to force the section open (e.g. after a validation error). */
  expandSignal?: number;
}) {
  const { cipher } = useShopSettings();
  const [open, setOpen] = useState(() => drafts.length > 0);
  // Shop picker: one dropdown at a time, with a keyboard-friendly active row.
  const [openShopKey, setOpenShopKey] = useState<number | null>(null);
  const [activeShopIndex, setActiveShopIndex] = useState(0);

  // Saved /parts shops for the picker. An empty name shows the whole list; a
  // partial name narrows it down; an EXACT saved name resolves to that shop
  // alone so Enter can never attribute a line to a different supplier.
  const shopMatches = (supplier: string) => {
    const query = supplier.trim().toLocaleLowerCase();
    if (!query) return shops;
    const exact = shops.filter((shop) => shop.toLocaleLowerCase() === query);
    if (exact.length > 0) return exact;
    return shops.filter((shop) => shop.toLocaleLowerCase().includes(query));
  };

  // A parts validation error must reveal the offending field, never leave it
  // hidden inside the collapsed section.
  useEffect(() => {
    if (expandSignal > 0) setOpen(true);
  }, [expandSignal]);

  const seq = drafts.reduce((max, draft) => Math.max(max, draft.key), 0);
  const atMax = drafts.length >= MAX_PARTS_PER_DEVICE;

  const patch = (key: number, values: Partial<PartDraft>) =>
    onChange(
      drafts.map((draft) => (draft.key === key ? { ...draft, ...values } : draft))
    );

  const add = () => {
    setOpen(true);
    onChange([...drafts, blankPartDraft(seq + 1, today, shops[0] ?? "")]);
  };

  const remove = (key: number) =>
    onChange(drafts.filter((draft) => draft.key !== key));

  /**
   * Peel ONE unit off a multi-unit line into a new, identical line. The saved
   * id stays on the original, so the server updates it and creates only the
   * new row. quantity × price is preserved across the two lines, so marking
   * just one of them DAMAGED charges exactly one unit to the shop's loss.
   */
  const splitOne = (key: number) => {
    const source = drafts.find((draft) => draft.key === key);
    if (!source) return;
    const qty = Math.floor(parseBnNumber(source.quantity) ?? 0);
    if (
      disabled ||
      atMax ||
      source.paidAt ||
      source.damaged ||
      source.resolved ||
      qty < 2
    ) {
      return;
    }
    const newKey = seq + 1;
    const next: PartDraft[] = [];
    for (const draft of drafts) {
      // The new line goes first: it is the only one the form may mark DAMAGED
      // (a saved line's status is owned by the parts ledger's নিষ্পত্তি).
      if (draft.key === key) {
        next.push({
          ...source,
          key: newKey,
          id: undefined,
          quantity: "1",
          damaged: false,
          resolved: false,
          paidAt: undefined,
        });
        next.push({ ...draft, quantity: String(qty - 1) });
      } else {
        next.push(draft);
      }
    }
    setOpen(true);
    onChange(next);
  };

  const field = (draft: PartDraft, name: string) =>
    `${fieldKeyPrefix}${draft.key}:${name}`;
  const a11y = (draft: PartDraft, name: string) => {
    const key = field(draft, name);
    const message = errors[key];
    return {
      "data-field": key,
      "aria-invalid": message ? (true as const) : undefined,
      "aria-describedby": message ? `${testId}-${name}-${draft.key}-error` : undefined,
    };
  };
  const errorFor = (draft: PartDraft, name: string) =>
    errors[field(draft, name)];

  return (
    <div data-testid={testId} className="min-w-0">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${testId}-body`}
          disabled={disabled}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-left text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-100/70 hover:text-slate-900 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 xl:h-9 xl:min-h-0 xl:p-1.5 2xl:p-1",
            FIELD_FOCUS
          )}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-slate-500 transition-transform duration-200",
              open && "rotate-180"
            )}
          />
          <span className="truncate">পার্টস</span>
          {drafts.length > 0 ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
              {drafts.length}
            </span>
          ) : null}
        </button>
        {drafts.some((draft) => {
          const kind = decodeShopExpense(draft.price, cipher).kind;
          return kind !== "empty" && kind !== "invalid";
        }) ? (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-slate-700">
            মোট {formatTaka(partsDraftTotal(drafts, cipher))}
          </span>
        ) : null}
        {!open ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || atMax}
            onClick={add}
            className={cn(
              "h-8 shrink-0 rounded-lg px-2 text-[11px] font-semibold text-maher-money hover:bg-maher-money/10 hover:text-maher-money focus-visible:outline-none",
              FIELD_FOCUS
            )}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            পার্টস যোগ করুন
          </Button>
        ) : null}
      </div>

      {open ? (
        <div id={`${testId}-body`} className="mt-1 space-y-2">
          {drafts.map((draft, index) => {
            const paid = !!draft.paidAt;
            // A saved row's status is owned by the parts ledger's নিষ্পত্তি;
            // the form may only flag brand-new lines as DAMAGED.
            const qty = Math.floor(parseBnNumber(draft.quantity) ?? 0);
            const canSplit =
              !disabled &&
              !atMax &&
              !paid &&
              !draft.damaged &&
              !draft.resolved &&
              qty >= 2;
            return (
              <div
                key={draft.key}
                data-testid={testId ? `${testId}-row-${index}` : undefined}
                className={cn(
                  "space-y-1.5 rounded-md px-1.5 py-1.5 first:pt-0",
                  paid ? "bg-maher-done/5" : "bg-maher-surface/40"
                )}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground">
                      পার্টস {index + 1}
                    </span>
                    <label
                      className={cn(
                        "inline-flex shrink-0 cursor-pointer items-center gap-1 rounded border px-1 py-0.5 text-[10px] font-semibold transition-colors",
                        draft.damaged
                          ? "border-maher-due/40 bg-maher-due/10 text-maher-due"
                          : "border-maher-border bg-white text-muted-foreground hover:border-maher-navy/35",
                        (disabled || draft.id) && "cursor-not-allowed opacity-70"
                      )}
                      title={
                        draft.id
                          ? "সংরক্ষিত পার্টসের ড্যামেজ অবস্থা পার্টস খাতার নিষ্পত্তি থেকে বদলান"
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={draft.damaged}
                        disabled={disabled || !!draft.id}
                        onChange={(event) =>
                          patch(draft.key, { damaged: event.target.checked })
                        }
                        data-testid={
                          testId ? `${testId}-damage-${index}` : undefined
                        }
                        aria-label={`পার্টস ${index + 1} ড্যামেজ`}
                        className="h-3 w-3 shrink-0 accent-maher-due"
                      />
                      ড্যামেজ
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    {paid ? (
                      <span className="rounded-full bg-maher-done/15 px-1.5 py-0.5 text-[10px] font-bold text-maher-done">
                        Paid — খাতা থেকে বদলান
                      </span>
                    ) : null}
                    {draft.id && paid ? (
                      <span className="text-[10px] text-muted-foreground">লক</span>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => remove(draft.key)}
                      aria-label={`পার্টস ${index + 1} সরান`}
                      className="h-6 px-1.5 text-maher-due hover:bg-maher-due/10 hover:text-maher-due"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {draft.damaged ? (
                  <p className="text-[10px] leading-snug text-maher-due">
                    এই পার্টের দাম কাস্টমারের বিলে যাবে না — দোকানের ক্ষতিতে যোগ হবে।
                  </p>
                ) : null}
                {canSplit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => splitOne(draft.key)}
                    data-testid={testId ? `${testId}-split-${index}` : undefined}
                    aria-label={`পার্টস ${index + 1} থেকে ১টি আলাদা লাইন বানান`}
                    className="h-6 w-full border-dashed border-maher-navy/30 bg-white text-[10px] font-semibold text-maher-navy hover:bg-maher-navy/5 hover:text-maher-navy"
                  >
                    <Copy className="mr-1 h-3 w-3" />
                    ১টি আলাদা লাইন — একটিকে ড্যামেজ দিন
                  </Button>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                  <div className="col-span-2 min-w-0">
                    <Label className={PART_LABEL} htmlFor={`${testId}-name-${draft.key}`}>পার্টসের নাম</Label>
                    <Input
                      id={`${testId}-name-${draft.key}`}
                      value={draft.name}
                      onChange={(event) => patch(draft.key, { name: event.target.value })}
                      disabled={disabled}
                      placeholder=""
                      maxLength={80}
                      className={PART_FIELD}
                      {...a11y(draft, "name")}
                    />
                    <PartError
                      id={`${testId}-name-${draft.key}-error`}
                      message={errorFor(draft, "name")}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label className={PART_LABEL} htmlFor={`${testId}-price-${draft.key}`}>
                      পার্টসের দাম (৳ বা কোড)
                    </Label>
                    <Input
                      id={`${testId}-price-${draft.key}`}
                      value={draft.price}
                      onChange={(event) => patch(draft.key, { price: event.target.value })}
                      disabled={disabled || paid}
                      placeholder=""
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={24}
                      className={PART_FIELD}
                      {...a11y(draft, "price")}
                    />
                    <PartError
                      id={`${testId}-price-${draft.key}-error`}
                      message={errorFor(draft, "price")}
                    />
                    <div className="text-[11px] leading-tight">
                      <PricePreview price={draft.price} />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <Label className={PART_LABEL} htmlFor={`${testId}-qty-${draft.key}`}>পরিমাণ</Label>
                    <Input
                      id={`${testId}-qty-${draft.key}`}
                      value={draft.quantity}
                      onChange={(event) => patch(draft.key, { quantity: event.target.value })}
                      disabled={disabled || paid}
                      inputMode="numeric"
                      className={PART_FIELD}
                      {...a11y(draft, "qty")}
                    />
                    <PartError
                      id={`${testId}-qty-${draft.key}-error`}
                      message={errorFor(draft, "qty")}
                    />
                  </div>
                  <div className="col-span-2 min-w-0">
                    <Label className={PART_LABEL} htmlFor={`${testId}-supplier-${draft.key}`}>
                      পার্টসের দোকান
                    </Label>
                    <div
                      className="relative"
                      onBlur={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node | null
                          )
                        ) {
                          setOpenShopKey(null);
                        }
                      }}
                    >
                      <Input
                        id={`${testId}-supplier-${draft.key}`}
                        value={draft.supplier}
                        onChange={(event) => {
                          patch(draft.key, { supplier: event.target.value });
                          setOpenShopKey(draft.key);
                          setActiveShopIndex(0);
                        }}
                        onFocus={() => {
                          if (!disabled && !paid) setOpenShopKey(draft.key);
                        }}
                        onClick={() => {
                          if (!disabled && !paid) setOpenShopKey(draft.key);
                        }}
                        onKeyDown={(event) => {
                          if (disabled || paid) return;
                          const options = shopMatches(draft.supplier);
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setOpenShopKey(draft.key);
                            setActiveShopIndex((i) =>
                              options.length ? (i + 1) % options.length : 0
                            );
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setOpenShopKey(draft.key);
                            setActiveShopIndex((i) =>
                              options.length
                                ? (i - 1 + options.length) % options.length
                                : 0
                            );
                          } else if (
                            event.key === "Enter" &&
                            openShopKey === draft.key &&
                            options[activeShopIndex]
                          ) {
                            event.preventDefault();
                            patch(draft.key, { supplier: options[activeShopIndex] });
                            setOpenShopKey(null);
                          } else if (event.key === "Escape") {
                            setOpenShopKey(null);
                          }
                        }}
                        disabled={disabled || paid}
                        placeholder=""
                        maxLength={100}
                        autoComplete="off"
                        role="combobox"
                        aria-expanded={openShopKey === draft.key}
                        aria-controls={`${testId}-shop-list-${draft.key}`}
                        aria-autocomplete="list"
                        aria-activedescendant={
                          openShopKey === draft.key &&
                          shopMatches(draft.supplier)[activeShopIndex]
                            ? `${testId}-shop-option-${draft.key}-${activeShopIndex}`
                            : undefined
                        }
                        className={cn(PART_FIELD, "pr-8")}
                        {...a11y(draft, "supplier")}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-label="দোকানের তালিকা দেখুন"
                        disabled={disabled || paid}
                        onClick={() => {
                          setOpenShopKey((key) =>
                            key === draft.key ? null : draft.key
                          );
                          setActiveShopIndex(0);
                        }}
                        className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-maher-navy disabled:opacity-50"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      {openShopKey === draft.key ? (
                        <div
                          id={`${testId}-shop-list-${draft.key}`}
                          role="listbox"
                          data-testid={`${testId}-shop-list-${draft.key}`}
                          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border border-maher-border bg-white p-1 shadow-card"
                        >
                          {shopMatches(draft.supplier).length > 0 ? (
                            shopMatches(draft.supplier).map((shop, shopIndex) => {
                              const selected =
                                shop.toLocaleLowerCase() ===
                                draft.supplier.trim().toLocaleLowerCase();
                              return (
                                <button
                                  key={shop}
                                  id={`${testId}-shop-option-${draft.key}-${shopIndex}`}
                                  type="button"
                                  role="option"
                                  aria-selected={selected}
                                  data-testid={`${testId}-shop-option-${shopIndex}`}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onMouseEnter={() => setActiveShopIndex(shopIndex)}
                                  onClick={() => {
                                    patch(draft.key, { supplier: shop });
                                    setOpenShopKey(null);
                                  }}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-xs transition-colors",
                                    shopIndex === activeShopIndex
                                      ? "bg-maher-blue-soft text-maher-navy"
                                      : "text-maher-navy hover:bg-maher-surface"
                                  )}
                                >
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-maher-surface text-maher-blue">
                                    <Store className="h-3 w-3" />
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{shop}</span>
                                  {selected ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-maher-blue" />
                                  ) : null}
                                </button>
                              );
                            })
                          ) : (
                            <p className="px-2 py-2 text-[11px] leading-snug text-muted-foreground">
                              এই নামের দোকান নেই — নতুন নাম লিখুন।
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <PartError
                      id={`${testId}-supplier-${draft.key}-error`}
                      message={errorFor(draft, "supplier")}
                    />
                  </div>
                  <div className="min-w-0">
                    <Label className={PART_LABEL} htmlFor={`${testId}-date-${draft.key}`}>কেনার তারিখ</Label>
                    <Input
                      id={`${testId}-date-${draft.key}`}
                      type="date"
                      value={draft.purchaseDate}
                      onChange={(event) => patch(draft.key, { purchaseDate: event.target.value })}
                      disabled={disabled || paid}
                      className={PART_FIELD}
                      {...a11y(draft, "date")}
                    />
                    <PartError
                      id={`${testId}-date-${draft.key}-error`}
                      message={errorFor(draft, "date")}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || atMax}
            onClick={add}
            className={cn(
              "h-8 w-full rounded-lg border-dashed border-maher-money/40 bg-white text-maher-money hover:bg-maher-money/10 disabled:opacity-60 focus-visible:outline-none",
              FIELD_FOCUS
            )}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {atMax ? `সর্বোচ্চ ${MAX_PARTS_PER_DEVICE}টি পার্টস` : "আরেকটি পার্টস যোগ করুন"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
