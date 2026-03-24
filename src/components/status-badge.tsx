import { Badge } from "@/components/ui/badge";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import type { IssueStatus } from "@/types";
import { cn } from "@/lib/utils";

const STATUS_VARIANT: Record<
  IssueStatus,
  { className: string }
> = {
  todo: { className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100" },
  in_progress: {
    className: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  },
  blocked: {
    className: "bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100",
  },
  pending_review: {
    className: "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100",
  },
  resolved: {
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100",
  },
  closed: { className: "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100" },
};

export function StatusBadge({
  status,
  className,
}: {
  status: IssueStatus;
  className?: string;
}) {
  const v = STATUS_VARIANT[status];
  return (
    <Badge variant="secondary" className={cn("font-normal", v.className, className)}>
      {ISSUE_STATUS_LABELS[status]}
    </Badge>
  );
}
