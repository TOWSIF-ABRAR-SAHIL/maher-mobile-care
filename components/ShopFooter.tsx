"use client";

import { MapPin, Phone, ShieldCheck } from "lucide-react";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import { cn } from "@/lib/utils";

export const FOOTER_SETUP_FALLBACK =
  "দোকানের নাম সেটআপ করুন • মোবাইল সার্ভিস ও বিক্রয় কেন্দ্র";

/** The shop's public signature line, shared by every page. */
export function ShopFooter({ className }: { className?: string }) {
  const { settings } = useShopSettings();
  const configured = !!settings.shopName.trim();
  const brandLine = configured ? settings.shopName : FOOTER_SETUP_FALLBACK;
  return (
    <footer
      className={cn(
        "mx-auto w-full max-w-7xl px-3 pb-4 xl:max-w-[1600px] 2xl:max-w-[1840px] print:hidden",
        className
      )}
    >
      <div className="overflow-hidden rounded-xl border border-maher-border bg-white shadow-card sheen">
        <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-[0.04em] text-maher-navy">
              {brandLine}
            </p>
            {configured && settings.slogan ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {settings.slogan} — দৈনিক সার্ভিস ট্র্যাকার
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1.5">
            {settings.address ? (
              <span className="inline-flex items-start gap-1.5">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-maher-navy" />
                {settings.address}
              </span>
            ) : null}
            {settings.phone ? (
              <span className="inline-flex items-center gap-1.5 font-semibold text-maher-navy">
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {settings.phone}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-maher-done" />
              ১০০% অফলাইন
            </span>
            <span className="hidden items-center gap-1.5 xl:inline-flex">
              ডেটা এই পিসিতেই — ব্যাকআপ/রিস্টোর ড্যাশবোর্ডে।
            </span>
          </div>
        </div>
        <div className="border-t border-maher-border bg-maher-surface px-4 py-1.5 text-center text-[11px] text-muted-foreground xl:hidden">
          ডেটা এই পিসিতেই — ব্যাকআপ/রিস্টোর ড্যাশবোর্ডে।
        </div>
      </div>
    </footer>
  );
}
