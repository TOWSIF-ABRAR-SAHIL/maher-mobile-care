import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  applyCustomerPayment,
  customerKey,
  customerLedger,
  PaymentError,
  validateCustomerPayment,
} from "@/lib/payments";
import { isInventoryValidationError } from "@/lib/inventory";
import { withStockTransaction } from "@/lib/stock";

export const dynamic = "force-dynamic";

/**
 * GET /api/payments?phone=…&name=…
 * With a customer, returns their open slips + recent receipts. Without one,
 * returns the newest receipts for the shop's payment history.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const phone = sp.get("phone") ?? "";
    const name = sp.get("name") ?? "";
    if (phone.trim() || name.trim()) {
      const ledger = await customerLedger(customerKey(phone, name));
      return NextResponse.json(ledger);
    }
    const payments = await prisma.payment.findMany({
      orderBy: [{ paidAt: "desc" }, { id: "desc" }],
      take: 50,
      include: {
        allocations: {
          orderBy: { id: "asc" },
          select: { serviceId: true, amount: true },
        },
      },
    });
    return NextResponse.json({ payments });
  } catch (err) {
    console.error("GET /api/payments failed:", err);
    return NextResponse.json(
      { error: "পেমেন্ট আনা যায়নি" },
      { status: 500 }
    );
  }
}

/** POST /api/payments — one customer receipt, allocated oldest slip first. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = validateCustomerPayment(body);
    const result = await withStockTransaction((tx) =>
      applyCustomerPayment(tx, input)
    );
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/payments failed:", err);
    return NextResponse.json(
      { error: "পেমেন্ট সেভ করা যায়নি" },
      { status: 500 }
    );
  }
}
