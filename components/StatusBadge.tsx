import { Badge } from "@/components/ui/badge";
import { STATUS_BN, cn } from "@/lib/utils";

/**
 * Status chips: one tint per state from the Maher palette, with a matching
 * border so status stays readable even where the row tint already applies.
 * navy = in progress, money = returned, done = completed, due = pending.
 */
const CLASSES: Record<string, string> = {
  Pending:
    "border-maher-due/30 bg-maher-due/10 text-maher-due hover:bg-maher-due/10",
  "In-Progress":
    "border-maher-navy/30 bg-maher-navy/10 text-maher-navy hover:bg-maher-navy/10",
  Completed:
    "border-maher-done/40 bg-maher-done/10 text-maher-done hover:bg-maher-done/10",
  Delivered:
    "border-maher-border bg-maher-surface text-muted-foreground hover:bg-maher-surface",
  Returned:
    "border-maher-money/40 bg-maher-money/10 text-maher-money hover:bg-maher-money/10",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn(CLASSES[status] ?? CLASSES.Pending)}>
      {(STATUS_BN as Record<string, string>)[status] ?? status}
    </Badge>
  );
}
