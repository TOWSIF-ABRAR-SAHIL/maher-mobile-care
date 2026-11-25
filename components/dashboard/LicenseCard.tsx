"use client";

import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { toBnDigits } from "@/lib/utils";
import { PLATFORM_BRAND } from "@/lib/shop";
import { useShopSettings } from "@/components/ShopSettingsProvider";
import type { LicenseStatus } from "@/lib/licensing/types";
import { LICENSE_TYPE_LABEL } from "@/lib/licensing/types";
import { useLicenseSubscription } from "@/components/licensing/use-license-subscription";

const SUPPORT_NUMBER = "01533315357";
const SUPPORT_URL = "https://wa.me/8801533315357";
const PURCHASE_NUMBER = "01533315357";
const PURCHASE_URL = "https://wa.me/8801533315357";
const CTA_TRIAL = "🚀 ফুল ভার্সনে আপগ্রেড করুন / লাইসেন্স কি দিন";
const CTA_MULTI_YEAR = "🔄 মেয়াদের সময় বাড়ান / এক্সটেন্ড করুন";
const CTA_LOCKED = "🚨 সফটওয়ার আনলক করতে লাইসেন্স কি দিন";
const CTA_EXTEND_HINT =
  "নতুন কি যোগ করলে আপনার বর্তমান মেয়াদের শেষে অতিরিক্ত মেয়াদ স্বয়ংক্রিয়ভাবে যোগ হবে।";
const CTA_LIFETIME_PILL = "💎 লাইসেন্স সক্রিয় — আজীবন ব্যবহারের নিশ্চয়তা";
const CTA_LIFETIME_NOTE =
  "আপনার সফটওয়ারটি স্থায়ীভাবে সক্রিয় আছে। কোনো বাৎসরিক ফি বা অতিরিক্ত রিনিউয়াল কি প্রয়োজন নেই।";
const CTA_LIFETIME_CHANGE = "⚙️ লাইসেন্স কি পরিবর্তন / আপডেট করুন";
const TOKEN_PREFIX = "MHR-KEY-";
const TOKEN_SHAPE = /^MHR-KEY-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const FALLBACK_MACHINE_ID = "MHR-0000-0000-0000-0000";
const COPY_FEEDBACK_MS = 2500;

type PreviewState = "valid" | "mismatch" | "invalid";

interface Preview {
  state: PreviewState;
  shopName: string;
  label: string;
  type: string;
}

function formatBnDate(iso: string | null): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function isLocked(status: LicenseStatus | null): boolean {
  if (!status) return false;
  return (
    status.status === "EXPIRED" ||
    status.status === "LOCKED" ||
    status.status === "INVALID" ||
    status.status === "CLOCK_TAMPERED" ||
    status.isExpired === true
  );
}

function isLifetime(status: LicenseStatus | null): boolean {
  return !!status && (status.unlimited === true || status.type === "LIFETIME");
}

function isTrial(status: LicenseStatus | null): boolean {
  return !!status && (status.status === "TRIAL" || status.type === "TRIAL");
}

function isMultiYear(status: LicenseStatus | null): boolean {
  return (
    !!status &&
    !isLocked(status) &&
    (status.type === "1_YEAR" ||
      status.type === "2_YEARS" ||
      status.type === "3_YEARS")
  );
}

function badgeText(status: LicenseStatus | null): string {
  if (!status) return "● যাঁচাই হচ্ছে…";
  // A paid tier that has expired reads as locked even though payload.type is
  // still present for audit — the explicit verdict wins over the type.
  if (isLocked(status)) return "● মেয়াদ উত্তীর্ণ (লকড)";
  if (isTrial(status)) {
    const days = status.trialDaysRemaining ?? status.daysRemaining ?? 0;
    return `● ফ্রি ট্রায়াল: ${toBnDigits(days)} দিন বাকি`;
  }
  if (isLifetime(status)) return "● সক্রিয় (লাইফটাইম আনলিমিটেড)";
  if (status.type) return `● সক্রিয় (${LICENSE_TYPE_LABEL[status.type]})`;
  return "● মেয়াদ উত্তীর্ণ (লকড)";
}

const BADGE_BASE =
  "inline-flex items-center whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold";

function badgeClass(status: LicenseStatus | null): string {
  if (!status) return `${BADGE_BASE} bg-slate-50 text-slate-500 border border-slate-200/80`;
  if (isLocked(status)) return `${BADGE_BASE} bg-rose-50 text-rose-700 border border-rose-200/80`;
  if (isTrial(status)) return `${BADGE_BASE} bg-amber-50 text-amber-700 border border-amber-200/80`;
  if (isLifetime(status)) return `${BADGE_BASE} bg-emerald-50 text-emerald-700 border border-emerald-200/80`;
  return `${BADGE_BASE} bg-blue-50 text-blue-700 border border-blue-200/80`;
}

