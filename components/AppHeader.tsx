"use client";

import { BrandMark } from "@/components/BrandMark";
import { AppNavLinks } from "@/components/AppNavLinks";
import { HeaderSearch, MobileSearch } from "@/components/HeaderSearch";
import type { ServiceDTO } from "@/lib/types";

/**
 * Shared navy chrome: brand left, three destinations centred, global search
 * right. Phones get two rows — brand + search, then a full-width three-tab
 * rail — while tablets and desktops stay on one measured row.
 */
export function AppHeader({
  searchRefreshKey = 0,
  onSearchEdit,
  onSearchReceipt,
  className,
}: {
  searchRefreshKey?: number;
  onSearchEdit: (service: ServiceDTO) => void;
  onSearchReceipt: (service: ServiceDTO) => void;
  className?: string;
}) {
  return (
    <header
      data-testid="app-header"
      className={`sticky top-0 z-40 rounded-xl border border-maher-navy/70 bg-maher-navy px-3 py-2.5 text-white shadow-sm md:py-2 print:hidden ${className ?? ""}`}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-4">
        <BrandMark className="col-start-1 row-start-1" />

        <div className="col-start-2 row-start-1 flex items-center justify-end gap-1.5 md:col-start-3">
          <MobileSearch
            refreshKey={searchRefreshKey}
            onEdit={onSearchEdit}
            onReceipt={onSearchReceipt}
          />
          <div className="hidden md:block">
            <HeaderSearch
              refreshKey={searchRefreshKey}
              onEdit={onSearchEdit}
              onReceipt={onSearchReceipt}
            />
          </div>
        </div>

        <AppNavLinks className="col-span-2 row-start-2 md:col-span-1 md:col-start-2 md:row-start-1 md:w-auto md:justify-self-center" />
      </div>
    </header>
  );
}
