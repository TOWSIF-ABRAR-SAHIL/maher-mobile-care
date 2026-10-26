import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The service desk is the shop's landing page. The old Home dashboard is gone,
 * but `/` stays a valid entry point: forward the deep-link parameters the
 * Service page understands instead of dropping a bookmarked date or edit row.
 */
const FORWARDED_PARAMS = ["date", "edit", "receipt", "status", "mode"] as const;

export default function RootPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const params = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const raw = searchParams?.[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value) params.set(key, value);
  }

  const query = params.toString();
  redirect(query ? `/service?${query}` : "/service");
}
