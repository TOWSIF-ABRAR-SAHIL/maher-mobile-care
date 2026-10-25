import { dhakaDateKey, isDateKey, serviceDateFromKey } from "./dhaka";
import { normalizeShopExpense } from "./expense-code";
import {
  FLOW_STATUSES,
  FALLBACK_TECHNICIANS,
  RETURNED_STATUS,
  computeDue,
  parseBnNumber,
} from "./utils";

/** Matches every user-facing validation error thrown by this module. */
export const SERVICE_VALIDATION_PATTERN =
  /আবশ্যক|বাছুন|লিখুন|দিন|বেশি|সঠিক সংখ্যা|অনেক বড়|সঠিক তারিখ|ভুল ডেটা|গোপন কোড|পার্টস কেনার দোকান|বদলানো|must be|Invalid date/;

/** Advance (জমা) may never exceed the bill — anything above the bill is
 *  overpay, not a valid ledger value. */
export const OVERPAY_MESSAGE = "জমা মোট বিলের বেশি হতে পারে না";

export function isServiceValidationError(err: unknown): boolean {
  return (
    err instanceof Error && SERVICE_VALIDATION_PATTERN.test(err.message)
  );
}

export interface ServiceFormValues {
  customerName: string;
  phone: string;
  model: string;
  technician: string;
  problem: string;
  totalBill: string;
  advance: string;
  status: string;
  shopExpense: string;
  /** Internal only: where the parts were bought. Never on a receipt. */
  partsShop?: string;
  /** Internal only: shop-borne damage repair/compensation. */
  damageLoss?: string;
  damageNote?: string;
  /** Expected handover date (YYYY-MM-DD), optional. */
  deliveryDate?: string;
  serviceDate?: string;
}

/**
 * Validation context.
 *
 * `allowedTechnicians` is injected rather than imported so this module stays a
 * pure, synchronous function: API routes pass the database-backed active list,
 * the client form passes what it fetched, and both share one rule set. When it
 * is omitted the pre-v1.1 hardcoded list is used as a fallback so the form
 * still works if the technician request fails.
 */
export interface ValidationContext {
  allowedTechnicians?: readonly string[];
  /**
   * UI-only hint: the product-sale mode reuses `model`/`problem`, so the
   * required-field messages should use the product wording. No data shape
   * changes — API routes simply omit this flag and keep the service wording.
   */
  productSale?: boolean;
}

export interface ValidatedServicePayload {
  customerName: string;
  phone: string;
  model: string;
  technician: string;
  problem: string;
  totalBill: number;
  advance: number;
  due: number;
  status: string;
  shopExpense: string | null;
  expenseAmount: number;
  partsShop: string | null;
  damageLoss: number;
  damageNote: string | null;
  deliveryDate: Date | null;
  serviceDateKey: string;
  serviceDate: Date;
}

function requiredText(value: unknown, message: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(message);
  return text;
}

function readBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("ভুল ডেটা পাঠানো হয়েছে");
  }
  return body as Record<string, unknown>;
}

const MAX_PARTS_SHOP_LENGTH = 100;
const MAX_NOTE_LENGTH = 300;

/** Optional internal field: blanks become NULL, long names are rejected. */
function optionalPartsShop(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_PARTS_SHOP_LENGTH) {
    throw new Error("পার্টস কেনার দোকানের নাম ১০০ অক্ষরের বেশি হতে পারবে না");
  }
  return text;
}

/** Optional free-text note (refund/damage). Blank becomes NULL. */
export function optionalNote(value: unknown, field: string): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > MAX_NOTE_LENGTH) {
    throw new Error(`${field} ৩০০ অক্ষরের বেশি হতে পারবে না`);
  }
  return text;
}

function validateTechnician(
  value: unknown,
  ctx?: ValidationContext
): string {
  const technician = String(value ?? "").trim();
  const allowed =
    ctx?.allowedTechnicians && ctx.allowedTechnicians.length > 0
      ? ctx.allowedTechnicians
      : FALLBACK_TECHNICIANS;
  if (!(allowed as readonly string[]).includes(technician)) {
    throw new Error("সঠিক টেকনিশিয়ান বাছুন");
  }
  return technician;
}

function validateStatus(value: unknown): string {
  const status = String(value ?? "").trim();
  // "Returned" is set only through the dedicated refund endpoint, never by a
  // generic create/edit form (which would skip the refund bookkeeping).
  if (!(FLOW_STATUSES as readonly string[]).includes(status)) {
    throw new Error("সঠিক অবস্থা বাছুন");
  }
  return status;
}

