import { dhakaDateKey, isDateKey, serviceDateFromKey } from "./dhaka";
import { STATUSES, TECHNICIANS, computeDue, parseBnNumber } from "./utils";

/** Matches every user-facing validation error thrown by this module. */
export const SERVICE_VALIDATION_PATTERN =
  /আবশ্যক|বাছুন|লিখুন|দিন|বেশি|সঠিক সংখ্যা|সঠিক তারিখ|ভুল ডেটা|must be|Invalid date/;

/** Advance (জমা) may never exceed the bill — cash above the bill is change,
 *  which belongs in the form's calculator and never in the ledger. */
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
  serviceDate?: string;
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

function validateTechnician(value: unknown): string {
  const technician = String(value ?? "").trim();
  if (!(TECHNICIANS as readonly string[]).includes(technician)) {
    throw new Error("সঠিক টেকনিশিয়ান বাছুন");
  }
  return technician;
}

function validateStatus(value: unknown): string {
  const status = String(value ?? "").trim();
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new Error("সঠিক অবস্থা বাছুন");
  }
  return status;
}

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
  return Math.floor(parsed);
}

/**
 * Shared create/edit-form validation. The dashboard form calls this before
 * sending a request, and POST /api/services uses it as well, so API clients
 * and the UI can never drift into different validation rules.
 */
export function validateServicePayload(
  values: ServiceFormValues
): ValidatedServicePayload {
  const customerName = requiredText(values.customerName, "কাস্টমারের নাম দিন");
  const phone = requiredText(values.phone, "মোবাইল নম্বর দিন");
  const model = requiredText(values.model, "মোবাইলের মডেল দিন");
  const technician = validateTechnician(values.technician);
  const problem = requiredText(values.problem, "সমস্যা লিখুন");
  const status = validateStatus(values.status);
  const totalBill = parseServiceAmount(values.totalBill, "মোট বিল");
  const advanceRaw = String(values.advance ?? "").trim();
  const advance =
    advanceRaw === "" ? 0 : parseServiceAmount(values.advance, "জমা");
  if (advance > totalBill) {
    throw new Error(OVERPAY_MESSAGE);
  }

  const shopExpenseRaw = String(values.shopExpense ?? "").trim();
  const shopExpense = shopExpenseRaw ? shopExpenseRaw : null;
  const expenseAmount = parseBnNumber(shopExpenseRaw) ?? 0;
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
    serviceDateKey,
    serviceDate: serviceDateFromKey(serviceDateKey),
  };
}

/** Normalize an API create body through the same validation as the UI form. */
export function validateServiceCreate(body: unknown): ValidatedServicePayload {
  const raw = readBody(body);
  return validateServicePayload({
    customerName: String(raw.customerName ?? ""),
    phone: String(raw.phone ?? ""),
    model: String(raw.model ?? ""),
    technician: String(raw.technician ?? ""),
    problem: String(raw.problem ?? ""),
    totalBill: String(raw.totalBill ?? ""),
    advance: String(raw.advance ?? ""),
    status:
      raw.status == null || raw.status === "" ? "Pending" : String(raw.status),
    shopExpense: String(raw.shopExpense ?? ""),
    serviceDate:
      raw.serviceDate == null || raw.serviceDate === ""
        ? undefined
        : String(raw.serviceDate),
  });
}

export interface ValidatedServiceUpdate {
  customerName?: string;
  phone?: string;
  model?: string;
  technician?: string;
  problem?: string;
  status?: string;
  totalBill: number;
  advance: number;
  due: number;
  shopExpense?: string | null;
  expenseAmount?: number;
  serviceDate?: Date;
}

/** Partial-update validation for PUT /api/services/[id]. */
export function validateServiceUpdate(
  body: unknown,
  existing: { totalBill: number; advance: number }
): ValidatedServiceUpdate {
  const raw = readBody(body);
  const data: ValidatedServiceUpdate = {
    totalBill: existing.totalBill,
    advance: existing.advance,
    due: computeDue(existing.totalBill, existing.advance),
  };

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
    data.model = requiredText(raw.model, "মোবাইলের মডেল আবশ্যক");
  }
  if (raw.technician !== undefined) {
    data.technician = validateTechnician(raw.technician);
  }
  if (raw.problem !== undefined) {
    data.problem = requiredText(raw.problem, "সমস্যা লিখুন");
  }
  if (raw.status !== undefined) {
    data.status = validateStatus(raw.status);
  }
  if (raw.serviceDate !== undefined) {
    data.serviceDate = serviceDateFromKey(String(raw.serviceDate));
  }

  if (raw.totalBill !== undefined) {
    data.totalBill = parseServiceAmount(raw.totalBill, "মোট বিল");
  }
  if (raw.advance !== undefined) {
    data.advance = parseServiceAmount(raw.advance, "জমা");
  }
  data.due = computeDue(data.totalBill, data.advance);
  if (data.advance > data.totalBill) {
    throw new Error(OVERPAY_MESSAGE);
  }

  if (raw.shopExpense !== undefined) {
    const shopExpenseRaw = String(raw.shopExpense ?? "").trim();
    data.shopExpense = shopExpenseRaw ? shopExpenseRaw : null;
    data.expenseAmount = parseBnNumber(shopExpenseRaw) ?? 0;
  }

  return data;
}
