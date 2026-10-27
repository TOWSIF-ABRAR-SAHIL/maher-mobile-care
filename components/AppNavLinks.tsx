"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The two primary destinations. The counter workflow is Service → Product;
 * reports, dues, backup and restore live inside the Service page rather than
 * taking another tab.
 */
const LINKS = [
  { key: "service", href: "/service", label: "সার্ভিস", icon: Wrench },
  { key: "products", href: "/products", label: "প্রোডাক্ট", icon: Package },
] as const;

export function AppNavLinks({ className }: { className?: string }) {
  const pathname = usePathname() || "/service";

  return (
    <nav
      aria-label="প্রধান মেনু"
      data-testid="header-nav"
      className={cn(
        "grid w-full grid-cols-2 gap-1 rounded-xl border border-white/20 bg-white/10 p-1",
        "md:inline-flex md:w-auto md:justify-self-center",
        className
      )}
    >
      {LINKS.map(({ key, href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            data-nav-item={key}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              "md:h-8 md:justify-start md:px-3.5 md:text-[13px]",
              active
                ? "bg-white text-maher-navy shadow-[0_4px_10px_-6px_rgb(9_30_110/0.9),inset_0_1px_0_0_rgb(255_255_255/0.9)]"
                : "text-white/85 hover:bg-white/15 hover:text-white"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
