import Link from "next/link";
import {
  BarChart3,
  ClipboardList,
  HandCoins,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LINK_CLASS =
  "inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-maher-navy transition-colors hover:bg-white hover:text-maher-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/60";

/**
 * A quiet counter strip, not a second button bar. Only actions the app can
 * actually perform: the two list pages, the existing dues dialog and the
 * existing report dialog. "New service" is already the page's primary action,
 * and backup/restore live in the utilities card, so neither is repeated here.
 */
export function QuickActions({
  date,
  onOpenDues,
  onOpenReport,
}: {
  date: string;
  onOpenDues: () => void;
  onOpenReport: () => void;
}) {
  return (
    <section
      data-testid="home-quick-actions"
      aria-labelledby="home-quick-title"
      className="flex flex-wrap items-center gap-x-1 gap-y-1 px-1"
    >
      <h2
        id="home-quick-title"
        className="mr-1 text-[11px] font-semibold text-muted-foreground"
      >
        দ্রুত কাজ
      </h2>
      <span aria-hidden className="mr-1 hidden h-3 w-px bg-maher-border sm:block" />
      <Link href={`/service?date=${date}`} className={LINK_CLASS}>
        <ClipboardList className="h-3.5 w-3.5" />
        সার্ভিস তালিকা
      </Link>
      <Link href="/products" className={LINK_CLASS}>
        <Package className="h-3.5 w-3.5" />
        ইনভেন্টরি
      </Link>
      <button
        type="button"
        data-testid="quick-dues"
        onClick={onOpenDues}
        className={cn(LINK_CLASS, "text-maher-due hover:text-maher-due")}
      >
        <HandCoins className="h-3.5 w-3.5" />
        বাকি তালিকা
      </button>
      <button
        type="button"
        data-testid="quick-report"
        onClick={onOpenReport}
        className={LINK_CLASS}
      >
        <BarChart3 className="h-3.5 w-3.5" />
        রিপোর্ট
      </button>
    </section>
  );
}
