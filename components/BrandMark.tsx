import Link from "next/link";
import { Smartphone } from "lucide-react";
import { SHOP } from "@/lib/shop";
import { cn } from "@/lib/utils";

/**
 * The shop's identity block in the brand-blue chrome. The monogram is
 * deliberately drawn like a counter stamp rather than a generic app logo: one
 * square, one handset, one live dot.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <Link
      href="/service"
      aria-label={`${SHOP.name} — সার্ভিস`}
      className={cn(
        "group flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
        className
      )}
    >
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/[0.06]">
        <Smartphone className="h-[18px] w-[18px] text-amber-300" />
        <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-maher-navy" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-bold leading-tight tracking-[0.055em] text-white sm:text-base">
          {SHOP.name}
        </span>
        <span className="block truncate text-[10px] leading-tight text-white/90 sm:text-[11px]">
          {SHOP.chromeTagline}
        </span>
      </span>
    </Link>
  );
}
