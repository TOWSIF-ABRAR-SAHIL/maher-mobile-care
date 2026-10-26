"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "ড্যাশবোর্ড", icon: LayoutDashboard },
  { href: "/products", label: "প্রোডাক্টস", icon: Boxes },
] as const;

/**
 * Compact module switcher shown inside the navy header on every page.
 * `/products` and any future inventory sub-route light up together.
 */
export function AppNavLinks({ className }: { className?: string }) {
  const pathname = usePathname() || "/";

  return (
    <nav
      aria-label="প্রধান মেনু"
      className={cn(
        "inline-flex w-fit items-center gap-0.5 rounded-lg bg-white/10 p-0.5",
        className
      )}
    >
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-[22px] items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition-colors sm:text-xs",
              active
                ? "bg-white text-maher-navy shadow-sm"
                : "text-white/70 hover:bg-white/10 hover:text-white"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-nowrap">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
