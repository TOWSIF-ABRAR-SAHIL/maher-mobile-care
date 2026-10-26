import { AppNavLinks } from "@/components/AppNavLinks";

/** Compact navy header for the inventory page. Keeps the same brand block
 *  and module switcher as the dashboard without inventing a second navbar. */
export function ProductsHeader() {
  return (
    <header className="sticky top-0 z-40 rounded-xl border-b border-maher-navy/60 bg-maher-navy px-3 py-2.5 text-white shadow-sm print:hidden">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
            MAHER MOBILE CARE
          </h1>
          <p className="text-xs text-white/70 sm:text-sm">
            প্রোডাক্ট ইনভেন্টরি ও স্টক ম্যানেজমেন্ট
          </p>
        </div>
        <AppNavLinks />
      </div>
    </header>
  );
}
