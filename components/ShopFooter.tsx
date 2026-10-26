import { MapPin, Phone, ShieldCheck } from "lucide-react";
import { SHOP } from "@/lib/shop";
import { cn } from "@/lib/utils";

/** The shop's public signature line, shared by every page. */
export function ShopFooter({ className }: { className?: string }) {
  return (
    <footer
      className={cn(
        "mx-auto w-full max-w-7xl px-3 pb-6 xl:max-w-[1440px] 2xl:max-w-[1600px] print:hidden",
        className
      )}
    >
      <div className="overflow-hidden rounded-xl border border-maher-border bg-white shadow-sm">
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-[0.04em] text-maher-navy">
              {SHOP.name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {SHOP.tagline} — দৈনিক সার্ভিস ট্র্যাকার
            </p>
          </div>
          <div className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-5">
            <span className="inline-flex items-start gap-1.5">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-maher-navy" />
              {SHOP.address}
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold text-maher-navy">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {SHOP.phone}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-maher-done" />
              ১০০% অফলাইন
            </span>
          </div>
        </div>
        <div className="border-t border-maher-border bg-maher-surface px-4 py-2 text-center text-[11px] text-muted-foreground sm:text-left">
          ডেটা আপনার পিসিতেই থাকে — ব্যাকআপ ও রিস্টোর সার্ভিস পেজ থেকে।
        </div>
      </div>
    </footer>
  );
}