const CHIP_BASE =
  "inline-flex max-w-full items-center gap-1.5 break-words rounded-lg border px-3 py-1.5 text-xs font-medium";

function chipClass(state: PreviewState): string {
  if (state === "valid") return `${CHIP_BASE} bg-emerald-50 text-emerald-700 border-emerald-200`;
  if (state === "mismatch") return `${CHIP_BASE} bg-amber-50 text-amber-700 border-amber-200`;
  return `${CHIP_BASE} bg-rose-50 text-rose-700 border-rose-200`;
}

function chipText(preview: Preview): string {
  if (preview.state === "valid") {
    return `✓ সঠিক কি: ${preview.shopName} • ${preview.label}`;
  }
  if (preview.state === "mismatch") {
    return "⚠️ এই কি-টি অন্য পিসির জন্য তৈরি করা হয়েছে";
  }
  return "✕ অকার্যকর বা ভুল লাইসেন্স কি";
}

/**
 * Uppercase the human-typed prefix only. Everything after MHR-KEY- is a
 * base64url-encoded payload + Ed25519 signature: it is case-sensitive, and
 * uppercasing it would destroy the signature.
 */
function normalizeKeyInput(value: string): string {
  const trimmed = value.trim();
  const prefix = /^mhr-key-/i.exec(trimmed);
  return prefix ? `${TOKEN_PREFIX}${trimmed.slice(prefix[0].length)}` : trimmed;
}

