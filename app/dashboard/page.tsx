import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/DashboardView";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ড্যাশবোর্ড",
  description: "দোকানের overview, সেটিংস ও ডাটা নিরাপত্তা",
};

export default function DashboardPage() {
  return <DashboardView />;
}
