"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AppHeader } from "@/components/AppHeader";
import type { ServiceDTO } from "@/lib/types";

type HeaderConfig = {
  searchRefreshKey: number;
  onSearchEdit: (service: ServiceDTO) => void;
  onSearchReceipt: (service: ServiceDTO) => void;
};

const NOOP = () => {};
const INITIAL: HeaderConfig = {
  searchRefreshKey: 0,
  onSearchEdit: NOOP,
  onSearchReceipt: NOOP,
};

/** Swaps in the current page's global-search handlers. Stable identity — the
 *  pages call it from an effect, so re-rendering the chrome must not re-run
 *  that effect (and re-render the pages) in turn. */
const RegisterHeader = createContext<(config: HeaderConfig) => void>(NOOP);

/**
 * The service desk's own search result opens a row in the form; inventory's
 * search result hops back to `/service?edit=…`. Those handlers used to live
 * inside each page, so the whole header unmounted on navigation and the blue
 * bar visibly flickered. The header now lives in the root layout and each
 * page only swaps the two callbacks (and the refresh key) through this hook.
 */
export function useAppHeader(config: HeaderConfig) {
  const register = useContext(RegisterHeader);
  const { searchRefreshKey, onSearchEdit, onSearchReceipt } = config;
  useEffect(() => {
    register({ searchRefreshKey, onSearchEdit, onSearchReceipt });
  }, [register, searchRefreshKey, onSearchEdit, onSearchReceipt]);
}

/**
 * Persistent masthead + page content. The wrapper reproduces the exact
 * container the header used to sit in (`mx-auto max-w-7xl px-3`, with the same
 * 2xl breakpoints) so the measured edges stay identical while the bar itself
 * survives client-side navigation. Sticky lives on this wrapper, not on the
 * header inside it: a sticky element is bounded by its parent's box, and a
 * header-only wrapper ends at the header, so the bar would scroll away.
 */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<HeaderConfig>(INITIAL);
  const register = useCallback((next: HeaderConfig) => setConfig(next), []);

  return (
    <RegisterHeader.Provider value={register}>
      <div className="sticky top-0 z-40 mx-auto w-full max-w-7xl bg-maher-surface px-3 pt-2 print:hidden xl:max-w-[1600px] 2xl:max-w-[1840px]">
        <AppHeader
          searchRefreshKey={config.searchRefreshKey}
          onSearchEdit={config.onSearchEdit}
          onSearchReceipt={config.onSearchReceipt}
        />
      </div>
      {children}
    </RegisterHeader.Provider>
  );
}
