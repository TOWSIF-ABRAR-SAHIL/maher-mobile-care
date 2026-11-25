import { NextRequest, NextResponse } from "next/server";
import { isInventoryValidationError } from "@/lib/inventory";
import { PaymentError } from "@/lib/payments";
import {
  applySupplierPayment,
  validateSupplierPayment,
} from "@/lib/purchases";
import { withStockTransaction } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** POST /api/purchases/payments — money out, oldest open bill first. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = validateSupplierPayment(body);
    const result = await withStockTransaction((tx) =>
      applySupplierPayment(tx, input)
    );
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof PaymentError || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/purchases/payments failed:", err);
    return NextResponse.json(
      { error: "সাপ্লায়ার পেমেন্ট সেভ করা যায়নি" },
      { status: 500 }
    );
  }
}
