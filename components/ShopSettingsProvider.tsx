"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PLATFORM_BRAND, SHOP } from "@/lib/shop";
import type { CipherConfig } from "@/lib/secret-code";

/**
 * Client-side mirror of the singleton ShopSettings row. The server is the
 * source of truth; this context just keeps the masthead, footer, receipt and
 * settings panel in sync without a page reload. A missing/unreadable row falls
 * back to an empty tenant profile, so every page renders even before the first
 * settings fetch resolves and onboarding stays visible.
 */
export type ClientShopSettings = {
  shopName: string;
  slogan: string;
  address: string;
  phone: string;
  whatsapp: string;
  terms: string;
  logoPath: string | null;
  secretCipher: CipherConfig;
  updatedAt: string | null;
};

export const DEFAULT_CLIENT_SETTINGS: ClientShopSettings = {
  shopName: SHOP.name,
  slogan: SHOP.tagline,
  address: SHOP.address,
  phone: SHOP.phone,
  whatsapp: SHOP.phone,
  terms: "",
  logoPath: null,
  secretCipher: { mode: "keypad" },
  updatedAt: null,
};

/** Dynamic document/window title: tenant name first, platform brand always. */
export function platformWindowTitle(shopName: string): string {
  const tenant = shopName.trim();
  return `${tenant ? `${tenant} — ` : ""}${PLATFORM_BRAND.windowTitle}`;
}

type SettingsContextValue = {
  settings: ClientShopSettings;
  cipher: CipherConfig;
  ready: boolean;
  refresh: () => Promise<void>;
  save: (input: Partial<ClientShopSettings>) => Promise<void>;
  applySettings: (settings: ClientShopSettings) => void;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_CLIENT_SETTINGS,
  cipher: DEFAULT_CLIENT_SETTINGS.secretCipher,
  ready: false,
  refresh: async () => {},
  save: async () => {},
  applySettings: () => {},
});

export function ShopSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<ClientShopSettings>(DEFAULT_CLIENT_SETTINGS);
  const [ready, setReady] = useState(false);

  // Keep the browser tab and the Electron window/taskbar in sync with the
  // tenant profile. The Electron main process owns the real native title; the
  // bridge is optional so the same component works on plain localhost.
  useEffect(() => {
    const title = platformWindowTitle(settings.shopName);
    const pushNativeTitle = () => {
      try {
        window.maherDesktop?.setWindowTitle?.(settings.shopName);
      } catch {
        // A bridge that is not ready yet must never break the settings UI.
      }
    };

    if (typeof document === "undefined") return;
    if (document.title !== title) document.title = title;
    pushNativeTitle();

    // Next.js route metadata rewrites document.title on client navigation.
    // Enforce the tenant title again whenever the head changes, without a timer
    // or a router-specific hook, so tab and taskbar never lose the shop name.
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (document.title !== title) {
        document.title = title;
        pushNativeTitle();
      }
    });
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [settings.shopName]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/shop-settings", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { settings?: Partial<ClientShopSettings> };
      if (data.settings) {
        setSettings({ ...DEFAULT_CLIENT_SETTINGS, ...data.settings });
      }
    } catch {
      // Offline / not-ready DB: keep the empty tenant profile.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: Partial<ClientShopSettings>) => {
      const res = await fetch("/api/shop-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = (await res.json()) as {
        settings?: ClientShopSettings;
        error?: string;
      };
      if (!res.ok || !data.settings) {
        throw new Error(data.error ?? "সেটিংস সংরক্ষণ করা যায়নি");
      }
      setSettings({ ...DEFAULT_CLIENT_SETTINGS, ...data.settings });
    },
    []
  );

  /** Publish an already-saved DTO to every consumer without another fetch. */
  const applySettings = useCallback((next: ClientShopSettings) => {
    setSettings({ ...DEFAULT_CLIENT_SETTINGS, ...next });
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      cipher: settings.secretCipher,
      ready,
      refresh,
      save,
      applySettings,
    }),
    [settings, ready, refresh, save, applySettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useShopSettings() {
  return useContext(SettingsContext);
}
