"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STATUS_BN,
  STATUSES,
  FALLBACK_TECHNICIANS,
  computeDue,
  formatTaka,
  parseBnNumber,
} from "@/lib/utils";
import { validateServicePayload } from "@/lib/service-validation";
import type { ServiceDTO } from "@/lib/types";

const empty = {
  customerName: "",
  phone: "",
  model: "",
  // Filled from the fetched roster on mount (see the reconciliation effect) —
  // there is no hardcoded default name any more.
  technician: "",
  problem: "",
  totalBill: "",
  advance: "",
  status: "In-Progress",
  shopExpense: "",
  serviceDate: "",
};

/**
 * Build form state from a row. Used in useState initializer (NOT an effect):
 * the parent remounts this form per editing id (key), so values are correct
 * from the very first render. Setting Select values in an effect instead
 * makes Radix fire onValueChange("") and silently wipe technician/status.
 */
function toForm(s: ServiceDTO) {
  return {
    customerName: s.customerName,
    phone: s.phone,
    model: s.model,
    technician: s.technician,
    problem: s.problem,
    totalBill: String(s.totalBill),
    advance: String(s.advance),
    status: s.status,
    shopExpense: s.shopExpense ?? "",
    serviceDate: s.serviceDate.slice(0, 10),
  };
}

