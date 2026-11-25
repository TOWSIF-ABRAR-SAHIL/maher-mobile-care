"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  CircleAlert,
  Copy,
  DatabaseBackup,
  Download,
  FileImage,
  FolderOpen,
  HardDrive,
  History,
  Landmark,
  Loader2,
  MapPin,
  Package,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Store,
  Trash2,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TechnicianManager } from "@/components/TechnicianManager";
import { BackupExportDialog } from "@/components/dashboard/BackupExportDialog";
import { RestoreDialog } from "@/components/RestoreDialog";
import { ShopFooter } from "@/components/ShopFooter";
import { LicenseCard } from "@/components/dashboard/LicenseCard";
import { DuesTrigger, ReportDock } from "@/components/dashboard/ReportDock";
import {
  useShopSettings,
  type ClientShopSettings,
} from "@/components/ShopSettingsProvider";
import { useLastBackup } from "@/lib/use-last-backup";
import { cn, formatTaka, toBnDigits } from "@/lib/utils";
import {
  CIPHER_DIGITS,
  KEYPAD_CIPHER_GROUPS,
  decodeWithCipher,
  encodeWithCipher,
  groupsFromWord,
  parseCipherChars,
  validateCipherGroups,
  wordFromGroups,
  type CipherConfig,
  type CipherDigit,
  type CipherGroups,
} from "@/lib/secret-code";

/**
 * The shop owner's home. Every section reads existing read-only APIs — no
 * ledger calculation is duplicated here — and ShopSettings edits go through
 * the dedicated settings endpoint so no service/inventory row is rewritten.
 *
 * Visual contract: two always-visible zones (Business Overview / Shop
 * Administration), four sided metric cards, a phone-style keypad and a
 * money↔code converter. Bengali labels and legacy testids are part of the API.
 */

const LOGO_PREVIEW_KEY = "maher-shop-logo-preview";
/** Persisted only after a successful shop-info save; never written by a view. */
const ONBOARDING_FLAG_KEY = "shop_onboarding_completed";
/** Newer name for the same completion signal; both are written on save. */
const PROFILE_FLAG_KEY = "shop_profile_configured";
/** Dismissal lasts for this browser tab only, never across a new session. */
const ONBOARDING_SESSION_KEY = "maher-shop-onboarding-dismissed";
const ONBOARDING_PULSE_MS = 1800;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml";
const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const LOGO_SIZE_ERROR =
  "ছবির সাইজ অনেক বড়! অনুগ্রহ করে ২MB এর কম সাইজের ছবি নির্বাচন করুন।";
const LOGO_TYPE_ERROR = "শুধুমাত্র PNG, JPG, WEBP বা SVG ছবি নির্বাচন করুন।";
const SLOT_LABELS: Record<string, string> = {
  "1": "১", "2": "২", "3": "৩", "4": "৪", "5": "৫",
  "6": "৬", "7": "৭", "8": "৮", "9": "৯", "0": "০", "00": "০০",
};
const CIPHER_INVALID_NOTICE = "সবগুলো ঘরে সঠিক অক্ষর দিন";
const CIPHER_SYNC_TOAST = "গোপন কোড সফলভাবে পুরো ওয়েবসাইটে সিঙ্ক হয়েছে!";

/** Free-form text of one grid field. The engine parses `A, B, C` and `ABC`. */
type GroupText = Record<CipherDigit, string>;

function emptyGroupText(): GroupText {
  const text = {} as GroupText;
  for (const digit of CIPHER_DIGITS) text[digit] = "";
  return text;
}

/** Convert a saved cipher (multi-char groups or legacy word) into field text. */
function groupTextFromConfig(config: CipherConfig): GroupText {
  const next = emptyGroupText();
  if (config.mode === "custom") {
    const groups: CipherGroups =
      config.groups ?? groupsFromWord(config.word ?? "");
    for (const digit of CIPHER_DIGITS) {
      next[digit] = (groups[digit] ?? []).join(", ");
    }
  }
  return next;
}

/** Mirror the first character of every digit into the legacy word field. */
function wordFromGroupText(text: GroupText): string {
  return wordFromGroups(
    Object.fromEntries(
      CIPHER_DIGITS.map((digit) => [digit, parseCipherChars(text[digit])])
    )
  );
}

/** Unique starter map seeded into a fully empty custom grid: 1=A … 9=I,
 *  0=J, 00=K. Every character belongs to exactly one digit, so the custom
 *  tab never opens in the collision/invalid trap. */
const DEFAULT_CUSTOM_SEED: GroupText = {
  "1": "A", "2": "B", "3": "C", "4": "D", "5": "E",
  "6": "F", "7": "G", "8": "H", "9": "I", "0": "J", "00": "K",
};

type Overview = {
  todayCount: number;
  todayCash: number;
  customerDues: number;
  customerDuesCount: number;
  supplierDues: number;
  lowStockCount: number;
  lowStock: { id: number; name: string; stock: number }[];
  /** Live roster size, refreshed whenever the staff dialog changes the roster. */
  activeTechnicians: number;
};

const EMPTY_OVERVIEW: Overview = {
  todayCount: 0,
  todayCash: 0,
  customerDues: 0,
  customerDuesCount: 0,
  supplierDues: 0,
  lowStockCount: 0,
  lowStock: [],
  activeTechnicians: 0,
};

/** Read-only view of where the live SQLite connection actually points. */
type DbLocationInfo = {
  activePath: string;
  defaultPath: string;
  configuredPath: string | null;
  source: "default" | "custom" | "fallback";
  fallbackReason: string | null;
  dbFile?: string;
};

const DB_PATH_WARNING =
  "সতর্কতা: ডাটাবেজটি নতুন লোকেশনে স্থানান্তর করা হবে। নিশ্চিত করুন?";
const DB_PATH_LOADING = "ডাটাবেজ স্থানান্তর করা হচ্ছে...";
const DB_PATH_SUCCESS = "ডাটাবেজ লোকেশন সফলভাবে পরিবর্তিত হয়েছে!";
const DB_PATH_PRESETS = ["D", "E", "C"] as const;
const DB_BROWSER_PATH_NOTICE =
  "ব্রাউজার ফোল্ডারের সম্পূর্ণ পথ দেখায় না — পথটি ঘরে লিখুন বা কুইক প্রিসেট ব্যবহার করুন।";

function dbPathSuccess(recordCount?: number): string {
  return typeof recordCount === "number"
    ? `${DB_PATH_SUCCESS} (${recordCount}টি রেকর্ড স্থানান্তরিত)`
    : DB_PATH_SUCCESS;
}

/**
 * Folder or complete file path -> the exact SQLite file that will be written.
 * The active database's filename (shop.db / dev.db) is appended for a folder,
 * so the preview and the API can never disagree about the destination.
 */
