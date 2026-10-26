"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Package, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The three primary destinations. Kept to exactly three on purpose: the
 * counter workflow is Home → Service → Product, and anything else belongs
 * inside one of those pages.
 */
const LINKS = [
  { key: "home", href: "/", label: "হোম", icon: House },
  { key: "service", href: "/service", label: "সার্ভিস", icon: Wrench },
  { key: "products", href: "/products", label: "প্রোডাক্ট", icon: Package },
] as const;

export function AppNavLinks({ className }: { className?: string }) {
  const pathname = usePathname() || "/";

  return (
    <nav
      aria-label="প্রধান মেনু"
      data-testid="header-nav"
      className={cn(
        "grid w-full grid-cols-3 gap-1 rounded-lg border border-white/10 bg-white/[0.06] p-1",
        "md:inline-flex md:w-auto md:justify-self-center",
        className
      )}
    >
      {LINKS.map(({ key, href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            data-nav-item={key}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
              "md:h-8 md:justify-start md:px-3.5 md:text-[13px]",
              active
                ? "bg-white text-maher-navy shadow-sm"
                : "text-white/65 hover:bg-white/10 hover:text-white"
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
