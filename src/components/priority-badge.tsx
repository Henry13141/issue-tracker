import { Badge } from "@/components/ui/badge";
import { ISSUE_PRIORITY_LABELS } from "@/lib/constants";
import type { IssuePriority } from "@/types";
import { cn } from "@/lib/utils";

const PRIORITY_CLASS: Record<IssuePriority, string> = {
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  medium: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100",
  high: "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-100",
  urgent: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100",
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: IssuePriority;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("font-normal", PRIORITY_CLASS[priority], className)}>
      {ISSUE_PRIORITY_LABELS[priority]}
    </Badge>
  );
}
