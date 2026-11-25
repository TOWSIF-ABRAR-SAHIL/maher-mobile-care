import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * `/` is the shop owner's Home: it lands on the Dashboard. Bookmarked service
 * deep links still work — when any Service-only parameter is present we forward
 * it to `/service` so a saved date/edit/receipt link keeps its destination.
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
  redirect(query ? `/service?${query}` : "/dashboard");
}
