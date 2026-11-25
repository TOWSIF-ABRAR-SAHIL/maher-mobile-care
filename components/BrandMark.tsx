"use client";

import Link from "next/link";
import { Smartphone } from "lucide-react";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { cn } from "@/lib/utils";

/**
 * The shop's identity block in the brand-blue chrome. The monogram is
 * deliberately drawn like a counter stamp rather than a generic app logo: one
 * square, one handset, one live dot. Name and tagline come from ShopSettings;
 * an unconfigured shop sees the MSS setup hint, never a hardcoded store name.
 */
export const SHOP_NAME_FALLBACK = "MSS - শপ প্রোফাইল সেটআপ করুন";
export const SHOP_SLOGAN_FALLBACK = "মোবাইল সার্ভিস ও পার্টস ম্যানেজমেন্ট";

export function BrandMark({ className }: { className?: string }) {
  const { settings } = useShopSettings();
  const shopName = settings.shopName || SHOP_NAME_FALLBACK;
  const slogan = settings.slogan || SHOP_SLOGAN_FALLBACK;
  return (
    <Link
      href="/dashboard"
      aria-label={`${shopName} — ড্যাশবোর্ড`}
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        className
      )}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.08]">
        <Smartphone className="h-[18px] w-[18px] text-white" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-maher-done ring-2 ring-maher-navy" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold leading-tight tracking-[0.055em] text-white sm:text-base">
          {shopName}
        </span>
        <span className="block truncate text-[10px] leading-tight text-white/75 sm:text-[11px]">
          {slogan}
        </span>
      </span>
    </Link>
  );
}