export function ServiceForm({
  initial,
  serviceDate,
  technicians,
  onSaved,
  onCancelEdit,
}: {
  /** Service being edited, or null for a new entry. */
  initial: ServiceDTO | null;
  /** Selected day (YYYY-MM-DD) — new entries are booked on this day. */
  serviceDate: string;
  /** Active roster from /api/technicians. */
  technicians: string[];
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const [f, setF] = useState(() => (initial ? toForm(initial) : empty));
  const [saving, setSaving] = useState(false);
  // A ref, not the `saving` state: three clicks inside one tick all see
  // saving===false because React has not re-rendered yet, which created three
  // duplicate entries. The ref flips synchronously.
  const savingRef = useRef(false);
  const editing = initial !== null;

  /**
   * Options = active roster, PLUS the edited row's own technician when that
   * person has since been deactivated (F11). Without this, saving an old job of
   * a technician who left the shop would silently reassign the job to somebody
   * else, because their name is no longer selectable.
   */
  const techOptions = useMemo(() => {
    const active = technicians.length > 0 ? technicians : [...FALLBACK_TECHNICIANS];
    const current = initial?.technician ?? "";
    if (!current || active.includes(current)) return active;
    return [...active, current];
  }, [technicians, initial?.technician]);

  const isInactiveOption = useMemo(
    () =>
      technicians.length > 0 &&
      !!initial?.technician &&
      !technicians.includes(initial.technician),
    [technicians, initial?.technician]
  );

  // Roster changed under an open form (rename/delete elsewhere): keep the
  // stored value if it is still offered, otherwise fall back to the first one.
  useEffect(() => {
    setF((prev) => {
      const stillValid = techOptions.includes(prev.technician);
      const next = stillValid ? prev.technician : techOptions[0] ?? "";
      return stillValid || next === prev.technician
        ? prev
        : { ...prev, technician: next };
    });
  }, [techOptions]);

  const set = (key: keyof typeof empty) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const billNum = parseBnNumber(f.totalBill) ?? 0;
  const advNum = parseBnNumber(f.advance) ?? 0;
  const due = computeDue(billNum, advNum);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;

    let payload;
    try {
      payload = validateServicePayload(
        {
          customerName: f.customerName,
          phone: f.phone,
          model: f.model,
          technician: f.technician,
          problem: f.problem,
          totalBill: f.totalBill,
          advance: f.advance,
          status: f.status,
          shopExpense: f.shopExpense,
          serviceDate: editing ? f.serviceDate : serviceDate,
        },
        // An inactive technician's own historical job stays editable, so the
        // option list (not the active-only roster) is what we validate against.
        { allowedTechnicians: techOptions }
      );
    } catch (err) {
      return toast.error(
        err instanceof Error ? err.message : "সঠিক তথ্য দিন"
      );
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const body = {
        customerName: payload.customerName,
        phone: payload.phone,
        model: payload.model,
        technician: payload.technician,
        problem: payload.problem,
        totalBill: payload.totalBill,
        advance: payload.advance,
        status: payload.status,
        shopExpense: payload.shopExpense ?? "",
        serviceDate: editing ? payload.serviceDateKey : serviceDate,
      };
      const res = await fetch(
        editing ? `/api/services/${initial!.id}` : "/api/services",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "সেভ করা যায়নি");
      toast.success(editing ? "আপডেট হয়েছে" : "সেভ হয়েছে");
      // Reset with a valid technician: the roster-change effect below only runs
      // when `techOptions` changes, so a plain `setF(empty)` left the select
      // blank and the NEXT save failed with "সঠিক টেকনিশিয়ান বাছুন".
      if (!editing) setF({ ...empty, technician: techOptions[0] ?? "" });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "সেভ করা যায়নি");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border bg-white p-4 shadow-md print:hidden">
      <h2 className="mb-3 text-base font-semibold tracking-tight text-gray-800">
        ➕ নতুন সার্ভিস এন্ট্রি
      </h2>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="svc-name">কাস্টমারের নাম</Label>
          <Input id="svc-name" value={f.customerName} onChange={set("customerName")} />
        </div>
        <div>
          <Label htmlFor="svc-phone">মোবাইল নম্বর (WhatsApp)</Label>
          <Input
            id="svc-phone"
            value={f.phone}
            onChange={set("phone")}
            placeholder="017xxxxxxxx"
            inputMode="tel"
          />
        </div>
        <div>
          <Label htmlFor="svc-model">মোবাইলের মডেল</Label>
          <Input
            id="svc-model"
            value={f.model}
            onChange={set("model")}
            placeholder="যেমন: Redmi Note 10"
          />
        </div>
        <div>
          <Label>টেকনিশিয়ান</Label>
          <Select
            value={f.technician}
            onValueChange={(v) => {
              // Belt-and-braces: Radix can emit "" for a controlled value
              // whose item never mounted — never accept a blank.
              if (!v) return;
              setF((p) => ({ ...p, technician: v }));
            }}
          >
            <SelectTrigger id="svc-tech">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {techOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                  {isInactiveOption && t === initial?.technician
                    ? " (নিষ্ক্রিয়)"
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="svc-problem">সমস্যা</Label>
          <Input
            id="svc-problem"
            value={f.problem}
            onChange={set("problem")}
            placeholder="যেমন: ডিসপ্লে পরিবর্তন"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="svc-bill">মোট বিল (৳)</Label>
            <Input
              id="svc-bill"
              value={f.totalBill}
              onChange={set("totalBill")}
              placeholder="0"
              inputMode="numeric"
            />
          </div>
          <div>
            <Label htmlFor="svc-adv">জমা (৳)</Label>
            <Input
              id="svc-adv"
              value={f.advance}
              onChange={set("advance")}
              placeholder="0"
              inputMode="numeric"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="svc-due">বাকি (৳)</Label>
            <Input
              id="svc-due"
              value={formatTaka(due).replace("৳", "").trim()}
              readOnly
              className="bg-gray-50 font-semibold"
            />
          </div>
          <div>
            <Label>কাজের অবস্থা</Label>
            <Select
              value={f.status}
              onValueChange={(v) => {
                if (!v) return;
                setF((p) => ({ ...p, status: v }));
              }}
            >
              <SelectTrigger id="svc-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_BN[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="svc-expense">দোকান খরচ (কোড বা সংখ্যা)</Label>
          <Input
            id="svc-expense"
            value={f.shopExpense}
            onChange={set("shopExpense")}
            placeholder="যেমন: *M# বা 1600"
          />
        </div>
        {editing ? (
          <div>
            <Label htmlFor="svc-date">তারিখ (ভুল দিনে হলে বদলান)</Label>
            <Input
              id="svc-date"
              type="date"
              value={f.serviceDate}
              onChange={set("serviceDate")}
            />
          </div>
        ) : null}
        {editing ? (
          <div className="flex gap-2">
            <Button type="submit" className="flex-1 bg-blue-700 hover:bg-blue-800" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "আপডেট করুন"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancelEdit}>
              বাতিল
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            className="w-full bg-blue-700 text-base hover:bg-blue-800"
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "সেভ করুন"}
          </Button>
        )}
      </form>
    </section>
  );
}
