"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ServiceDTO } from "@/lib/types";

/**
 * View-only card for the customer terms already saved on a service. Unlike the
 * internal work-done note, these terms are printed on the receipt, so no edit
 * affordance is offered here — the form remains the place to change them.
 */
export function ServiceConditionDialog({
  service,
  onClose,
}: {
  service: ServiceDTO;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent data-testid="service-condition-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>কাস্টমারের শর্ত</DialogTitle>
          <DialogDescription>
            ID #{service.id} — {service.customerName} ({service.model})
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="svc-condition-view"
          className="max-h-[45dvh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-maher-border bg-maher-surface px-3 py-2 text-sm leading-relaxed text-foreground"
        >
          {service.condition}
        </div>
        <p className="text-[11px] text-muted-foreground">
          রিসিট/স্লিপে ছাপা হয়; এখান থেকে বদলানো যাবে না।
        </p>

        <DialogFooter>
          <Button
            data-testid="svc-condition-close"
            onClick={onClose}
            className="bg-maher-navy hover:bg-maher-navy-light"
          >
            বন্ধ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