/** Largest amount a single INTEGER column can safely hold in SQLite/Prisma. */
export const MAX_SERVICE_AMOUNT = 2_147_483_647;

/** Accepts Western or Bengali digits and always floors to a non-negative integer. */
export function parseServiceAmount(value: unknown, field: string): number {
  let parsed: number | null;
  if (typeof value === "number") {
    parsed = Number.isFinite(value) ? value : null;
  } else {
    parsed = parseBnNumber(value);
  }
  if (parsed === null || parsed < 0) {
    throw new Error(`${field}তে সঠিক সংখ্যা দিন`);
  }
  const floored = Math.floor(parsed);
  if (!Number.isSafeInteger(floored) || floored > MAX_SERVICE_AMOUNT) {
    throw new Error(`${field}র পরিমাণ অনেক বড়`);
  }
  return floored;
}

/**
 * Shared create/edit-form validation. The dashboard form calls this before
 * sending a request, and POST /api/services uses it as well, so API clients
 * and the UI can never drift into different validation rules.
 */
export function validateServicePayload(
  values: ServiceFormValues,
  ctx?: ValidationContext
): ValidatedServicePayload {
  const customerName = requiredText(values.customerName, "কাস্টমারের নাম দিন");
  const phone = requiredText(values.phone, "মোবাইল নম্বর দিন");
  const model = requiredText(
    values.model,
    ctx?.productSale ? "প্রোডাক্টের নাম দিন" : "মোবাইলের মডেল দিন"
  );
  const technician = validateTechnician(values.technician, ctx);
  const problem = requiredText(
    values.problem,
    ctx?.productSale ? "বিবরণ লিখুন" : "সমস্যা লিখুন"
  );
  const status = validateStatus(values.status);
  const totalBill = parseServiceAmount(values.totalBill, "মোট বিল");
  const advanceRaw = String(values.advance ?? "").trim();
  const advance =
    advanceRaw === "" ? 0 : parseServiceAmount(values.advance, "জমা");
  if (advance > totalBill) {
    throw new Error(OVERPAY_MESSAGE);
  }

  const normalizedExpense = normalizeShopExpense(values.shopExpense);
  if (normalizedExpense.kind === "invalid") {
    throw new Error(
      normalizedExpense.error ?? "দোকান খরচে সঠিক সংখ্যা বা গোপন কোড দিন"
    );
  }
  const shopExpense = normalizedExpense.stored;
  const expenseAmount = normalizedExpense.amount ?? 0;
  const partsShop = optionalPartsShop(values.partsShop);
  const damageLossRaw = String(values.damageLoss ?? "").trim();
  const damageLoss =
    damageLossRaw === "" ? 0 : parseServiceAmount(values.damageLoss, "ড্যামেজ ক্ষতি");
  const damageNote = optionalNote(values.damageNote, "ড্যামেজ নোট");
  const deliveryDateRaw = String(values.deliveryDate ?? "").trim();
  if (deliveryDateRaw && !isDateKey(deliveryDateRaw)) {
    throw new Error("সঠিক ডেলিভারি তারিখ দিন");
  }
  const deliveryDate = deliveryDateRaw
    ? serviceDateFromKey(deliveryDateRaw)
    : null;
  const serviceDateKey =
    values.serviceDate && values.serviceDate.trim() !== ""
      ? values.serviceDate.trim()
      : dhakaDateKey(new Date());
  if (!isDateKey(serviceDateKey)) {
    throw new Error("সঠিক তারিখ দিন");
  }

  return {
    customerName,
    phone,
    model,
    technician,
    problem,
    totalBill,
    advance,
    due: computeDue(totalBill, advance),
    status,
    shopExpense,
    expenseAmount,
    partsShop,
    damageLoss,
    damageNote,
    deliveryDate,
    serviceDateKey,
    serviceDate: serviceDateFromKey(serviceDateKey),
  };
}

/** Normalize an API create body through the same validation as the UI form. */
export function validateServiceCreate(
  body: unknown,
  ctx?: ValidationContext
): ValidatedServicePayload {
  const raw = readBody(body);
  return validateServicePayload(
    {
      customerName: String(raw.customerName ?? ""),
      phone: String(raw.phone ?? ""),
      model: String(raw.model ?? ""),
      technician: String(raw.technician ?? ""),
      problem: String(raw.problem ?? ""),
      totalBill: String(raw.totalBill ?? ""),
      advance: String(raw.advance ?? ""),
      status:
        raw.status == null || raw.status === ""
          ? "In-Progress"
          : String(raw.status),
      shopExpense: String(raw.shopExpense ?? ""),
      partsShop: String(raw.partsShop ?? ""),
      damageLoss: String(raw.damageLoss ?? ""),
      damageNote: String(raw.damageNote ?? ""),
      deliveryDate:
        raw.deliveryDate == null || raw.deliveryDate === ""
          ? undefined
          : String(raw.deliveryDate),
      serviceDate:
        raw.serviceDate == null || raw.serviceDate === ""
          ? undefined
          : String(raw.serviceDate),
    },
    ctx
  );
}

