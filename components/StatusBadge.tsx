import { Badge } from "@/components/ui/badge";
import { STATUS_BN, cn } from "@/lib/utils";

const CLASSES: Record<string, string> = {
  Pending:
    "border-transparent bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  "In-Progress":
    "border-transparent bg-blue-100 text-blue-800 hover:bg-blue-100",
  Completed:
    "border-transparent bg-green-100 text-green-800 hover:bg-green-100",
  Delivered:
    "border-transparent bg-gray-200 text-gray-700 hover:bg-gray-200",
  Returned:
    "border-transparent bg-amber-100 text-amber-800 hover:bg-amber-100",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn(CLASSES[status] ?? CLASSES.Pending)}>
      {(STATUS_BN as Record<string, string>)[status] ?? status}
    </Badge>
  );
}
