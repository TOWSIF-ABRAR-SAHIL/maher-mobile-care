"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Store } from "lucide-react";
import { loadPartShopNames, summarizePartShopBills } from "@/lib/part-shops";
import { useAppHeader } from "@/components/AppChrome";
import { PageLead } from "@/components/PageLead";
import { PartsShopManagerDialog } from "@/components/PartsShopManagerDialog";
import { ShopFooter } from "@/components/ShopFooter";
import { ServicePartsLedger } from "@/components/ServicePartsLedger";
import { Button } from "@/components/ui/button";
import { dhakaDateKey } from "@/lib/dhaka";
import { partSupplierKey } from "@/lib/parts";
import type { ServiceDTO, ServicePartLedgerResponse } from "@/lib/types";

/** The parts half of the old product page, now its own navbar destination. */
export default function PartsPage() {
  const router = useRouter();
  const [shopNames, setShopNames] = useState<string[]>([]);
  const [shopManagerOpen, setShopManagerOpen] = useState(false);
  // A fresh object per click makes the ledger re-apply the same shop on
  // repeated jumps from the dialog instead of ignoring an unchanged string.
  const [shopFocus, setShopFocus] = useState<{
    key: string;
    nonce: number;
  } | null>(null);
  const [ledgerRows, setLedgerRows] = useState<
    ServicePartLedgerResponse["rows"]
  >([]);

  useEffect(() => {
    setShopNames(loadPartShopNames());
  }, []);

  // All-time part rows price the shop manager. The ledger below owns its own
  // filtered view; a failure here must never block the ledger or entry.
  const reloadLedgerRows = useCallback(async () => {
    try {
      const res = await fetch("/api/service-parts?status=all");
      const json = (await res.json().catch(() => ({}))) as Partial<
        ServicePartLedgerResponse
      >;
      if (res.ok && Array.isArray(json.rows)) setLedgerRows(json.rows);
    } catch {
      /* the ledger below reports its own load error */
    }
  }, []);

  useEffect(() => {
    void reloadLedgerRows();
  }, [reloadLedgerRows]);

  const shopBills = useMemo(
    () => summarizePartShopBills(shopNames, ledgerRows),
    [shopNames, ledgerRows]
  );

  // The dialog's 🔍 action only sets the ledger's supplier filter; the date
  // scope the shopkeeper already chose stays exactly where it is.
  const focusShop = (name: string) => {
    const key = partSupplierKey(name);
    if (!key) return;
    setShopFocus({ key, nonce: Date.now() });
    setShopManagerOpen(false);
  };

  // Global search still finds services; a hit opens its row on the service desk.
  const openServiceFromSearch = (service: ServiceDTO) => {
    router.push(
      `/service?date=${dhakaDateKey(service.serviceDate)}&edit=${service.id}`
    );
  };
  useAppHeader({
    searchRefreshKey: 0,
    onSearchEdit: openServiceFromSearch,
    onSearchReceipt: openServiceFromSearch,
  });

  return (
    <div className="flex min-h-dvh flex-col bg-maher-surface">
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-2 px-3 py-2 xl:max-w-[1600px] 2xl:max-w-[1840px]">
        <PageLead
          eyebrow="সার্ভিস পার্টস"
          title="পার্টসের দোকান ও খাতা"
          actions={
            <div className="flex w-full justify-end sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="parts-shop-manager-trigger"
                title="পার্টস কেনার দোকান যোগ করুন বা হিসাব দেখুন"
                onClick={() => setShopManagerOpen(true)}
                className="h-8"
              >
                <Store className="mr-1 h-4 w-4" />
                দোকান ব্যবস্থাপনা ({shopBills.shops.length}টি)
              </Button>
            </div>
          }
        />
        <section
          aria-label="সার্ভিস পার্টস"
          data-testid="service-khata-tab"
          className="space-y-3"
        >
          <ServicePartsLedger
            shopNames={shopNames}
            focusShop={shopFocus}
            onLedgerChanged={() => void reloadLedgerRows()}
          />
        </section>
      </main>

      <ShopFooter />

      <PartsShopManagerDialog
        open={shopManagerOpen}
        onClose={() => setShopManagerOpen(false)}
        onSelectShop={focusShop}
        shopNames={shopNames}
        ledgerRows={ledgerRows}
        onNamesChange={setShopNames}
      />
    </div>
  );
}
