import type { Metadata } from "next";
import "./fonts/noto-sans-bengali.css";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "MAHER MOBILE CARE — দৈনিক সার্ভিস ট্র্যাকার",
  description: "দৈনিক সার্ভিস ট্র্যাকার ও টেকনিশিয়ান ড্যাশবোর্ড",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bn">
      <body>
        {children}
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