export interface ValidatedServiceUpdate {
  customerName?: string;
  phone?: string;
  model?: string;
  technician?: string;
  problem?: string;
  status?: string;
  totalBill?: number;
  advance?: number;
  due?: number;
  shopExpense?: string | null;
  expenseAmount?: number;
  partsShop?: string | null;
  damageLoss?: number;
  damageNote?: string | null;
  deliveryDate?: Date | null;
  deliveredAt?: Date | null;
  serviceDate?: Date;
}

/** Partial-update validation for PUT /api/services/[id]. */
export function validateServiceUpdate(
  body: unknown,
  existing: { totalBill: number; advance: number; status?: string },
  ctx?: ValidationContext
): ValidatedServiceUpdate {
  const raw = readBody(body);
  const returned = existing.status === RETURNED_STATUS;
  const data: ValidatedServiceUpdate = {};

  if (returned && (raw.totalBill !== undefined || raw.advance !== undefined)) {
    throw new Error("ফেরত দেওয়া কাজের বিল বা জমা বদলানো যাবে না");
  }
  // Returned is terminal. A mistaken return is corrected by archiving/restore
  // or a future explicit reversal tool — never by a silent form save.
  if (returned && raw.status !== undefined) {
    throw new Error("ফেরত দেওয়া কাজের অবস্থা বদলানো যাবে না");
  }

  if (raw.customerName !== undefined) {
    data.customerName = requiredText(
      raw.customerName,
      "কাস্টমারের নাম আবশ্যক"
    );
  }
  if (raw.phone !== undefined) {
    data.phone = requiredText(raw.phone, "মোবাইল নম্বর আবশ্যক");
  }
  if (raw.model !== undefined) {
    data.model = requiredText(
      raw.model,
      ctx?.productSale ? "প্রোডাক্টের নাম আবশ্যক" : "মোবাইলের মডেল আবশ্যক"
    );
  }
  if (raw.technician !== undefined) {
    data.technician = validateTechnician(raw.technician, ctx);
  }
  if (raw.problem !== undefined) {
    data.problem = requiredText(
      raw.problem,
      ctx?.productSale ? "বিবরণ আবশ্যক" : "সমস্যা লিখুন"
    );
  }
  if (raw.status !== undefined) {
    data.status = validateStatus(raw.status);
  }
  if (raw.serviceDate !== undefined) {
    data.serviceDate = serviceDateFromKey(String(raw.serviceDate));
  }

  if (raw.totalBill !== undefined || raw.advance !== undefined) {
    const totalBill =
      raw.totalBill !== undefined
        ? parseServiceAmount(raw.totalBill, "মোট বিল")
        : existing.totalBill;
    const advance =
      raw.advance !== undefined
        ? parseServiceAmount(raw.advance, "জমা")
        : existing.advance;
    if (advance > totalBill) {
      throw new Error(OVERPAY_MESSAGE);
    }
    data.totalBill = totalBill;
    data.advance = advance;
    data.due = computeDue(totalBill, advance);
  }

  if (raw.partsShop !== undefined) {
    data.partsShop = optionalPartsShop(raw.partsShop);
  }

  if (raw.shopExpense !== undefined) {
    const normalizedExpense = normalizeShopExpense(raw.shopExpense);
    if (normalizedExpense.kind === "invalid") {
      throw new Error(
        normalizedExpense.error ?? "দোকান খরচে সঠিক সংখ্যা বা গোপন কোড দিন"
      );
    }
    data.shopExpense = normalizedExpense.stored;
    data.expenseAmount = normalizedExpense.amount ?? 0;
  }

  if (raw.damageLoss !== undefined) {
    data.damageLoss = parseServiceAmount(raw.damageLoss, "ড্যামেজ ক্ষতি");
  }
  if (raw.damageNote !== undefined) {
    data.damageNote = optionalNote(raw.damageNote, "ড্যামেজ নোট");
  }

  if (raw.deliveryDate !== undefined) {
    const text = String(raw.deliveryDate ?? "").trim();
    if (text && !isDateKey(text)) {
      throw new Error("সঠিক ডেলিভারি তারিখ দিন");
    }
    data.deliveryDate = text ? serviceDateFromKey(text) : null;
  }

  return data;
}
