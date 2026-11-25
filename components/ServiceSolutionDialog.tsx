"use client";

import { useEffect, useState } from "react";
import { Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_SOLUTION_LENGTH } from "@/lib/service-validation";
import type { ServiceDTO } from "@/lib/types";
import { formatTaka } from "@/lib/utils";

/** `note` = edit the work-done note; `deliver` = note + handover together. */
export type SolutionDialogMode = "note" | "deliver";

/**
 * Small ledger dialog opened from the service list. The solution is written
 * when the repair is actually finished — usually at handover — and is internal
 * only (never on a receipt or a report). The API already accepts `solution` and
 * `status` in the same partial PUT, so this is UI only.
 */
export function ServiceSolutionDialog({
  service,
  mode,
  onClose,
  onChanged,
}: {
  service: ServiceDTO;
  mode: SolutionDialogMode;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [text, setText] = useState(service.solution ?? "");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Same suggestion source as the form: past solutions for this model+problem.
  useEffect(() => {
    const m = service.model.trim();
    const p = service.problem.trim();
    if (!m || !p) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ model: m, problem: p });
        const res = await fetch(`/api/services/solutions?${params.toString()}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(data?.solutions)) {
          setSuggestions(
            data.solutions.filter((s: unknown): s is string => typeof s === "string")
          );
        }
      } catch {
        // suggestions are optional — offline free text still works
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [service.model, service.problem]);

  const save = async (action: "note" | "deliver" | "deliver-only") => {
    if (saving) return;
    const solution = text.trim();
    if (action === "deliver" && !solution) {
      toast.error("সমাধান লিখুন, অথবা ‘শুধু ডেলিভারি দিন’ ব্যবহার করুন");
      return;
    }
    setSaving(true);
    try {
      // Blank text in note mode clears the field (the API treats "" as NULL).
      // Deliver-only deliberately omits `solution` so an existing note survives.
      const body: Record<string, unknown> = { solution };
      if (action !== "note") body.status = "Delivered";
      if (action === "deliver-only") delete body.solution;
      const res = await fetch(`/api/services/${service.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "সেভ করা যায়নি");
      toast.success(
        action === "deliver"
          ? "সমাধান সেভ হয়েছে — ডেলিভারিও দেওয়া হয়েছে"
          : action === "deliver-only"
            ? "ডেলিভারি দেওয়া হয়েছে"
            : "সমাধান সেভ হয়েছে"
      );
      // Keep the old one-click warning: a handed-over job can still have dues.
      if (action !== "note" && service.due > 0) {
        toast.warning(`ডেলিভারি হয়েছে — ${formatTaka(service.due)} বাকি আছে`);
      }
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        data-testid="service-solution-dialog"
        className="sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "deliver" ? "ডেলিভারির আগে সমাধান লিখুন" : "কী করা হলো (সমাধান)"}
          </DialogTitle>
          <DialogDescription>
            ID #{service.id} — {service.customerName} ({service.model})। এই নোট
            শুধু দোকানের খাতায় — রিসিট বা রিপোর্টে যাবে না।
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="svc-solution-note">কী করা হলো (সমাধান)</Label>
          <Textarea
            id="svc-solution-note"
            data-testid="svc-solution-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={MAX_SOLUTION_LENGTH}
            rows={4}
            placeholder="যেমন: ডিসপ্লে পরিবর্তন করে টেস্ট করা হয়েছে"
            className="resize-y text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            {text.length}/{MAX_SOLUTION_LENGTH} অক্ষর
          </p>
          {suggestions.length > 0 ? (
            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {suggestions.map((note) => (
                <button
                  key={note}
                  type="button"
                  title={note}
                  data-testid="svc-solution-suggestion"
                  onClick={() => setText(note.slice(0, MAX_SOLUTION_LENGTH))}
                  className="max-w-[14rem] shrink-0 truncate whitespace-nowrap rounded-full border border-maher-border bg-white px-2 py-0.5 text-[11px] font-medium text-maher-navy transition-colors hover:border-maher-navy/35 hover:bg-maher-surface"
                >
                  {note}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={saving}
            data-testid="svc-solution-cancel"
          >
            বাতিল
          </Button>
          {mode === "deliver" ? (
            <Button
              variant="secondary"
              disabled={saving}
              data-testid="svc-solution-deliver-only"
              onClick={() => void save("deliver-only")}
            >
              <Truck className="mr-1 h-4 w-4" />
              শুধু ডেলিভারি দিন
            </Button>
          ) : null}
          <Button
            disabled={saving || (mode === "deliver" && !text.trim())}
            data-testid={
              mode === "deliver" ? "svc-solution-save-and-deliver" : "svc-solution-save"
            }
            onClick={() => void save(mode === "deliver" ? "deliver" : "note")}
          >
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            {mode === "deliver"
              ? "সমাধান + ডেলিভারি"
              : saving
                ? "সেভ হচ্ছে…"
                : "সংরক্ষণ করুন"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
