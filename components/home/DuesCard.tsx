import { ArrowRight, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DuesResponse } from "@/components/OutstandingDues";
import { cn, formatTaka, toBnDigits } from "@/lib/utils";

/**
 * All-date outstanding balances. Deliberately labelled as historical scope:
 * this is not today's newly generated debt, and the drill-down list is the
 * existing dues dialog.
 */
export function DuesCard({
  dues,
  loading,
  onOpen,
}: {
  dues: DuesResponse | null;
  loading: boolean;
  onOpen: () => void;
}) {
  const clear = !!dues && dues.count === 0;

  return (
    <section
      data-testid="home-dues"
      aria-labelledby="home-dues-title"
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-maher-border bg-white",
        !clear && dues ? "border-t-2 border-t-maher-due" : ""
      )}
    >
      <div className="flex items-start justify-between gap-2 border-b border-maher-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <HandCoins
            className={cn(
              "h-3.5 w-3.5",
              clear ? "text-maher-done" : "text-maher-due"
            )}
          />
          <div>
            <h2
              id="home-dues-title"
              className="text-[13px] font-semibold tracking-tight text-maher-ink"
            >
              বাকি তালিকা
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              সব তারিখের অপরিশোধিত বিল
            </p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            clear
              ? "bg-emerald-50 text-emerald-700"
              : "bg-maher-due/10 text-maher-due"
          )}
        >
          {dues ? `${toBnDigits(dues.count)}টি` : loading ? "…" : "—"}
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <p
            className={cn(
              "text-[30px] font-extrabold leading-none tracking-tight tabular-nums",
              clear ? "text-emerald-700" : "text-maher-due"
            )}
          >
            {dues ? (clear ? "সব পরিশোধিত" : formatTaka(dues.totalDue)) : "…"}
          </p>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {clear
              ? "কোনো সার্ভিসে বাকি নেই।"
              : "পুরোনো বিলও এই তালিকায় আছে।"}
          </p>
        </div>

        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="open-dues"
          onClick={onOpen}
          className="mt-4 w-full justify-between border-maher-due/25 bg-white text-maher-due hover:bg-maher-due/10"
        >
          বাকি তালিকা খুলুন
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  );
}
