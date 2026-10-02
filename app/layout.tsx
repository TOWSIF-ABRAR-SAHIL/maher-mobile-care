import type { Metadata } from "next";
import { Noto_Sans_Bengali } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const bengali = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700"],
});

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
      <body className={bengali.className}>
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
