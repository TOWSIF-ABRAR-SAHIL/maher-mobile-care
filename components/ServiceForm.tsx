"use client";

import { useState } from "react";
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
  TECHNICIANS,
  computeDue,
  formatTaka,
  parseBnNumber,
} from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

const empty = {
  customerName: "",
  phone: "",
  model: "",
  technician: "NURUL",
  problem: "",
  totalBill: "",
  advance: "",
  status: "Pending",
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
  onSaved,
  onCancelEdit,
}: {
  /** Service being edited, or null for a new entry. */
  initial: ServiceDTO | null;
  /** Selected day (YYYY-MM-DD) — new entries are booked on this day. */
  serviceDate: string;
  onSaved: () => void;
  onCancelEdit: () => void;
}) {
  const [f, setF] = useState(() => (initial ? toForm(initial) : empty));
  const [saving, setSaving] = useState(false);
  const editing = initial !== null;

  const set = (key: keyof typeof empty) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  const billNum = parseBnNumber(f.totalBill) ?? 0;
  const advNum = parseBnNumber(f.advance) ?? 0;
  const due = computeDue(billNum, advNum);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!f.customerName.trim()) return toast.error("কাস্টমারের নাম দিন");
    if (!f.phone.trim()) return toast.error("মোবাইল নম্বর দিন");
    if (!f.model.trim()) return toast.error("মোবাইলের মডেল দিন");
    if (!f.problem.trim()) return toast.error("সমস্যা লিখুন");
    if (!(TECHNICIANS as readonly string[]).includes(f.technician)) {
      return toast.error("সঠিক টেকনিশিয়ান বাছুন");
    }
    if (!(STATUSES as readonly string[]).includes(f.status)) {
      return toast.error("সঠিক অবস্থা বাছুন");
    }
    const totalBill = parseBnNumber(f.totalBill);
    if (totalBill === null) return toast.error("মোট বিলে সঠিক সংখ্যা দিন");
    const advance = f.advance.trim() === "" ? 0 : parseBnNumber(f.advance);
    if (advance === null) return toast.error("জমায় সঠিক সংখ্যা দিন");
    if (editing && !/^\d{4}-\d{2}-\d{2}$/.test(f.serviceDate)) {
      return toast.error("সঠিক তারিখ দিন");
    }

    setSaving(true);
    try {
      const payload = {
        customerName: f.customerName.trim(),
        phone: f.phone.trim(),
        model: f.model.trim(),
        technician: f.technician,
        problem: f.problem.trim(),
        totalBill,
        advance,
        status: f.status,
        shopExpense: f.shopExpense.trim(),
        ...(editing ? { serviceDate: f.serviceDate } : { serviceDate }),
      };
      const res = await fetch(
        editing ? `/api/services/${initial!.id}` : "/api/services",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "সেভ করা যায়নি");
      toast.success(editing ? "আপডেট হয়েছে" : "সেভ হয়েছে");
      if (!editing) setF(empty);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "সেভ করা যায়নি");
    } finally {
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
              {TECHNICIANS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
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
