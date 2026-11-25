import type { Metadata } from "next";
import "./fonts/noto-sans-bengali.css";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AutoBackup } from "@/components/AutoBackup";
import { AppChrome } from "@/components/AppChrome";
import { ShopSettingsProvider } from "@/components/ShopSettingsProvider";
import { LicenseProvider } from "@/components/licensing/LicenseProvider";

export const metadata: Metadata = {
  title: "MSS (Mobile Service System)",
  description: "অফলাইন মোবাইল সার্ভিস ও পার্টস ম্যানেজমেন্ট",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bn">
      <body>
        <AutoBackup />
        {/* The masthead lives here, outside the routed page tree, so it does
            not unmount/remount (and flicker) on /service ↔ /products moves.
            ShopSettingsProvider feeds live white-label branding to the chrome,
            footer and receipt without touching ledger data. */}
        <LicenseProvider>
          <ShopSettingsProvider>
            <AppChrome>{children}</AppChrome>
          </ShopSettingsProvider>
        </LicenseProvider>
        <div className="print:hidden">
          <Toaster richColors position="bottom-right" closeButton />
        </div>
      </body>
    </html>
  );
}
