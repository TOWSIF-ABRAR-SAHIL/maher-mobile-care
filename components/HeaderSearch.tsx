"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Pencil, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/StatusBadge";
import { dayLabel, dhakaDateKey } from "@/lib/dhaka";
import { telHref, whatsAppHref } from "@/lib/contact";
import { formatTaka } from "@/lib/utils";
import type { ServiceDTO } from "@/lib/types";

/** Exact placeholder required by the dashboard spec. */
const PLACEHOLDER = "🔍 নাম, ফোন, মডেল বা বিল নং খুঁজুন… (Ctrl+K)";

interface SearchResponse {
  query: string;
  count: number;
  services: ServiceDTO[];
}

/** Shared debounce + fetch logic for the desktop and mobile search widgets. */
function useServiceSearch(refreshKey: number) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const queryRef = useRef(query);
  const reqId = useRef(0);
  queryRef.current = query;

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    const my = ++reqId.current;
    if (trimmed.length < 2) {
      setResult(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/services/search?q=${encodeURIComponent(trimmed)}`
      );
      const data = (await res.json().catch(
        () => null
      )) as SearchResponse | null;
      if (!res.ok || !data) throw new Error("খোঁজা যায়নি");
      if (reqId.current === my) setResult(data);
    } catch {
      if (reqId.current === my) setResult(null);
    } finally {
      if (reqId.current === my) setLoading(false);
    }
  }, []);

  // Data changes elsewhere (edit/save/restore) refresh visible results.
  useEffect(() => {
    if (queryRef.current.trim().length >= 2) void search(queryRef.current);
  }, [refreshKey, search]);

  useEffect(() => {
    const t = setTimeout(() => void search(query), 350);
    return () => clearTimeout(t);
  }, [query, search]);

  return { query, setQuery, result, loading };
}

function SearchResults({
  query,
  result,
  loading,
  onPick,
  onEdit,
}: {
  query: string;
  result: SearchResponse | null;
  loading: boolean;
  onPick: (service: ServiceDTO) => void;
  onEdit: (service: ServiceDTO) => void;
}) {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        পুরোনো কাস্টমার, ফোন বা বিল নং খুঁজতে লিখুন — তারিখ বদলাতে হবে না।
      </p>
    );
  }
  if (trimmed.length < 2) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        কমপক্ষে ২ অক্ষর লিখুন।
      </p>
    );
  }
  if (loading && !result) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        খোঁজা হচ্ছে…
      </p>
    );
  }
  if (!result) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        খোঁজা যায়নি — আবার চেষ্টা করুন।
      </p>
    );
  }
  if (result.services.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-sm text-muted-foreground">
        “{result.query}” দিয়ে কিছু পাওয়া যায়নি।
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span>{result.count}টি ফলাফল</span>
        <span className="hidden sm:inline">বিল দেখতে ক্লিক করুন</span>
      </div>
      <ul>
        {result.services.map((s) => (
          <li key={s.id} className="border-t">
            <div className="flex items-start gap-1.5 px-2 py-2 transition hover:bg-maher-blue-soft/70">
              <button
                type="button"
                onClick={() => onPick(s)}
                className="min-w-0 flex-1 rounded px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue"
                title="বিল প্রিভিউ"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-foreground">
                    {s.customerName}
                  </span>
                  <span
                    className={`shrink-0 text-xs font-semibold tabular-nums ${
                      s.due > 0 ? "text-maher-due-ink" : "text-muted-foreground"
                    }`}
                  >
                    {formatTaka(s.due)}
                  </span>
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-mono">#{s.id}</span>
                  <span>{dayLabel(dhakaDateKey(s.serviceDate))}</span>
                  <span className="truncate">{s.phone}</span>
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 truncate text-xs text-foreground/80">
                    {s.model}
                    {s.problem ? ` • ${s.problem}` : ""}
                  </span>
                  <span className="shrink-0">
                    <StatusBadge status={s.status} />
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-maher-done"
                  title="কল"
                >
                  <a
                    href={telHref(s.phone)}
                    aria-label={`${s.customerName}-কে কল করুন`}
                  >
                    <Phone />
                  </a>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-maher-done"
                  title="WhatsApp"
                >
                  <a
                    href={whatsAppHref(s)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${s.customerName}-কে WhatsApp করুন`}
                  >
                    <MessageCircle />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${s.customerName} এডিট করুন`}
                  className="h-9 w-9 sm:h-7 sm:w-7"
                  title="এডিট"
                  onClick={() => onEdit(s)}
                >
                  <Pencil />
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Desktop navbar search: inline input with a live dropdown. */
export function HeaderSearch({
  refreshKey,
  onEdit,
  onReceipt,
}: {
  refreshKey: number;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
}) {
  const { query, setQuery, result, loading } = useServiceSearch(refreshKey);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K focuses the navbar search. Ignore while another dialog/sheet is open
  // and on mobile, where MobileSearch owns the shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      if (!window.matchMedia("(min-width: 1280px)").matches) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(true);
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the dropdown without closing the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const pick = (s: ServiceDTO) => {
    setOpen(false);
    onReceipt(s);
  };
  const editOne = (s: ServiceDTO) => {
    setOpen(false);
    onEdit(s);
  };

  return (
    <div ref={wrapRef} className="relative hidden shrink-0 xl:block print:hidden">
      <Input
        ref={inputRef}
        id="global-search"
        data-testid="global-search-input"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        placeholder={PLACEHOLDER}
        aria-label="নাম, ফোন, মডেল বা বিল নং খুঁজুন"
        aria-keyshortcuts="Control+K"
        autoComplete="off"
        className="h-9 w-64 rounded-lg border-white/35 bg-white/95 text-foreground shadow-[0_4px_14px_-8px_rgb(9_30_110/0.8)] placeholder:text-muted-foreground focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/60 xl:w-80"
      />
      {open && query.trim().length > 0 ? (
        <div
          data-testid="global-search-dropdown"
          className="absolute right-0 top-full z-50 mt-2 max-h-[min(70vh,32rem)] w-[22rem] overflow-y-auto rounded-xl border border-maher-border bg-white text-foreground shadow-lift xl:w-[26rem]"
        >
          <SearchResults
            query={query}
            result={result}
            loading={loading}
            onPick={pick}
            onEdit={editOne}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Mobile navbar search: 🔍 icon opens a top sheet with the same results. */
export function MobileSearch({
  refreshKey,
  onEdit,
  onReceipt,
}: {
  refreshKey: number;
  onEdit: (service: ServiceDTO) => void;
  onReceipt: (service: ServiceDTO) => void;
}) {
  const { query, setQuery, result, loading } = useServiceSearch(refreshKey);
  const [open, setOpen] = useState(false);

  // Ctrl+K (and Cmd+K) opens the mobile sheet from a hardware keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k") return;
      if (window.matchMedia("(min-width: 1280px)").matches) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (s: ServiceDTO) => {
    setOpen(false);
    onReceipt(s);
  };
  const editOne = (s: ServiceDTO) => {
    setOpen(false);
    onEdit(s);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="h-8 w-8 shrink-0 border border-white/25 bg-white/15 text-white hover:bg-white/25 hover:text-white xl:hidden print:hidden"
          aria-label="সার্চ করুন"
          title="সার্চ (Ctrl+K)"
          data-testid="mobile-search-open"
        >
          <Search />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="top"
        className="border-white/20 bg-maher-navy gloss-chrome p-0 text-white"
      >
        <SheetHeader className="border-white/15">
          <SheetTitle className="text-white">🔍 সব তারিখে খুঁজুন</SheetTitle>
          <SheetDescription className="text-white/80">
            নাম, ফোন, মডেল বা বিল নং দিয়ে খুঁজুন — তারিখ বদলাতে হবে না।
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pt-3">
          <Input
            id="global-search-mobile"
            data-testid="global-search-mobile-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDER}
            aria-label="নাম, ফোন, মডেল বা বিল নং খুঁজুন"
            aria-keyshortcuts="Control+K"
            autoComplete="off"
            autoFocus
            className="h-10 rounded-lg border-white/35 bg-white text-foreground shadow-sm placeholder:text-muted-foreground focus-visible:border-maher-blue focus-visible:ring-2 focus-visible:ring-maher-blue/25"
          />
        </div>
        <div
          data-testid="mobile-search-results"
          className="mx-2 mt-2 flex-1 overflow-y-auto rounded-xl border border-maher-border bg-white pb-2 text-foreground shadow-lift"
        >
          <SearchResults
            query={query}
            result={result}
            loading={loading}
            onPick={pick}
            onEdit={editOne}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
