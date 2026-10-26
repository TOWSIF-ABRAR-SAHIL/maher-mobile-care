import type { Metadata } from "next";
import { isDateKey } from "@/lib/dhaka";
import { ServiceWorkspace } from "./ServiceWorkspace";

export const metadata: Metadata = {
  title: "সার্ভিস — MAHER MOBILE CARE",
  description: "দৈনিক সার্ভিস এন্ট্রি, ওয়ার্কফ্লো ও বাকি তালিকা",
};

export const dynamic = "force-dynamic";

function positiveInt(raw?: string): number | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export default function ServicePage({
  searchParams,
}: {
  searchParams?: {
    date?: string;
    edit?: string;
    receipt?: string;
    status?: string;
    mode?: string;
  };
}) {
  const date =
    searchParams?.date && isDateKey(searchParams.date)
      ? searchParams.date
      : undefined;

  return (
    <ServiceWorkspace
      initialDate={date}
      initialEditId={positiveInt(searchParams?.edit)}
      initialReceiptId={positiveInt(searchParams?.receipt)}
      initialStatus={searchParams?.status}
      initialProductMode={searchParams?.mode === "product"}
      initialServiceMode={searchParams?.mode === "service"}
    />
  );
}
