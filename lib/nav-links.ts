/**
 * The single source of truth for the top-level destinations.
 *
 * Kept as pure data (no React, no lucide) so adding or reordering a navbar
 * button never has to touch AppNavLinks — a shared component used by the live
 * header and reached from RootLayout. `scripts/nav-links.test.ts` pins this
 * list; the browser checks pin the rendered shape.
 */
export type NavKey = "dashboard" | "service" | "products" | "parts";

export interface NavLink {
  key: NavKey;
  href: `/${NavKey}`;
  label: string;
}

/** Dashboard → Service → Product → Parts: Home first, then the desk. */
export const NAV_LINKS: readonly NavLink[] = [
  { key: "dashboard", href: "/dashboard", label: "ড্যাশবোর্ড" },
  { key: "service", href: "/service", label: "সার্ভিস" },
  { key: "products", href: "/products", label: "প্রোডাক্ট" },
  { key: "parts", href: "/parts", label: "পার্টস" },
] as const;
