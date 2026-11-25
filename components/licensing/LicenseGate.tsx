"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLicenseGate } from "./use-license-gate";

const SUPPORT_NUMBER = "01533315357";
const SUPPORT_URL = "https://wa.me/8801533315357";
const TOKEN_PREFIX = "MHR-KEY-";
const TOKEN_SHAPE = /^MHR-KEY-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Uppercase the prefix only — the signed base64url body is case-sensitive. */
function normalizeKeyInput(value: string): string {
  const trimmed = value.trim();
  const prefix = /^mhr-key-/i.exec(trimmed);
  return prefix ? `${TOKEN_PREFIX}${trimmed.slice(prefix[0].length)}` : trimmed;
}

/** Full-screen lock. The routed page stays mounted underneath for SSR/tests. */
export function LicenseGate() {
  const { status, activate } = useLicenseGate();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const machineId = status?.machineId ?? "MHR-0000-0000-0000-0000";
  const formatOk = TOKEN_SHAPE.test(normalizeKeyInput(key));

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
    setCopied(false);
    setCopied(true);
    toast.success("মেশিন আইডি কপি হয়েছে।");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeKeyInput(key);
    if (!normalized) {
      setError("অনুগ্রহ করে লাইসেন্স কি দিন।");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await activate(normalized);
    if (ok) setKey("");
    else setError("কিটি ঠিকমতো দেওয়া হয়েছে কি না যাঁচাই করুন।");
    setBusy(false);
  }

  return (
    <div
      data-testid="license-gate"
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-maher-navy-light p-4 text-white backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="সফটওয়ার সক্রিয় করুন"
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/15 bg-white text-maher-ink shadow-lift">
        <div className="license-hero relative overflow-hidden px-6 py-6 text-white sm:px-9">
          <div className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full border border-white/10" />
          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/70">
                License Activation · Offline Verified
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                সফটওয়ার সক্রিয় করুন
              </h1>
              <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/80">
                এই কম্পিউটারের জন্য একটি লাইসেন্স কি দিন। সব যাঁচাই অফলাইনে
                হয় — কোনো ইন্টারনেট সংযোগ লাগবে না।
              </p>
            </div>
            <span className="license-glass rounded-full px-3 py-1.5 text-xs font-bold text-white">
              🔒 হার্ডওয়্যার লক
            </span>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6 sm:px-9">
          {status?.message ? (
            <div
              data-testid="license-gate-message"
              className="license-pill license-pill--rose max-w-full break-words text-sm"
            >
              {status.message}
            </div>
          ) : null}

          <div className="license-glass rounded-xl p-4 text-white">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
              💻 আপনার মেশিনের অনন্য আইডি (Hardware Machine ID)
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <code
                data-testid="machine-id-display"
                className="select-all rounded-lg bg-white px-3 py-2 font-mono text-base font-bold tracking-[0.12em] text-maher-navy"
              >
                {machineId}
              </code>
              <Button
                type="button"
                variant="outline"
                data-testid="btn-copy-machine-id"
                onClick={() => void copyMachineId()}
                className="h-9 gap-2 whitespace-nowrap"
              >
                📋 কপি করুন
              </Button>
              {copied ? (
                <span
                  data-testid="license-copy-feedback"
                  role="status"
                  className="text-xs font-bold text-white"
                >
                  ✓ কপি হয়েছে!
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-white/70">
              এই আইডিটি কপি করে লাইসেন্সের জন্য পাঠান। কি শুধু এই মেশিনেই চলবে।
            </p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label htmlFor="license-key" className="block text-sm font-semibold">
              🔑 লাইসেন্স কি
            </label>
            <Input
              id="license-key"
              data-testid="license-key-input"
              value={key}
              onChange={(event) => {
                setKey(normalizeKeyInput(event.target.value));
                setError("");
              }}
              placeholder="MHR-KEY-XXXXX..."
              autoComplete="off"
              spellCheck={false}
              className="h-12 border-maher-border bg-white font-mono text-sm"
            />
            <div className="flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs">
              <span className={error ? "text-maher-due-ink" : "text-muted-foreground"}>
                {error ||
                  (formatOk
                    ? "✓ কির ফরম্যাট ঠিক আছে — সক্রিয় করতে নিচের বাটনে চাপুন।"
                    : "কিটি সম্পূর্ণ পেস্ট করুন (MHR-KEY-… )")}
              </span>
            </div>
            <Button
              type="submit"
              data-testid="btn-activate-license"
              disabled={busy}
              className="h-12 w-full gap-2 text-base font-bold"
            >
              🚀 {busy ? "যাচাই করা হচ্ছে..." : "সফটওয়ার সক্রিয় করুন"}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-maher-border bg-maher-surface px-4 py-3 text-sm">
            <span className="font-semibold text-maher-navy">
              লাইসেন্স পেতে যোগাযোগ করুন: {SUPPORT_NUMBER} (WhatsApp)
            </span>
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-maher-royal underline underline-offset-4"
            >
              💬 WhatsApp খুলুন
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
