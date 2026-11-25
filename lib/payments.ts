/**
 * Customer payments ("টাকা নিন") — money in.
 *
 * A customer is a phone number, not a table: the key is the normalized phone
 * digits, falling back to `name:<exact trimmed name>` when the phone has no
 * digits. A payment is allocated to that customer's unpaid slips oldest-first,
 * and it may never exceed the total outstanding balance (no overpay, no
 * negative due). "Paid" stays derived from `due === 0` — there is no sixth
 * status and no `paid` column.
 */
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "./prisma";
import { computeDue } from "./utils";
import {
  optionalInventoryText,
  parseInventoryInt,
  requiredInventoryText,
} from "./inventory";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  customerKey,
  isSameCustomer,
  phoneDigits,
  type PaymentMethod,
} from "./payment-methods";
import { resyncAnchorAdvance } from "./stock";

type Tx = Prisma.TransactionClient;

export {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  customerKey,
  isSameCustomer,
  phoneDigits,
  type PaymentMethod,
};

/** User-facing payment errors are all 400s, never 500s. */
export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface ValidatedPayment {
  phone: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
}

/** Accepts the stored code or its Bengali label, case-insensitively. */
export function normalizePaymentMethod(value: unknown): PaymentMethod {
  const raw = String(value ?? "").trim();
  if (!raw) return "CASH";
  const upper = raw.toUpperCase();
  if ((PAYMENT_METHODS as readonly string[]).includes(upper)) {
    return upper as PaymentMethod;
  }
  const byLabel = PAYMENT_METHODS.find(
    (code) => PAYMENT_METHOD_LABEL[code] === raw
  );
  if (byLabel) return byLabel;
  throw new PaymentError("সঠিক পেমেন্ট মাধ্যম বাছুন");
}

export function validateCustomerPayment(body: unknown): ValidatedPayment {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new PaymentError("ভুল ডেটা পাঠানো হয়েছে");
  }
  const raw = body as Record<string, unknown>;
  const customerName = requiredInventoryText(
    raw.customerName,
    "কাস্টমারের নাম",
    120
  );
  const phone = String(raw.phone ?? "").trim();
  if (phone.length > 40) {
    throw new PaymentError("ফোন নম্বর ৪০ অক্ষরের বেশি হতে পারবে না");
  }
  if (!phoneDigits(phone) && !customerName) {
    throw new PaymentError("কাস্টমার চেনার জন্য ফোন বা নাম দিন");
  }
  return {
    phone,
    customerName,
    amount: parseInventoryInt(raw.amount, "টাকার পরিমাণ", { min: 1 }),
    method: normalizePaymentMethod(raw.method),
    note: optionalInventoryText(raw.note, "নোট", 300),
  };
}

export interface OutstandingSlip {
  id: number;
  customerName: string;
  phone: string;
  model: string;
  status: string;
  entryKind: string;
  serviceDate: Date;
  totalBill: number;
  advance: number;
  due: number;
}

/** Every unpaid, non-returned slip of one customer, oldest first. */
export async function outstandingSlips(
  tx: Tx,
  key: string
): Promise<OutstandingSlip[]> {
  const rows = await tx.service.findMany({
    where: {
      archived: false,
      status: { not: "Returned" },
      due: { gt: 0 },
    },
    orderBy: [{ serviceDate: "asc" }, { id: "asc" }],
    select: {
      id: true,
      customerName: true,
      phone: true,
      model: true,
      status: true,
      entryKind: true,
      serviceDate: true,
      totalBill: true,
      advance: true,
      due: true,
    },
  });
  return rows.filter((row) => isSameCustomer(row, key));
}

export interface PaymentAllocationResult {
  paymentId: number;
  customerKey: string;
  amount: number;
  allocations: { serviceId: number; amount: number }[];
}

/**
 * Creates one payment and settles the customer's open slips oldest-first.
 * Throws when the amount exceeds the outstanding balance, so `due` can never
 * go negative and a slip can never be overpaid.
 */
export async function applyCustomerPayment(
  tx: Tx,
  input: ValidatedPayment
): Promise<PaymentAllocationResult> {
  const key = customerKey(input.phone, input.customerName);
  const slips = await outstandingSlips(tx, key);
  const totalDue = slips.reduce((sum, slip) => sum + slip.due, 0);
  if (totalDue <= 0) {
    throw new PaymentError("এই কাস্টমারের কোনো বাকি নেই");
  }
  if (input.amount > totalDue) {
    throw new PaymentError(
      `বাকির চেয়ে বেশি টাকা নেওয়া যাবে না (মোট বাকি ৳${totalDue})`
    );
  }

  const payment = await tx.payment.create({
    data: {
      customerKey: key,
      customerName: input.customerName,
      phone: input.phone,
      amount: input.amount,
      method: input.method,
      note: input.note,
    },
    select: { id: true },
  });

  const allocations: { serviceId: number; amount: number }[] = [];
  let remaining = input.amount;
  for (const slip of slips) {
    if (remaining <= 0) break;
    const take = Math.min(slip.due, remaining);
    if (take <= 0) continue;
    const nextAdvance = slip.advance + take;
    await tx.service.update({
      where: { id: slip.id },
      data: {
        advance: nextAdvance,
        due: computeDue(slip.totalBill, nextAdvance),
      },
    });
    await tx.paymentAllocation.create({
      data: { paymentId: payment.id, serviceId: slip.id, amount: take },
    });
    // A product anchor's per-line waterfall must follow the new advance.
    await resyncAnchorAdvance(tx, slip.id);
    allocations.push({ serviceId: slip.id, amount: take });
    remaining -= take;
  }

  return {
    paymentId: payment.id,
    customerKey: key,
    amount: input.amount,
    allocations,
  };
}

/** Read-only view used by the payment dialog. */
export async function customerLedger(key: string) {
  return prisma.$transaction(async (tx) => {
    const [slips, payments] = await Promise.all([
      outstandingSlips(tx, key),
      tx.payment.findMany({
        where: { customerKey: key },
        orderBy: [{ paidAt: "desc" }, { id: "desc" }],
        take: 20,
        include: {
          allocations: {
            orderBy: { id: "asc" },
            select: { serviceId: true, amount: true },
          },
        },
      }),
    ]);
    return {
      customerKey: key,
      totalDue: slips.reduce((sum, slip) => sum + slip.due, 0),
      slips,
      payments,
    };
  });
}
