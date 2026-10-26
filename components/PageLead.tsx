import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A page's opening statement: one eyebrow, one title, one sentence, and the
 * actions that belong to the whole page. Deliberately quieter than a card so
 * the first real workflow panel carries the weight.
 */
export function PageLead({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="ledger-eyebrow">{eyebrow}</p> : null}
        {title ? (
          <div
            className={cn(
              "flex flex-wrap items-baseline gap-x-3 gap-y-1",
              eyebrow && "mt-1"
            )}
          >
            <h1 className="text-xl font-bold tracking-tight text-maher-ink sm:text-2xl">
              {title}
            </h1>
            {meta ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {meta}
              </div>
            ) : null}
          </div>
        ) : null}
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          data-testid="page-actions"
          className="flex flex-wrap items-center gap-2 print:hidden"
        >
          {actions}
        </div>
      ) : null}
    </section>
  );
}