function targetDatabasePath(raw: string, activePath: string): string {
  const value = raw.trim().replace(/^["']+|["']+$/g, "");
  if (!value) return "";
  const separator = activePath.includes("\\") ? "\\" : "/";
  const normalized = value
    .replace(/[\\/]+/g, separator)
    .replace(/[\\/]+$/, "");
  if (/\.db$/i.test(normalized)) return normalized;
  const dbFile = activePath.split(/[\\/]/).pop() || "shop.db";
  return `${normalized}${separator}${dbFile}`;
}

/**
 * One card per editable digit — the same eleven slots the custom editor uses.
 * The legacy `cipher-key-star` testid lives on a visually hidden node in the
 * first card, so old suites still find it without a twelfth visible box.
 */
const KEYPAD_CARDS = CIPHER_DIGITS.map((digit) => ({
  digit,
  testId:
    digit === "0"
      ? "cipher-key-plus"
      : digit === "00"
      ? "cipher-key-hash"
      : `cipher-key-${digit}`,
  code: (KEYPAD_CIPHER_GROUPS[digit] ?? []).join(", "),
  hint:
    digit === "1"
      ? "কোড"
      : digit === "0"
      ? "শূন্য"
      : digit === "00"
      ? "দুই শূন্য"
      : undefined,
}));

const KEYPAD_GLYPHS = new Set(["*", "+", "#"]);

/**
 * Converter-only decode: honour the active map first, then accept the stable
 * phone glyphs (* ১, + ০, # ০০) as a legacy alias. Case and Bengali digits are
 * normalised by the pure engine; this never touches stored codes or amounts.
 */
function decodeConverterCode(raw: string, config: CipherConfig): number | null {
  const normalized = raw.trim().replace(/[\s,৳]/g, "");
  if (!normalized) return null;
  const active = decodeWithCipher(normalized, config);
  if (active !== null) return active;
  const upper = normalized.toUpperCase();
  if (!Array.from(upper).some((ch) => KEYPAD_GLYPHS.has(ch))) return null;
  return decodeWithCipher(upper, { mode: "keypad" });
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function Section({
  title,
  hint,
  icon,
  children,
  testId,
  className,
  bodyClassName,
}: {
  title: string;
  hint?: string;
  icon: ReactNode;
  children: ReactNode;
  testId?: string;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={cn("ledger-panel overflow-hidden", className)}
    >
      <div className="flex items-center gap-2 border-b border-maher-border bg-maher-surface px-4 py-2.5">
        <span className="text-maher-navy">{icon}</span>
        <h2 className="text-sm font-bold tracking-wide text-maher-navy">
          {title}
        </h2>
        {hint ? (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

function Zone({
  eyebrow,
  title,
  icon,
  testId,
  targetId,
  otherId,
  jumpTestId,
  jumpLabel,
  jumpIcon,
  children,
}: {
  eyebrow: string;
  title: string;
  icon: ReactNode;
  testId: string;
  targetId: string;
  otherId: string;
  jumpTestId: string;
  jumpLabel: string;
  jumpIcon?: ReactNode;
  children: ReactNode;
}) {
  const jump = () => {
    const reduced = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    document.getElementById(otherId)?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <section id={targetId} data-testid={testId} className="scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-maher-border bg-white px-4 py-3 shadow-card">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-maher-navy text-white">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-maher-royal">
              {eyebrow}
            </p>
            <h2 className="truncate text-lg font-extrabold leading-tight text-maher-navy">
              {title}
            </h2>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid={jumpTestId}
          onClick={jump}
          className="gap-1.5"
        >
          {jumpLabel} {jumpIcon ?? <ArrowRight className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function StatCard({
  title,
  value,
  sub,
  icon,
  tone = "navy",
  testId,
  footer,
}: {
  title: string;
  value: string;
  sub: string;
  icon: ReactNode;
  tone?: "navy" | "blue" | "done" | "due" | "warning";
  testId?: string;
  footer?: ReactNode;
}) {
  const accent =
    tone === "blue"
      ? "text-maher-blue"
      : tone === "due"
      ? "text-maher-due"
      : tone === "done"
      ? "text-maher-done"
      : tone === "warning"
      ? "text-maher-warning"
      : "text-maher-navy";
  const surface =
    tone === "blue"
      ? "border-maher-blue/30"
      : tone === "due"
      ? "border-maher-due/25"
      : tone === "done"
      ? "border-maher-done/25"
      : tone === "warning"
      ? "border-maher-warning/25"
      : "border-maher-border";

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex min-h-[152px] min-w-0 flex-col rounded-xl border bg-white p-4 shadow-card",
        surface,
        accent
      )}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span className={accent}>{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      <p className={cn("mt-3 text-[26px] font-extrabold leading-none tabular-nums", accent)}>
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{sub}</p>
      {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
    </div>
  );
}

function QuickActionCard({
  title,
  description,
  icon,
  action,
  testId,
  href,
  onClick,
  tone = "navy",
}: {
  title: string;
  description: string;
  icon: ReactNode;
  action: ReactNode;
  testId: string;
  href?: string;
  onClick?: () => void;
  tone?: "navy" | "blue" | "steel" | "warning";
}) {
  const iconTone =
    tone === "blue"
      ? "bg-maher-blue text-white"
      : tone === "steel"
      ? "bg-maher-blue-soft text-maher-navy"
      : tone === "warning"
      ? "bg-maher-warning/10 text-maher-warning"
      : "bg-maher-navy text-white";
  const className = cn(
    "group flex h-full min-h-[168px] min-w-0 flex-col rounded-xl border border-maher-border bg-white p-4 text-left shadow-card",
    "cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-900/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maher-blue/30",
    "motion-reduce:transform-none motion-reduce:transition-none"
  );
  const body = (
    <>
      <span
        className={cn(
          "grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors duration-150",
          iconTone
        )}
      >
        {icon}
      </span>
      <span className="mt-3 block text-sm font-bold leading-snug text-maher-navy">
        {title}
      </span>
      <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
        {description}
      </span>
      <span className="mt-auto block pt-3">{action}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} data-testid={testId} className={className}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-testid={testId}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick();
          }
        }}
        className={className}
      >
        {body}
      </div>
    );
  }
  return (
    <div data-testid={testId} className={className}>
      {body}
    </div>
  );
}

export function DashboardView() {
  const { settings, save, applySettings, refresh } = useShopSettings();
  const lastBackup = useLastBackup();
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW);
  const [snapshotStamp, setSnapshotStamp] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTech, setShowTech] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [dbLocation, setDbLocation] = useState<DbLocationInfo | null>(null);
  const [showDbPath, setShowDbPath] = useState(false);
  const [targetDbPath, setTargetDbPath] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [pickingFolder, setPickingFolder] = useState(false);
  const hiddenFolderInput = useRef<HTMLInputElement | null>(null);
  const hiddenLogoInput = useRef<HTMLInputElement | null>(null);

  const [profile, setProfile] = useState<ClientShopSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [groupText, setGroupText] = useState<GroupText>(() =>
    groupTextFromConfig(settings.secretCipher)
  );
  const [cipherWord, setCipherWord] = useState(
    settings.secretCipher.word ?? ""
  );
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [shopNamePulse, setShopNamePulse] = useState(false);
  const pulseTimer = useRef<number | null>(null);

  // Keep the form in sync when settings load or are saved elsewhere.
  useEffect(() => {
    setProfile(settings);
    setGroupText(groupTextFromConfig(settings.secretCipher));
    setCipherWord(settings.secretCipher.word ?? "");
  }, [settings]);

  // Browser-only flags are read after mount so the server render and the
  // first client paint agree. A shop with a saved settings row never sees the
  // onboarding banner, whatever the browser flags say (backward compatible).
  useEffect(() => {
    try {
      setOnboardingDone(
        localStorage.getItem(ONBOARDING_FLAG_KEY) === "true" ||
          localStorage.getItem(PROFILE_FLAG_KEY) === "true"
      );
      setOnboardingDismissed(
        sessionStorage.getItem(ONBOARDING_SESSION_KEY) === "1"
      );
    } catch {
      setOnboardingDone(false);
      setOnboardingDismissed(false);
    }
    return () => {
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    };
  }, []);

  // The image itself stays on this PC in localStorage; only its filename goes
  // through the settings API (the stored column is a short path/name string).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOGO_PREVIEW_KEY);
      const record = raw ? (JSON.parse(raw) as { path?: string; dataUrl?: string }) : null;
      if (record?.path && record.dataUrl && record.path === settings.logoPath) {
        setLogoPreview(record.dataUrl);
      } else {
        setLogoPreview(null);
      }
    } catch {
      setLogoPreview(null);
    }
  }, [settings.logoPath]);

  const loadOverview = useCallback(async () => {
    const [stats, dues, purchases, parts, products, backups, technicians] =
      await Promise.all([
        json<{ today: { count: number; advance: number } }>("/api/stats"),
        json<{ totalDue: number; count: number }>("/api/services/dues"),
        json<{ summary: { due: number } }>("/api/purchases"),
        json<{ summary: { unpaidTotal: number } }>(
          "/api/service-parts?status=unpaid"
        ),
        json<{
          products: {
            id: number;
            name: string;
            stock: number;
            lowStockThreshold: number;
          }[];
          summary?: { lowStock?: number };
        }>("/api/products"),
        json<{ snapshots: { mtime: string }[] }>("/api/backup/list"),
        json<{ count: number }>("/api/technicians"),
      ]);

    const times = (backups?.snapshots ?? [])
      .map((s) => new Date(s.mtime).getTime())
      .filter((n) => Number.isFinite(n));
    if (times.length > 0) {
      setSnapshotStamp(new Date(Math.max(...times)).toLocaleString("bn-BD"));
    }

    setOverview({
      todayCount: stats?.today.count ?? 0,
      todayCash: stats?.today.advance ?? 0,
      customerDues: dues?.totalDue ?? 0,
      customerDuesCount: dues?.count ?? 0,
      supplierDues:
        (purchases?.summary.due ?? 0) + (parts?.summary.unpaidTotal ?? 0),
      lowStockCount: products?.summary?.lowStock ?? 0,
      activeTechnicians: technicians?.count ?? 0,
      // The brief asks for stock < 5; threshold-based low stock is shown too.
      lowStock: (products?.products ?? [])
        .filter((p) => p.stock < 5 || p.stock <= p.lowStockThreshold)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 8)
        .map(({ id, name, stock }) => ({ id, name, stock })),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview, showRestore]);

  const loadDbLocation = useCallback(async () => {
    const data = await json<{ location: DbLocationInfo }>("/api/db-location");
    if (data?.location) setDbLocation(data.location);
  }, []);

  useEffect(() => {
    void loadDbLocation();
  }, [loadDbLocation]);

  // Live preview: the same normalisation the API applies, so the shopkeeper
  // always sees the exact file that will receive the ledger.
  const targetPreview = useMemo(
    () => targetDatabasePath(targetDbPath, dbLocation?.activePath ?? ""),
    [targetDbPath, dbLocation?.activePath]
  );

  useEffect(() => {
    const input = hiddenFolderInput.current;
    if (!input) return;
    // Set through the DOM so TypeScript does not need non-standard JSX props.
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
  }, []);

  const applyDrivePreset = (drive: string) => {
    setTargetDbPath(`${drive}:\\MAHER_DATA`);
  };

  const browseDbFolder = async () => {
    const nativePicker =
      window.electronAPI?.selectDirectory ??
      window.maherDesktop?.selectDirectory;
    if (nativePicker) {
      setPickingFolder(true);
      try {
        const picked = await nativePicker();
        const value = typeof picked === "string" ? picked : picked?.path;
        if (value) {
          setTargetDbPath(value);
          return;
        }
        if (picked && typeof picked === "object" && "canceled" in picked && picked.canceled) {
          return;
        }
      } catch {
        // A broken native dialog must not block the browser fallback.
      } finally {
        setPickingFolder(false);
      }
    }

    const directoryPicker = (
      window as unknown as {
        showDirectoryPicker?: () => Promise<{ name?: string }>;
      }
    ).showDirectoryPicker;
    if (directoryPicker) {
      try {
        const handle = await directoryPicker();
        // Browsers deliberately hide the absolute filesystem path; never guess
        // a drive. Name the chosen folder and let the user confirm the path.
        toast.info(
          handle?.name
            ? `${DB_BROWSER_PATH_NOTICE} (${handle.name})`
            : DB_BROWSER_PATH_NOTICE
        );
      } catch {
        // The user cancelled the picker — nothing to report.
      }
      return;
    }

    hiddenFolderInput.current?.click();
  };

  const onHiddenFolderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] as
      | (File & { path?: string })
      | undefined;
    event.target.value = "";
    if (!file) return;
    if (file.path) {
      // Legacy Chromium/Electron exposes the absolute file path.
      setTargetDbPath(file.path.replace(/[\\/][^\\/]+$/, ""));
      return;
    }
    const folder =
      file.webkitRelativePath?.split("/")[0] || file.name || "";
    toast.info(folder ? `${DB_BROWSER_PATH_NOTICE} (${folder})` : DB_BROWSER_PATH_NOTICE);
  };

  const changeDbPath = async () => {
    const target = targetDatabasePath(
      targetDbPath,
      dbLocation?.activePath ?? ""
    );
    if (migrating || !target) return;
    setMigrating(true);
    try {
      const res = await fetch("/api/backup/change-db-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPath: target }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        location?: DbLocationInfo;
        activePath?: string;
        recordCount?: number;
      };
      if (!res.ok) throw new Error(data.error ?? "ডাটাবেজ স্থানান্তর করা যায়নি।");
      if (data.location) {
        setDbLocation(data.location);
      } else if (data.activePath) {
        const activePath = data.activePath;
        setDbLocation((previous) => ({
          activePath,
          defaultPath: previous?.defaultPath ?? "",
          configuredPath: activePath,
          source: "custom",
          fallbackReason: null,
        }));
      }
      toast.success(dbPathSuccess(data.recordCount));
      setShowDbPath(false);
      setTargetDbPath("");
      void loadDbLocation();
      void loadOverview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ডাটাবেজ স্থানান্তর করা যায়নি।");
    } finally {
      setMigrating(false);
    }
  };

  // The engine owns all validation: every digit 1–0 needs at least one
  // character, 00 may stay empty, and no character may belong to two digits.
  // The first duplicate and both of its owner digits come back for the UI.
  const groupValidation = useMemo(
    () => validateCipherGroups(groupText),
    [groupText]
  );
  const hasCollision = groupValidation.duplicate !== null;
  const conflictDigits = useMemo(
    () => new Set<CipherDigit>(groupValidation.conflictDigits),
    [groupValidation.conflictDigits]
  );
  // The converter must never silently fall back to the keypad preset while the
  // shopkeeper is editing an invalid custom map — that was the mismatch bug.
  const customCipherValid = groupValidation.ok;
  const cipherValid =
    profile.secretCipher.mode === "keypad" || customCipherValid;
  // One gate for both write actions: no save/sync while any field collides.
  const actionsDisabled =
    saving ||
    !cipherValid ||
    (profile.secretCipher.mode === "custom" && hasCollision);

  const activeCipher = useMemo<CipherConfig>(() => {
    if (profile.secretCipher.mode === "custom" && customCipherValid) {
      return {
        mode: "custom",
        groups: groupValidation.chars,
        word: wordFromGroups(groupValidation.chars),
      };
    }
    return { mode: "keypad" };
  }, [profile.secretCipher.mode, customCipherValid, groupValidation.chars]);

  const [testAmount, setTestAmount] = useState("");
  const [testCode, setTestCode] = useState("");

  const encodedTest = useMemo(() => {
    if (!cipherValid) return "";
    // An empty field must stay empty — coercing "" to 0 used to print '+'.
    const digits = testAmount.replace(/[^0-9]/g, "");
    if (!digits) return "";
    const amount = Number(digits);
    if (!Number.isSafeInteger(amount) || amount <= 0) return "";
    try {
      return encodeWithCipher(amount, activeCipher);
    } catch {
      return "";
    }
  }, [testAmount, activeCipher, cipherValid]);

  const decodedTest = useMemo(() => {
    if (!cipherValid) return null;
    const value = decodeConverterCode(testCode, activeCipher);
    return value === null ? null : toBnDigits(formatTaka(value));
  }, [testCode, activeCipher, cipherValid]);

  const updateProfile = (patch: Partial<ClientShopSettings>) =>
    setProfile((prev) => ({ ...prev, ...patch }));

  const slotValue = (digit: CipherDigit) => groupText[digit] ?? "";

  /** One grid field changed. Keep the legacy 10-character mirror in step. */
  const updateGroup = (digit: CipherDigit, raw: string) => {
    const next = { ...groupText, [digit]: raw };
    setGroupText(next);
    setCipherWord(wordFromGroupText(next));
  };

  /** Load the classic phone-keypad map into the editable grid. */
  const loadKeypadPreset = () => {
    const next = emptyGroupText();
    for (const digit of CIPHER_DIGITS) {
      next[digit] = KEYPAD_CIPHER_GROUPS[digit]?.join(", ") ?? "";
    }
    setGroupText(next);
    setCipherWord(wordFromGroupText(next));
  };

  const clearGroups = () => {
    setGroupText(emptyGroupText());
    setCipherWord("");
  };

  /** Switch to the custom map. A fully empty grid gets the unique starter
   *  seed so the tab opens valid; partial user edits are always preserved. */
  const switchToCustom = () => {
    const isEmpty = CIPHER_DIGITS.every((digit) => !slotValue(digit).trim());
    if (isEmpty) {
      const seed = { ...DEFAULT_CUSTOM_SEED };
      const word = wordFromGroupText(seed);
      setGroupText(seed);
      setCipherWord(word);
      updateProfile({ secretCipher: { mode: "custom", word } });
      return;
    }
    updateProfile({
      secretCipher: {
        mode: "custom",
        word: cipherWord || settings.secretCipher.word || "",
      },
    });
  };

  /** Typing into the legacy field seeds the first character of each digit. */
  const applyLegacyWord = (raw: string) => {
    setCipherWord(raw);
    const next = emptyGroupText();
    Array.from(raw)
      .slice(0, 10)
      .forEach((ch, index) => {
        const digit = (index === 9 ? "0" : String(index + 1)) as CipherDigit;
        next[digit] = ch.trim() ? ch.toUpperCase() : "";
      });
    setGroupText(next);
  };

  const openLogoPicker = () => {
    const input = hiddenLogoInput.current;
    if (!input) return;
    // Clear first so picking the same file again still fires onChange.
    input.value = "";
    input.click();
  };

  const onLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast.error(LOGO_SIZE_ERROR);
      return;
    }
    if (!LOGO_TYPES.includes(file.type)) {
      toast.error(LOGO_TYPE_ERROR);
      return;
    }
    const path = file.name.slice(0, 240);
    updateProfile({ logoPath: path });
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image/")) return;
      setLogoPreview(dataUrl);
      try {
        localStorage.setItem(
          LOGO_PREVIEW_KEY,
          JSON.stringify({ path, dataUrl })
        );
      } catch {
        // Storage can be full or disabled — the filename still saves normally.
      }
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    updateProfile({ logoPath: "" });
    setLogoPreview(null);
    try {
      localStorage.removeItem(LOGO_PREVIEW_KEY);
    } catch {
      // Storage can be full or disabled — nothing to clear in that case.
    }
    if (hiddenLogoInput.current) hiddenLogoInput.current.value = "";
  };

  const copyCode = async () => {
    if (!encodedTest) return;
    try {
      await navigator.clipboard?.writeText(encodedTest);
    } catch {
      // Clipboard access can be blocked; the visible badge still shows it.
    }
    toast.success("কোড কপি হয়েছে");
  };

  const invalidCipherNotice = () =>
    hasCollision
      ? (groupValidation.error ?? CIPHER_INVALID_NOTICE)
      : CIPHER_INVALID_NOTICE;

  // An untouched install has no ShopSettings row (updatedAt === null) and no
  // completed flag. A saved row retires onboarding even if storage was cleared.
  const needsOnboarding =
    !onboardingDone &&
    !onboardingDismissed &&
    (!settings.updatedAt || !settings.shopName.trim());

  const startShopProfileSetup = () => {
    const input = document.getElementById(
      "setting-shop-name"
    ) as HTMLInputElement | null;
    if (!input) return;
    input.scrollIntoView({ behavior: "smooth", block: "center" });
    input.focus({ preventScroll: true });
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current);
    setShopNamePulse(true);
    pulseTimer.current = window.setTimeout(() => {
      setShopNamePulse(false);
      pulseTimer.current = null;
    }, ONBOARDING_PULSE_MS);
  };

  const dismissOnboarding = () => {
    try {
      sessionStorage.setItem(ONBOARDING_SESSION_KEY, "1");
    } catch {
      // Blocked session storage still hides the banner until this tab reloads.
    }
    setOnboardingDismissed(true);
  };

  const handleSaveSettings = async () => {
    if (profile.secretCipher.mode === "custom" && !cipherValid) {
      toast.error(invalidCipherNotice());
      return;
    }
    setSaving(true);
    let data: { settings?: ClientShopSettings; error?: string } | null = null;
    try {
      const res = await fetch("/api/shop-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...profile,
          secretCipher: activeCipher,
        }),
      });
      data = (await res.json().catch(() => null)) as {
        settings?: ClientShopSettings;
        error?: string;
      } | null;
      if (!res.ok || !data?.settings) {
        throw new Error(data?.error ?? "সেটিংস সংরক্ষণ করা যায়নি");
      }
      applySettings(data.settings);
      // Completion is recorded only after the API confirms the save. The
      // persisted settings row is the durable signal if storage is disabled.
      try {
        localStorage.setItem(ONBOARDING_FLAG_KEY, "true");
        localStorage.setItem(PROFILE_FLAG_KEY, "true");
      } catch {
        // Private browsing or full storage cannot undo a successful save.
      }
      setOnboardingDone(true);
      toast.success("সব সেটিংস সফলভাবে সংরক্ষিত হয়েছে!");
    } catch (err) {
      // Never replace the API's real validation/database error with a blind
      // fallback; only a malformed/empty response uses the generic message.
      toast.error(
        data?.error ??
          (err instanceof Error && err.message
            ? err.message
            : "সেটিংস সংরক্ষণ করা যায়নি")
      );
    } finally {
      setSaving(false);
    }
  };

  /**
   * One-click global sync. `save` PUTs the exact active map to ShopSettings and
   * immediately replaces the shared React context value, so every consumer —
   * /service PartsEditor price preview, /parts ledger, receipt — re-renders
   * with the new cipher without a page reload. Stored services are untouched.
   */
  const syncGlobal = async () => {
    if (!cipherValid) {
      toast.error(invalidCipherNotice());
      return;
    }
    setSaving(true);
    try {
      await save({
        ...profile,
        secretCipher: activeCipher,
      });
      toast.success(CIPHER_SYNC_TOAST);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "সিঙ্ক করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl px-3 pb-6 pt-4 xl:max-w-[1600px] 2xl:max-w-[1840px]">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-maher-royal">
            {settings.shopName}
          </p>
          <h1
            data-testid="dashboard-title"
            className="text-2xl font-extrabold text-maher-navy"
          >
            ড্যাশবোর্ড
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            দোকানের হিসাব ও সেটিংস — এক জায়গায়।
          </p>
        </div>
        <Link href="/service">
          <Button variant="outline" className="gap-2">
            সার্ভিস পেজে যান <ArrowUpRight className="h-4 w-4" />
          </Button>
        </Link>
      </header>

      {/* ---------------- Zone 1: Business Overview ---------------- */}
      <Zone
        eyebrow="Business Overview"
        title="ব্যবসার হালচাল"
        icon={<BadgeCheck className="h-5 w-5" />}
        testId="dashboard-zone-overview"
        targetId="zone-overview"
        otherId="zone-admin"
        jumpTestId="dashboard-jump-admin"
        jumpLabel="শপ সেটিংস"
      >
        <Section
          title="ওভারভিউ"
          hint={loading ? "লোড হচ্ছে…" : undefined}
          icon={<BadgeCheck className="h-4 w-4" />}
          testId="dashboard-overview"
        >
          <div
            data-testid="dashboard-metrics"
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <StatCard
              title="আজকের জমা ও সার্ভিস"
              value={formatTaka(overview.todayCash)}
              sub={`নতুন সার্ভিস ${overview.todayCount} · আজ জমা`}
              icon={<Wrench className="h-4 w-4" />}
              testId="dashboard-today"
              footer={
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-maher-navy">
                  <BadgeCheck className="h-3.5 w-3.5 text-maher-done" />
                  আজকের হিসাব
                </span>
              }
            />
            <StatCard
              title="কাস্টমার বাকি"
              value={formatTaka(overview.customerDues)}
              sub="মোট কাস্টমার বকেয়া"
              icon={<Wallet className="h-4 w-4" />}
              tone="blue"
              testId="dashboard-finance"
              footer={
                <DuesTrigger className="h-8 w-full justify-center gap-1.5 px-2 text-[11px] font-bold">
                  {`💰 সব তারিখের বাকি (${overview.customerDuesCount}টি ডিভাইস • ${formatTaka(overview.customerDues)})`}
                </DuesTrigger>
              }
            />
            <StatCard
              title="সাপ্লায়ার দেনা"
              value={formatTaka(overview.supplierDues)}
              sub="মোট সাপ্লায়ার বকেয়া"
              icon={<Landmark className="h-4 w-4" />}
              tone="due"
              testId="dashboard-payables"
              footer={
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-maher-due">
                  <CircleAlert className="h-3.5 w-3.5" />
                  পরিশোধ বাকি
                </span>
              }
            />
            <StatCard
              title="স্বল্প স্টক প্রোডাক্ট"
              value={String(overview.lowStockCount)}
              sub="স্টক শেষ হওয়ার পথে"
              icon={<Boxes className="h-4 w-4" />}
              tone="warning"
              testId="dashboard-inventory"
              footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    data-testid="dashboard-low-stock"
                    href="/products"
                    className="inline-flex items-center gap-1 text-xs font-bold text-maher-navy hover:text-maher-royal"
                  >
                    প্রোডাক্ট স্টক <ArrowUpRight className="h-3 w-3" />
                  </Link>
                  {overview.lowStockCount > 0 ? (
                    <span className="rounded-full bg-maher-warning/10 px-2 py-0.5 text-[10px] font-bold text-maher-warning">
                      সতর্কতা
                    </span>
                  ) : null}
                </div>
              }
            />
          </div>
        </Section>

        {needsOnboarding ? (
          <div
            data-testid="shop-onboarding-banner"
            className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/90 rounded-2xl p-4 shadow-sm mb-6 flex flex-col md:flex-row items-center justify-between gap-4"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-amber-200 bg-amber-100 text-lg"
              >
                🏬
              </span>
              <div className="min-w-0">
                <p className="font-bold text-slate-800 text-sm">
                  স্বাগতম! আপনার দোকানের নাম ও প্রাথমিক তথ্য সেটআপ করে নিন
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  কাস্টমার রিসিট ও বিল ভাউচারে আপনার সঠিক নাম, মোবাইল ও ঠিকানা প্রিন্ট করতে শপ প্রোফাইলটি সংরক্ষণ করুন।
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3">
              <Button
                type="button"
                data-testid="shop-onboarding-setup"
                onClick={startShopProfileSetup}
                className="gap-2 whitespace-nowrap rounded-xl bg-maher-navy px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-maher-navy/90"
              >
                ✏️ শপ প্রোফাইল সেটআপ করুন
              </Button>
              <button
                type="button"
                data-testid="shop-onboarding-dismiss"
                onClick={dismissOnboarding}
                className="text-xs font-medium text-slate-500 underline-offset-4 transition hover:text-slate-700 hover:underline"
              >
                পরে করব ✕
              </button>
            </div>
          </div>
        ) : null}

        <Section
          title="কুইক অ্যাকশন"
          hint="এক ক্লিকে কাজ শুরু করুন"
          icon={<Plus className="h-4 w-4" />}
          testId="dashboard-quick-actions"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <QuickActionCard
              href="/service"
              testId="quick-service"
              icon={<Wrench className="h-5 w-5" />}
              title="নতুন সার্ভিস"
              description="ডিভাইস এন্ট্রি ও বিল তৈরি করুন"
              action={
                <span className="inline-flex items-center gap-1 text-xs font-bold text-maher-navy transition-colors group-hover:text-maher-royal">
                  <span data-testid="quick-service-btn" className="sr-only" />
                  সার্ভিস এন্ট্রি <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              }
            />
            <QuickActionCard
              href="/service?mode=product"
              testId="quick-sale"
              tone="blue"
              icon={<Package className="h-5 w-5" />}
              title="প্রোডাক্ট বিক্রি"
              description="স্টক থেকে প্রোডাক্ট বিক্রি করুন"
              action={
                <span className="inline-flex items-center gap-1 text-xs font-bold text-maher-navy transition-colors group-hover:text-maher-royal">
                  <span data-testid="quick-product-btn" className="sr-only" />
                  বিক্রি শুরু করুন <ArrowUpRight className="h-3.5 w-3.5" />
                </span>
              }
            />
            <QuickActionCard
              testId="quick-report"
              tone="steel"
              icon={<ReceiptText className="h-5 w-5" />}
              title="ব্যবসায়িক রিপোর্ট"
              description="দিন, মাস ও সব তারিখের হিসাব"
              onClick={() => {
                document
                  .querySelector<HTMLElement>('[data-testid="open-report"]')
                  ?.click();
              }}
              action={
                <>
                  <span className="sr-only" data-testid="quick-report-btn" />
                  <ReportDock
                  variant="ghost"
                  className="h-auto min-h-0 w-full justify-start gap-1.5 p-0 text-xs font-bold text-maher-navy hover:bg-transparent hover:text-maher-royal"
                >
                  রিপোর্ট খুলুন <ArrowUpRight className="h-3.5 w-3.5" />
                </ReportDock>
                </>
              }
            />
            <QuickActionCard
              testId="quick-backup"
              tone="warning"
              icon={<DatabaseBackup className="h-5 w-5" />}
              title="ডাটা ব্যাকআপ"
              description="সব তথ্যের নিরাপদ কপি নিন"
              onClick={() => setShowExport(true)}
              action={
                <>
                  <span className="sr-only" data-testid="quick-backup-btn" />
                  <Button
                  variant="ghost"
                  className="h-auto min-h-0 w-full justify-start gap-1.5 p-0 text-xs font-bold text-maher-navy hover:bg-transparent hover:text-maher-royal"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowExport(true);
                  }}
                  data-testid="dashboard-backup"
                >
                  <Download className="h-3.5 w-3.5" />
                  এখন ব্যাকআপ নিন
                </Button>
                </>
              }
            />
          </div>
        </Section>
      </Zone>

      {/* ---------------- Zone 2: Shop Administration ---------------- */}
      <Zone
        eyebrow="Shop Administration"
        title="শপ সেটিংস"
        icon={<Store className="h-5 w-5" />}
        testId="dashboard-zone-admin"
        targetId="zone-admin"
        otherId="zone-overview"
        jumpTestId="dashboard-jump-overview"
        jumpLabel="ওভারভিউতে ফিরুন"
        jumpIcon={<ArrowUp className="h-3.5 w-3.5" />}
      >
        <div className="sticky top-3 z-30 mb-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-maher-navy/20 bg-white/95 p-3 shadow-panel backdrop-blur">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-maher-royal">
              Save &amp; Sync
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              দোকানের তথ্য, লোগো ও কোড — সব একসাথে সংরক্ষিত হবে।
            </p>
          </div>
          <Button
            onClick={handleSaveSettings}
            disabled={actionsDisabled}
            data-testid="dashboard-save-settings"
            className="h-10 gap-2 whitespace-nowrap px-4"
          >
            <ShieldCheck className="h-4 w-4" />
            <span data-testid="btn-save-all-settings" className="sr-only" />
            <span data-testid="save-shop-settings" className="sr-only" />
            {saving
              ? "সংরক্ষণ হচ্ছে…"
              : "💾 সব সেটিংস সংরক্ষণ ও পুরো সিস্টেমে সিঙ্ক করুন"}
          </Button>
        </div>

        {/* Tier 1: Profile + Preview and Cipher engine — equal height columns */}
        <div className="grid items-stretch gap-3 xl:grid-cols-2">
          <Section
            title="দোকানের প্রোফাইল"
            hint="ব্র্যান্ডিং ও যোগাযোগ"
            icon={<Store className="h-4 w-4" />}
            testId="dashboard-settings"
            className="flex h-full min-w-0 flex-col"
            bodyClassName="flex flex-1 flex-col"
          >
            <div className="min-w-0 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="setting-shop-name">দোকানের নাম</Label>
                  <Input
                    id="setting-shop-name"
                    data-testid="setting-shop-name"
                    value={profile.shopName}
                    onChange={(e) => updateProfile({ shopName: e.target.value })}
                    className={`border-slate-300 focus-visible:ring-slate-900/15 ${
                      shopNamePulse ? "ring-2 ring-amber-300 animate-pulse" : ""
                    }`}
                  />
                    <span data-testid="shop-name-input" className="sr-only" />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="setting-slogan">স্লোগান</Label>
                  <span data-testid="shop-tagline-input" className="sr-only" />
                  <Input
                    id="setting-slogan"
                    value={profile.slogan}
                    onChange={(e) => updateProfile({ slogan: e.target.value })}
                    className="border-slate-300 focus-visible:ring-slate-900/15"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <Label htmlFor="setting-address">ঠিকানা</Label>
                <span data-testid="shop-address-input" className="sr-only" />
                <Input
                  id="setting-address"
                  value={profile.address}
                  onChange={(e) => updateProfile({ address: e.target.value })}
                  className="border-slate-300 focus-visible:ring-slate-900/15"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="setting-phone">মোবাইল</Label>
                  <span data-testid="shop-phone-input" className="sr-only" />
                  <Input
                    id="setting-phone"
                    value={profile.phone}
                    onChange={(e) => updateProfile({ phone: e.target.value })}
                    className="border-slate-300 focus-visible:ring-slate-900/15"
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="setting-whatsapp">WhatsApp</Label>
                  <span data-testid="shop-whatsapp-input" className="sr-only" />
                  <Input
                    id="setting-whatsapp"
                    value={profile.whatsapp}
                    onChange={(e) => updateProfile({ whatsapp: e.target.value })}
                    className="border-slate-300 focus-visible:ring-slate-900/15"
                  />
                </div>
              </div>
              <div className="min-w-0">
                <Label htmlFor="setting-terms">রিসিটের শর্তাবলী</Label>
                <Textarea
                  id="setting-terms"
                  data-testid="setting-terms"
                  rows={3}
                  value={profile.terms}
                  onChange={(e) => updateProfile({ terms: e.target.value })}
                  placeholder="গ্যারান্টি ও ফেরত সংক্রান্ত শর্ত…"
                  className="border-slate-300 focus-visible:ring-slate-900/15"
                />
                  <span data-testid="shop-terms-input" className="sr-only" />
              </div>

              <div className="rounded-xl border border-maher-border bg-maher-surface/60 p-3">
                <div className="flex items-center gap-2 text-sm font-bold text-maher-navy">
                  <FileImage className="h-4 w-4 text-maher-royal" />
                  দোকানের লোগো
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-3">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-maher-border bg-white">
                    {logoPreview ? (
                      // Local data-URL preview only — never a remote image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        data-testid="logo-preview-image"
                        src={logoPreview}
                        alt="লোগো প্রিভিউ"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <FileImage className="h-6 w-6 text-maher-gloss" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <input
                      id="setting-logo"
                      data-testid="setting-logo"
                      ref={hiddenLogoInput}
                      type="file"
                      accept={LOGO_ACCEPT}
                      aria-label="দোকানের লোগো"
                      className="sr-only"
                      onChange={onLogoChange}
                    />
                    <span data-testid="shop-logo-upload" className="sr-only" />
                    {profile.logoPath ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="shop-logo-change-btn"
                          onClick={openLogoPicker}
                          className="h-8 gap-1.5 px-2.5 text-xs"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          🔄 পরিবর্তন করুন
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="shop-logo-remove-btn"
                          onClick={removeLogo}
                          className="h-8 gap-1.5 border-rose-200 px-2.5 text-xs text-rose-700 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          🗑️ লোগো মুছুন
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        data-testid="shop-logo-upload-btn"
                        onClick={openLogoPicker}
                        className="h-8 gap-1.5 px-2.5 text-xs"
                      >
                        <FileImage className="h-3.5 w-3.5" />
                        🖼️ ছবি বাছুন
                      </Button>
                    )}
                    <p
                      className="mt-1 max-w-[220px] truncate text-xs text-muted-foreground"
                      title={profile.logoPath ?? ""}
                    >
                      {profile.logoPath || "সর্বোচ্চ ২MB (PNG, JPG, WEBP)"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-maher-border bg-maher-surface/50 p-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-maher-royal">
                <BadgeCheck className="h-3.5 w-3.5" />
                ব্র্যান্ড প্রিভিউ
              </div>
              <div
                data-testid="brand-preview"
                className="mt-2 flex min-w-0 items-center gap-3"
              >
                <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-maher-border bg-white">
                  {logoPreview ? (
                    // Local preview only; the picker above owns the testid.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoPreview}
                      alt="লোগো প্রিভিউ"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <Store className="w-5 h-5 text-slate-700" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-maher-navy">
                    {profile.shopName || "দোকানের নাম"}
                  </p>
                  <p className="truncate text-[11px] text-maher-royal">
                    {profile.slogan || "স্লোগান যোগ করুন"}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0 text-maher-royal" />
                    <span className="truncate">{profile.address || "ঠিকানা যোগ করুন"}</span>
                  </p>
                </div>
                <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-maher-navy">
                    {profile.phone || "মোবাইল নেই"}
                  </span>
                  <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-maher-navy">
                    {profile.whatsapp || "WhatsApp নেই"}
                  </span>
                </div>
              </div>
              <p className="mt-2 truncate text-[11px] text-muted-foreground sm:hidden">
                {profile.phone || "মোবাইল নেই"} · {profile.whatsapp || "WhatsApp নেই"}
              </p>
              <p className="mt-2 border-t border-maher-border pt-2 text-[11px] leading-snug text-muted-foreground">
                এই তথ্যগুলো রিসিট ও হেডারে ব্যবহার হয়। সংরক্ষণ করলে পুরো সিস্টেমে তৎক্ষণাৎ দেখা যাবে।
              </p>
            </div>
          </Section>

          <Section
            title="গোপন কোড ইঞ্জিন"
            hint="টাকা ↔ কোড কনভার্টার"
            icon={<ShieldCheck className="h-4 w-4" />}
            testId="dashboard-cipher"
            className="flex h-full min-w-0 flex-col"
            bodyClassName="flex flex-1 flex-col"
          >
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={profile.secretCipher.mode === "keypad" ? "default" : "outline"}
                    onClick={() => updateProfile({ secretCipher: { mode: "keypad" } })}
                    data-testid="cipher-mode-keypad"
                  >
                    কীপ্যাড
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={profile.secretCipher.mode === "custom" ? "default" : "outline"}
                    onClick={switchToCustom}
                    data-testid="cipher-mode-custom"
                  >
                    কাস্টম কোড
                  </Button>
                </div>
                <span
                  data-testid="btn-sync-cipher-global"
                  className="inline-flex"
                  // The alias is the single click target; the inner button stays
                  // disabled for the shared gating contract and bubbles its
                  // keyboard/click activation up to this handler.
                  onClick={() => {
                    if (!actionsDisabled) void syncGlobal();
                  }}
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={actionsDisabled}
                    data-testid="cipher-sync-global"
                    className="h-8 gap-1.5 border-slate-300 text-[11px] font-semibold text-maher-navy hover:bg-maher-surface disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    সিঙ্ক করুন
                  </Button>
                </span>
              </div>

              {profile.secretCipher.mode === "custom" && hasCollision ? (
                <p
                  id="cipher-collision-error"
                  data-testid="cipher-collision-error"
                  role="alert"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-900"
                >
                  {groupValidation.error ?? CIPHER_INVALID_NOTICE}
                </p>
              ) : null}

              {profile.secretCipher.mode === "custom" ? (
                <div data-testid="cipher-custom-slots" className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground">
                      প্রতিটি অঙ্কের জন্য এক বা একাধিক অক্ষর দিন (A, B, C বা ABC)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={loadKeypadPreset}
                        data-testid="cipher-preset-keypad"
                        className="h-7 gap-1 text-[11px]"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        কীপ্যাড প্রিসেট লোড করুন
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={clearGroups}
                        data-testid="cipher-clear-groups"
                        className="h-7 text-[11px]"
                      >
                        ক্লিয়ার
                      </Button>
                    </div>
                  </div>
                  <div
                    data-testid="cipher-multi-grid"
                    className="grid min-w-0 grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4"
                  >
                    {CIPHER_DIGITS.map((digit) => {
                      const testId = digit === "00" ? "cipher-group-00" : `cipher-slot-${digit}`;
                      const conflicted = conflictDigits.has(digit);
                      return (
                        <label key={digit} className="min-w-0 text-center">
                          <span className="block text-[11px] font-bold text-muted-foreground">
                            {SLOT_LABELS[digit]}
                          </span>
                          <input
                            id={testId}
                            data-testid={testId}
                            data-digit={digit}
                            value={slotValue(digit)}
                            onChange={(e) => updateGroup(digit, e.target.value)}
                            placeholder={digit === "00" ? "#" : "A, B"}
                            aria-invalid={conflicted ? true : undefined}
                            aria-describedby={conflicted ? "cipher-collision-error" : undefined}
                            className={cn(
                              "mt-1.5 h-11 w-full min-w-0 rounded-lg border bg-white px-2.5 text-center font-mono text-sm font-bold uppercase tracking-tight outline-none focus:ring-2",
                              conflicted
                                ? "border-rose-500 ring-2 ring-rose-400 bg-rose-50/40 text-rose-900 placeholder:text-maher-due/60 focus:ring-maher-due/40"
                                : "border-slate-300 text-maher-navy focus:ring-slate-900/15"
                            )}
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="sr-only">
                    <Label htmlFor="cipher-word">কাস্টম কোড (পুরনো ১০-অক্ষর ফরম্যাট)</Label>
                    <Input
                      id="cipher-word"
                      data-testid="cipher-word"
                      value={cipherWord}
                      onChange={(e) => applyLegacyWord(e.target.value)}
                      placeholder="ABCDEFGHIJ"
                      className="sr-only"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    ফোনের কীপ্যাড — প্রতিটি বোতামের কোড দেখুন
                  </p>
                  <div
                    data-testid="cipher-keypad"
                    className="grid min-w-0 grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-4"
                  >
                    {KEYPAD_CARDS.map((key, index) => (
                      <div
                        key={key.testId}
                        data-testid={key.testId}
                        title={key.hint}
                        className="flex h-[84px] min-w-0 flex-col items-center justify-center rounded-lg border border-maher-border bg-maher-surface/40 px-1 py-2 text-center shadow-card"
                      >
                        <span className="block text-[11px] font-bold text-muted-foreground">
                          {SLOT_LABELS[key.digit]}
                        </span>
                        <span className="mt-1 truncate font-mono text-sm font-extrabold text-maher-navy">
                          {key.code}
                        </span>
                        {key.hint ? (
                          <span className="mt-0.5 truncate text-[9px] text-muted-foreground">
                            {key.hint}
                          </span>
                        ) : null}
                        {index === 0 ? (
                          <span data-testid="cipher-key-star" className="sr-only">
                            * = ১
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div
                data-testid="cipher-converter"
                className="rounded-xl border border-maher-navy/15 bg-white p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-xs font-bold text-maher-navy">
                  <ArrowLeftRight className="h-3.5 w-3.5 text-maher-royal" />
                  টাকা ↔ কোড কনভার্টার
                </div>
                {profile.secretCipher.mode === "custom" && !cipherValid ? (
                  <p
                    role="status"
                    className="mb-2 rounded-md bg-maher-due/10 px-2 py-1 text-xs font-semibold text-maher-due"
                  >
                    {CIPHER_INVALID_NOTICE}
                  </p>
                ) : null}
                <div className="grid gap-3">
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-2">
                    <div className="min-w-0" data-testid="cipher-test-amount">
                      <Label htmlFor="cipher-test-amount" className="text-[10px] text-muted-foreground">
                        টাকা
                      </Label>
                      <Input
                        id="cipher-test-amount"
                        data-testid="cipher-taka-input"
                        inputMode="numeric"
                        value={testAmount}
                        onChange={(e) => setTestAmount(e.target.value)}
                        placeholder="টাকা লিখুন (যেমন: ১৫০০)"
                        className="mt-1 h-10 border-slate-300 focus-visible:ring-slate-900/15"
                      />
                    </div>
                    <ArrowRight className="mb-3 h-4 w-4 shrink-0 text-maher-gloss" />
                    <div className="mb-0.5 grid h-10 min-w-[84px] place-items-center rounded-lg bg-maher-navy px-2">
                      <span
                        data-testid="cipher-encoded"
                        className="font-mono text-base font-extrabold text-white"
                      >
                        <span data-testid="cipher-taka-result">{encodedTest || "—"}</span>
                      </span>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => void copyCode()}
                      data-testid="cipher-copy-code"
                      aria-label="কোড কপি করুন"
                      title="কোড কপি করুন"
                      className="mb-0.5 h-10 w-10 shrink-0 border-slate-300"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
                    <div className="min-w-0" data-testid="cipher-test-code">
                      <Label htmlFor="cipher-test-code" className="text-[10px] text-muted-foreground">
                        কোড
                      </Label>
                      <Input
                        id="cipher-test-code"
                        data-testid="cipher-code-input"
                        value={testCode}
                        onChange={(e) => setTestCode(e.target.value)}
                        placeholder="কোড লিখুন (যেমন: *J#)"
                        className="mt-1 h-10 border-slate-300 font-mono focus-visible:ring-slate-900/15"
                      />
                    </div>
                    <ArrowRight className="mb-3 h-4 w-4 shrink-0 text-maher-gloss" />
                    <div className="mb-0.5 grid h-10 min-w-[112px] place-items-center rounded-lg bg-maher-blue-soft px-2">
                      <span
                        data-testid="cipher-decoded"
                        className="text-sm font-extrabold tabular-nums text-maher-navy"
                      >
                        <span data-testid="cipher-code-result">{decodedTest ?? "—"}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Section>
        </div>

        {/* Tier 2: Staff and Data Safety — equal height columns */}
        <div className="grid items-stretch gap-3 xl:grid-cols-2">
          <Section
            title="টেকনিশিয়ান ম্যানেজমেন্ট"
            hint="ইতিহাস সুরক্ষিত"
            icon={<Users className="h-4 w-4" />}
            testId="dashboard-technicians"
            className="flex h-full min-w-0 flex-col"
            bodyClassName="flex flex-1 flex-col"
          >
            <div className="flex flex-1 flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-maher-border bg-maher-surface/70 text-maher-royal">
                    <Users className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p
                      data-testid="dashboard-technician-count"
                      className="text-lg font-extrabold text-maher-navy"
                    >
                      {toBnDigits(overview.activeTechnicians)} জন সক্রিয় টেকনিশিয়ান
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      নাম যোগ বা সম্পাদনা করুন। পুরনো এন্ট্রি নিশ্চিতকরণসহ আপডেট হবে।
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-maher-border bg-maher-surface px-2.5 py-1 text-[11px] font-semibold text-maher-navy">
                    <Users className="h-3.5 w-3.5 text-maher-royal" />
                    স্টাফ তালিকা
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2E7D5C]/25 bg-[#2E7D5C]/10 px-2.5 py-1 text-[11px] font-semibold text-[#2E7D5C]">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    ইতিহাস সুরক্ষিত
                  </span>
                </div>
              </div>
              <span data-testid="btn-manage-technicians" className="inline-flex">
                <Button
                  onClick={() => setShowTech(true)}
                  data-testid="dashboard-open-technician-manager"
                  className="shrink-0 gap-2"
                >
                  <Users className="h-4 w-4" /> 👥 টেকনিশিয়ান ম্যানেজ করুন
                </Button>
              </span>
            </div>
            <TechnicianManager
              open={showTech}
              onClose={() => setShowTech(false)}
              onChanged={() => void loadOverview()}
            />
          </Section>

          <Section
            title="ডাটা নিরাপত্তা"
            hint="সব ডাটা এই পিসিতেই"
            icon={<DatabaseBackup className="h-4 w-4" />}
            testId="dashboard-data-safety"
            className="flex h-full min-w-0 flex-col"
            bodyClassName="flex flex-1 flex-col"
          >
            <div className="flex flex-1 flex-col gap-3">
              <div className="rounded-xl border border-maher-border bg-white p-3">
                <p className="text-xs text-muted-foreground">শেষ ব্যাকআপ</p>
                <p
                  data-testid="dashboard-last-backup"
                  className="mt-1 text-sm font-bold text-maher-navy"
                >
                  {lastBackup ?? snapshotStamp ?? "এখনো নেই"}
                </p>
              </div>

              <div className="rounded-xl border border-maher-border bg-[#F3F5F7] p-3">
                <p className="text-xs text-muted-foreground">বর্তমান ডাটাবেজ লোকেশন</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <p
                    data-testid="dashboard-db-path"
                    className="break-all text-sm font-bold text-maher-navy"
                  >
                    {dbLocation?.activePath ?? "লোড হচ্ছে…"}
                  </p>
                  {dbLocation && !dbLocation.fallbackReason ? (
                    <span
                      data-testid="db-path-active-badge"
                      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#2E7D5C]/30 bg-[#2E7D5C]/10 px-2 py-0.5 text-[11px] font-bold text-[#2E7D5C]"
                    >
                      <span aria-hidden="true">●</span> সক্রিয়
                    </span>
                  ) : null}
                </div>
                {dbLocation?.fallbackReason ? (
                  <p
                    data-testid="dashboard-db-path-fallback"
                    role="alert"
                    className="mt-2 flex items-start gap-1.5 rounded-lg border border-[#9A6714]/40 bg-[#9A6714]/10 p-2 text-xs text-[#9A6714]"
                  >
                    <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {dbLocation.fallbackReason}
                  </p>
                ) : null}
              </div>

              <div className="mt-auto grid gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  className="h-10 gap-2"
                  onClick={() => setShowRestore(true)}
                  data-testid="dashboard-restore"
                >
                  <History className="h-4 w-4" />
                  <span data-testid="btn-restore-backup">↺ ব্যাকআপ ফেরত আনুন</span>
                </Button>
                <Button
                  variant="secondary"
                  className="h-10 gap-2"
                  onClick={() => {
                    setTargetDbPath(dbLocation?.activePath ?? "");
                    setShowDbPath(true);
                  }}
                  data-testid="btn-change-db-path"
                >
                  <FolderOpen className="h-4 w-4" /> 📂 ডাটাবেজ লোকেশন পরিবর্তন করুন
                </Button>
              </div>
            </div>

            <Dialog
              open={showDbPath}
              onOpenChange={(next) => {
                if (!next && !migrating) setShowDbPath(false);
              }}
            >
              <DialogContent className="max-h-[92dvh] overflow-y-auto border-slate-200 bg-white sm:max-w-lg">
                <DialogHeader>
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#223D57] text-white">
                      <FolderOpen className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <DialogTitle className="text-left text-xl font-bold text-[#1F2A36]">
                        ডাটাবেজ লোকেশন পরিবর্তন করুন
                      </DialogTitle>
                      <DialogDescription className="mt-1 text-left text-sm text-[#5E6B78]">
                        টার্গেট ফোল্ডার বা সম্পূর্ণ পাথ দিন (উদাহরণ: D:\MAHER_DATA)। ফোল্ডার না থাকলে স্বয়ংক্রিয়ভাবে তৈরি হবে; ডাটা নতুন লোকেশনে কপি হবে, পুরনো ফাইল নিরাপদে থেকে যাবে।
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="grid gap-2">
                  <Label htmlFor="db-path-target">টার্গেট ফোল্ডার বা সম্পূর্ণ পাথ</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="db-path-target"
                      data-testid="db-path-target-input"
                      value={targetDbPath}
                      onChange={(e) => setTargetDbPath(e.target.value)}
                      placeholder={"উদাহরণ: D:\\MAHER_DATA"}
                      disabled={migrating}
                      autoComplete="off"
                      className="min-w-0 flex-1 border-slate-300 focus-visible:ring-slate-900/15"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      data-testid="btn-browse-db-folder"
                      disabled={migrating || pickingFolder}
                      onClick={() => void browseDbFolder()}
                      className="gap-2 sm:w-auto"
                    >
                      {pickingFolder ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderOpen className="h-4 w-4" />
                      )}
                      ফোল্ডার নির্বাচন করুন / ব্রাউজ
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {DB_PATH_PRESETS.map((drive) => (
                      <Button
                        key={drive}
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid={`preset-${drive.toLowerCase()}-drive`}
                        disabled={migrating}
                        onClick={() => applyDrivePreset(drive)}
                        className="gap-1.5"
                      >
                        <HardDrive className="h-3.5 w-3.5" />
                        {`${drive}:\\MAHER_DATA`}
                      </Button>
                    ))}
                  </div>

                  <p
                    data-testid="db-path-target-preview"
                    className="break-all rounded-lg border border-maher-blue/30 bg-maher-blue/5 p-2 text-xs font-semibold text-maher-navy"
                  >
                    👉 চূড়ান্ত ডাটাবেজ ফাইল: {targetPreview || "—"}
                  </p>

                  <p
                    data-testid="db-path-warning"
                    className="rounded-lg border border-[#B23A3A]/40 bg-[#B23A3A]/10 p-2 text-xs font-semibold text-[#B23A3A]"
                  >
                    {DB_PATH_WARNING}
                  </p>

                  <input
                    ref={hiddenFolderInput}
                    type="file"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={onHiddenFolderChange}
                  />
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={migrating}
                    onClick={() => setShowDbPath(false)}
                  >
                    বাতিল
                  </Button>
                  <Button
                    type="button"
                    data-testid="db-path-confirm"
                    disabled={migrating || !targetDbPath.trim()}
                    onClick={() => void changeDbPath()}
                    className="gap-2"
                  >
                    {migrating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {DB_PATH_LOADING}
                      </>
                    ) : (
                      <>
                        <FolderOpen className="h-4 w-4" /> স্থানান্তর করুন
                      </>
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <BackupExportDialog
              open={showExport}
              onClose={() => setShowExport(false)}
              onExported={() => void loadOverview()}
            />
            <RestoreDialog
              open={showRestore}
              onClose={() => setShowRestore(false)}
              onRestored={() => {
                void refresh();
                void loadOverview();
              }}
            />
          </Section>
        </div>

        {/* Subscription hub sits at the END of Shop Administration: placing it
            above the cipher editor pushes the mode buttons under the sticky
            Save & Sync bar, where Puppeteer clicks hit the overlay instead. */}
        <div className="mt-3">
          <LicenseCard />
        </div>
      </Zone>

      <div className="mt-5">
        <ShopFooter />
      </div>
    </main>
  );
}