export function LicenseCard() {
  const { status, activate } = useLicenseSubscription();
  const { settings } = useShopSettings();
  const [open, setOpen] = useState(false);
  const [renewalKey, setRenewalKey] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyNonce, setCopyNonce] = useState(0);

  const machineId = status?.machineId ?? FALLBACK_MACHINE_ID;
  const lifetime = isLifetime(status);
  const days =
    status?.type === "TRIAL" || status?.status === "TRIAL"
      ? status.trialDaysRemaining
      : status?.daysRemaining;
  const progress = status?.progressPercent ?? null;
  // Tenant profile wins; the digitally signed license name is only a fallback
  // for a shop that has not configured its profile yet. MSS is the last resort.
  const shopName =
    settings.shopName || status?.shopName || PLATFORM_BRAND.name;
  const typeLabel = status?.type ? LICENSE_TYPE_LABEL[status.type] : "—";

  // status.expiresAt is the authoritative Asia/Dhaka day computed at issue
  // time (install + 30 days for a trial). Never substitute the host clock's
  // year here — a tampered or stale client clock must not rewrite the term.
  const expiryValue = lifetime
    ? "আজীবন মেয়াদী"
    : status?.expiresAt
      ? formatBnDate(status.expiresAt)
      : "—";
  const remainingValue = lifetime
    ? "আনলিমিটেড"
    : days !== null && days !== undefined
      ? `${toBnDigits(days)} দিন বাকি`
      : "—";

  const supportHref = `${SUPPORT_URL}?text=${encodeURIComponent(
    `আমার মেশিন আইডি: ${machineId} — লাইসেন্স সংক্রান্ত সাহায্য চাই।`
  )}`;
  const purchaseHref = `${PURCHASE_URL}?text=${encodeURIComponent(
    `আমার মেশিন আইডি: ${machineId} — ফুল ভার্সনের লাইসেন্স কি চাচ্ছি।`
  )}`;
  // The renewal CTA follows the tier, not just the paid/unpaid verdict: a
  // lifetime owner must never be nudged to buy again, while an expired shop
  // gets the urgent unlock wording. All states keep the same modal testids.
  const renewalLabel = isLocked(status)
    ? CTA_LOCKED
    : isTrial(status)
      ? CTA_TRIAL
      : CTA_MULTI_YEAR;
  const renewalClass = isLocked(status)
    ? "rounded-xl border border-amber-300 bg-rose-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700"
    : "rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800";

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied, copyNonce]);

  // Read-only signature check on the local API. Debounced so pasting a long
  // token never fires a request per keystroke, and cancellable to keep a slow
  // response from showing a preview of an older key.
  useEffect(() => {
    setPreview(null);
    const key = normalizeKeyInput(renewalKey);
    if (!key) return;
    if (!TOKEN_SHAPE.test(key)) {
      setPreview({ state: "invalid", shopName: "", label: "", type: "" });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/license/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
        });
        const data = (await response.json().catch(() => null)) as
          | (Preview & { ok?: boolean; reason?: string })
          | null;
        if (cancelled) return;
        if (response.ok && data?.ok) {
          setPreview({
            state: "valid",
            shopName: data.shopName,
            label: data.label,
            type: data.type,
          });
        } else if (data?.reason === "MACHINE") {
          setPreview({ state: "mismatch", shopName: "", label: "", type: "" });
        } else {
          setPreview({ state: "invalid", shopName: "", label: "", type: "" });
        }
      } catch {
        // A preview is a convenience — activation still owns the verdict.
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [renewalKey]);

  async function copyMachineId() {
    try {
      await navigator.clipboard.writeText(machineId);
    } catch {
      const area = document.createElement("textarea");
      area.value = machineId;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopyNonce((value) => value + 1);
    setCopied(true);
  }

  async function applyRenewal() {
    const key = normalizeKeyInput(renewalKey);
    if (!key) {
      toast.error("অনুগ্রহ করে নতুন লাইসেন্স কি দিন।");
      return;
    }
    setBusy(true);
    const ok = await activate(key, "renew");
    setBusy(false);
    if (!ok) return;
    setOpen(false);
    setRenewalKey("");
    setPreview(null);
  }

  return (
    <section
      data-testid="license-card"
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white text-slate-800 shadow-sm"
    >
      {/* Header ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400">
            License &amp; Subscription
          </p>
          <h3 className="mt-1 text-lg font-bold text-slate-800">
            🛡️ লাইসেন্স ও সাবস্ক্রিপশন হাব
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            অফলাইন সিকিউরড অ্যাক্টিভেশন সিস্টেম
          </p>
        </div>
        <span data-testid="license-status-badge" className={badgeClass(status)}>
          {badgeText(status)}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 px-5 py-4">
        {/* 3-step workflow ------------------------------------------------ */}
        <div
          data-testid="license-workflow"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-2.5 text-xs font-medium text-indigo-900"
        >
          <span>১. মেশিন আইডি কপি করুন</span>
          <span aria-hidden="true" className="text-indigo-400">➔</span>
          <span>২. হোয়াটসঅ্যাপে কি সংগ্রহ করুন</span>
          <span aria-hidden="true" className="text-indigo-400">➔</span>
          <span>৩. সফটওয়ার সক্রিয় করুন</span>
        </div>

        {status?.message ? (
          <p className="rounded-lg border border-rose-200/80 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {status.message}
          </p>
        ) : null}

        {/* Information grid ---------------------------------------------- */}
        <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              নিবন্ধিত প্রতিষ্ঠান
            </dt>
            <dd className="mt-1 truncate font-semibold text-slate-800" title={shopName}>
              {shopName}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              লাইসেন্স টাইপ
            </dt>
            <dd className="mt-1 font-semibold text-slate-800">{typeLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              মেয়াদ উত্তীর্ণের তারিখ
            </dt>
            <dd data-testid="license-expiry-date" className="mt-1 font-semibold text-slate-800">
              {expiryValue}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              অবশিষ্ট সময়
            </dt>
            <dd className="mt-1 font-semibold tabular-nums text-slate-800">
              {remainingValue}
            </dd>
          </div>
        </dl>

        {/* Subscription progress / lifetime guarantee --------------------- */}
        {lifetime ? (
          <div
            data-testid="license-lifetime-badge"
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
          >
            💎 আজীবন ব্যবহারের নিশ্চয়তা
          </div>
        ) : progress !== null && Number.isFinite(progress) ? (
          <div>
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-500">
              <span>📊 সাবস্ক্রিপশনের অবশিষ্ট সময়</span>
              <span className="tabular-nums">{toBnDigits(progress)}% বাকি</span>
            </div>
            <div
              data-testid="license-progress-bar"
              role="progressbar"
              aria-label="সাবস্ক্রিপশনের বাকি সময়"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="license-track mt-2 h-2.5 overflow-hidden rounded-full border border-slate-200/50 bg-slate-100"
            >
              <div
                data-testid="license-progress-fill"
                className="license-fill h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        {/* Machine ID ----------------------------------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500">
              আপনার মেশিনের অনন্য আইডি (Hardware Machine ID):
            </p>
            <code
              data-testid="machine-id-display"
              className="mt-1 inline-block select-all rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm font-bold tracking-wider text-slate-800"
            >
              {machineId}
            </code>
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="license-copy-machine-id"
            onClick={() => void copyMachineId()}
            className={
              copied
                ? "h-9 gap-1.5 whitespace-nowrap rounded-lg border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 shadow-sm transition"
                : "h-9 gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-100"
            }
          >
            <span data-testid="btn-copy-license-machine-id">
              {copied ? (
                <span data-testid="license-copy-feedback" role="status">
                  ✓ কপি হয়েছে!
                </span>
              ) : (
                "📋 মেশিন আইডি কপি করুন"
              )}
            </span>
          </Button>
        </div>

        {/* Actions -------------------------------------------------------- */}
        {lifetime ? (
          <div
            data-testid="license-lifetime-pill"
            className="bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold px-6 py-2.5 rounded-xl shadow-sm text-sm flex items-center justify-center gap-2"
          >
            {CTA_LIFETIME_PILL}
          </div>
        ) : null}
        <div className="mt-auto grid gap-2 pt-1 sm:grid-cols-2">
          {lifetime ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="license-change-key-btn"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1.5 justify-self-start rounded-xl border border-slate-300 bg-slate-100 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-200 hover:text-slate-700 active:scale-95 cursor-pointer"
            >
              <span data-testid="btn-open-license-modal">{CTA_LIFETIME_CHANGE}</span>
            </Button>
          ) : (
            <Button
              type="button"
              data-testid="license-renew-btn"
              onClick={() => setOpen(true)}
              className={renewalClass}
            >
              <span data-testid="btn-open-license-modal">{renewalLabel}</span>
            </Button>
          )}
          <a
            data-testid="license-support-link"
            href={supportHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 font-medium text-xs text-emerald-700 transition hover:bg-emerald-100"
          >
            💬 WhatsApp সাপোর্ট: {SUPPORT_NUMBER}
          </a>
          {isTrial(status) ? (
            <a
              data-testid="license-trial-purchase-link"
              href={purchaseHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 sm:col-span-2"
            >
              💬 WhatsApp-এ কি সংগ্রহ করুন: {PURCHASE_NUMBER}
            </a>
          ) : null}
        </div>
        {lifetime ? (
          <p className="text-center text-xs text-slate-400 mt-2">{CTA_LIFETIME_NOTE}</p>
        ) : isMultiYear(status) ? (
          <p className="text-xs text-slate-500 font-medium">{CTA_EXTEND_HINT}</p>
        ) : null}
      </div>

      {/* Renewal modal — light theme, scoped backdrop --------------------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPortal>
          <DialogOverlay className="bg-slate-900/40 backdrop-blur-sm" />
          <DialogPrimitive.Content
            data-testid="license-dialog"
            className="fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
          >
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-lg font-bold text-slate-900">
                সফটওয়ার লাইসেন্স সক্রিয় / রিনিউ করুন
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-500">
                বর্তমান মেয়াদের সাথে নতুন মেয়াদ যুক্ত হবে। কোনো ডেটা মুছে যাবে না।
              </DialogDescription>
            </DialogHeader>

            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-xs text-slate-700">
              <span className="min-w-0 break-all">
                মেশিন আইডি: <strong className="font-bold">{machineId}</strong>
              </span>
              <button
                type="button"
                data-testid="btn-copy-modal-machine-id"
                onClick={() => void copyMachineId()}
                aria-label="মেশিন আইডি কপি করুন"
                title="মেশিন আইডি কপি করুন"
                className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100"
              >
                📋
              </button>
              {copied ? (
                <span
                  data-testid="license-copy-feedback-modal"
                  role="status"
                  className="shrink-0 text-[11px] font-semibold text-emerald-600"
                >
                  ✓ কপি হয়েছে!
                </span>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="renewal-key" className="block text-xs font-semibold text-slate-700">
                লাইসেন্স কি
              </label>
              <Input
                id="renewal-key"
                data-testid="license-key-input"
                value={renewalKey}
                onChange={(event) => setRenewalKey(normalizeKeyInput(event.target.value))}
                placeholder="MHR-KEY-XXXXX..."
                autoComplete="off"
                spellCheck={false}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-mono text-sm text-slate-800 shadow-inner focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
              <p className="text-[11px] text-slate-500">
                অ্যাডমিনের পাঠানো সম্পূর্ণ কি-টি কপি করে এখানে পেস্ট করুন।
              </p>
              {preview ? (
                <p
                  data-testid="license-key-preview"
                  data-preview-state={preview.state}
                  role="status"
                  className={chipClass(preview.state)}
                >
                  {chipText(preview)}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                বাতিল
              </Button>
              <Button
                type="button"
                data-testid="license-activate-submit"
                disabled={busy}
                onClick={() => void applyRenewal()}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800"
              >
                <span data-testid="btn-activate-license" className="inline-flex items-center gap-2">
                  {busy ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      যাচাই করা হচ্ছে...
                    </>
                  ) : (
                    <span data-testid="btn-apply-renewal">🚀 সক্রিয় করুন</span>
                  )}
                </span>
              </Button>
            </div>

            <DialogPrimitive.Close
              aria-label="বন্ধ করুন"
              className="absolute right-4 top-4 rounded-md text-slate-400 transition hover:text-slate-700"
            >
              ✕
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </section>
  );
}
