import { NextRequest, NextResponse } from "next/server";
import { isInventoryValidationError } from "@/lib/inventory";
import { PaymentError } from "@/lib/payments";
import {
  createPurchase,
  listPurchases,
  validatePurchase,
} from "@/lib/purchases";
import { PartConflictError } from "@/lib/parts-data";
import { withStockTransaction } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** GET /api/purchases — supplier bills + a money summary. */
export async function GET() {
  try {
    const purchases = await listPurchases();
    const summary = purchases.reduce(
      (acc, purchase) => {
        acc.count += 1;
        acc.total += purchase.total;
        acc.paid += purchase.paid;
        acc.due += purchase.due;
        return acc;
      },
      { count: 0, total: 0, paid: 0, due: 0 }
    );
    return NextResponse.json({ purchases, summary });
  } catch (err) {
    console.error("GET /api/purchases failed:", err);
    return NextResponse.json({ error: "ক্রয় তালিকা আনা যায়নি" }, { status: 500 });
  }
}

/** POST /api/purchases — receives stock and records the supplier bill. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = validatePurchase(body);
    const result = await withStockTransaction((tx) => createPurchase(tx, input));
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    if (err instanceof PartConflictError) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 409 }
      );
    }
    if (err instanceof PaymentError || isInventoryValidationError(err)) {
      return NextResponse.json(
        { error: (err as Error).message },
        { status: 400 }
      );
    }
    console.error("POST /api/purchases failed:", err);
    return NextResponse.json({ error: "ক্রয় সেভ করা যায়নি" }, { status: 500 });
  }
}
