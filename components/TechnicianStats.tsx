import { Skeleton } from "@/components/ui/skeleton";
import { formatTaka } from "@/lib/utils";
import type { TechStat } from "@/lib/types";

const NAME_COLORS: Record<string, string> = {
  NURUL: "text-blue-600",
  RONI: "text-green-600",
  ASRAFUL: "text-purple-600",
  NAYEM: "text-orange-600",
};

export function TechnicianStats({
  stats,
  loading,
}: {
  stats: TechStat[];
  loading: boolean;
}) {
  return (
    <section className="rounded-xl border bg-white p-4 shadow-md">
      <h2 className="mb-3 text-base font-semibold tracking-tight text-gray-800">
        👤 টেকনিশিয়ান অনুযায়ী দৈনিক কাজের হিসাব
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)
          : stats.map((t) => (
              <div
                key={t.technician}
                className="rounded-xl border bg-gray-50 p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <p className={`font-bold ${NAME_COLORS[t.technician] ?? "text-gray-700"}`}>
                  {t.technician}
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  কাজ করেছে: <span className="font-semibold">{t.count} টি</span>
                </p>
                <p className="text-sm text-gray-700">
                  মোট বিল:{" "}
                  <span className="font-semibold">{formatTaka(t.bill)}</span>
                </p>
              </div>
            ))}
      </div>
    </section>
  );
}
