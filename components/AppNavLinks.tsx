"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  LayoutDashboard,
  Package,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { NAV_LINKS, type NavKey } from "@/lib/nav-links";
import { cn } from "@/lib/utils";

/** Icons are presentation, so they stay here; destinations live in lib/nav-links. */
const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  service: Wrench,
  products: Package,
  parts: ClipboardList,
};

export function AppNavLinks({ className }: { className?: string }) {
  const pathname = usePathname() || "/service";

  return (
    <nav
      aria-label="প্রধান মেনু"
      data-testid="header-nav"
      className={cn(
        "grid w-full grid-cols-4 gap-1 rounded-xl border border-white/15 bg-white/[0.07] p-1",
        "md:inline-flex md:w-auto md:justify-self-center",
        className
      )}
    >
      {NAV_LINKS.map(({ key, href, label }) => {
        const Icon = ICONS[key];
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
                ? "bg-white text-maher-navy shadow-[0_1px_2px_0_rgb(16_24_40/0.28)]"
                : "text-white/80 hover:bg-white/10 hover:text-white"
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
