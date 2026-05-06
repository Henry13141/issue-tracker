"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IssueGroup } from "@/actions/issues";
import type { User } from "@/types";
import { IssuesTable } from "@/components/issues-table";
import { cn } from "@/lib/utils";

function GroupSection({
  group,
  currentUser,
  defaultOpen,
}: {
  group: IssueGroup;
  currentUser: User;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const activeCount = group.issues.filter(
    (i) => i.status !== "resolved" && i.status !== "closed"
  ).length;

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 rounded-t-lg"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-sm">{group.module}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary font-medium">
              {activeCount} 进行中
            </span>
          )}
          <span>{group.issues.length} 条</span>
        </span>
      </button>

      {open && (
        <div className={cn("border-t")}>
          <IssuesTable issues={group.issues} currentUser={currentUser} compact />
        </div>
      )}
    </div>
  );
}

export function IssuesGroupedView({
  groups,
  currentUser,
}: {
  groups: IssueGroup[];
  currentUser: User;
}) {
  if (groups.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        当前筛选条件下没有找到任何工单。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group, i) => (
        <GroupSection
          key={group.module}
          group={group}
          currentUser={currentUser}
          defaultOpen={i === 0 || group.issues.some(
            (issue) => issue.status !== "resolved" && issue.status !== "closed"
          )}
        />
      ))}
    </div>
  );
}
