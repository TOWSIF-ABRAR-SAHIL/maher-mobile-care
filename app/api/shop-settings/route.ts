import { NextRequest, NextResponse } from "next/server";
import {
  getShopSettings,
  saveShopSettings,
  ShopSettingsError,
  type ShopSettingsInput,
} from "@/lib/shop-settings";

// Branding must never be cached: the header/footer/receipt read it live.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ settings: await getShopSettings() });
  } catch (err) {
    console.error("GET /api/shop-settings failed:", err);
    return NextResponse.json({ settings: null }, { status: 200 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as ShopSettingsInput;
    const settings = await saveShopSettings(body ?? {});
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof ShopSettingsError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PUT /api/shop-settings failed:", err);
    // Expose the real backend failure so the dashboard never hides it behind
    // the generic fallback toast.
    const error =
      err instanceof Error && err.message
        ? err.message
        : "সেটিংস সংরক্ষণ করা যায়নি";
    return NextResponse.json({ error }, { status: 500 });
  }
}
