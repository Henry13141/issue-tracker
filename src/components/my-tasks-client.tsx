"use client";

import type { IssueWithRelations } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { formatDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { QuickIssueUpdateDialog } from "@/components/quick-issue-update-dialog";

export function MyTasksClient({
  needUpdate,
  updatedToday,
  following = [],
}: {
  needUpdate: IssueWithRelations[];
  updatedToday: IssueWithRelations[];
  following?: IssueWithRelations[];
}) {
  if (needUpdate.length === 0 && updatedToday.length === 0 && following.length === 0) {
    return (
      <EmptyState
        title="当前没有待推进的任务"
        description="难得的清爽时刻，可以去问题列表看看有没有需要帮忙的事项。"
      />
    );
  }

  function TaskCard({
    issue,
    variant,
  }: {
    issue: IssueWithRelations;
    variant: "stale" | "ok";
  }) {
    return (
      <Card
        className={cn(
          variant === "stale"
            ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
            : "border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
        )}
      >
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="min-w-0 max-w-full flex-1 text-base font-semibold">
              <Link href={`/issues/${issue.id}`} className="break-words hover:underline">
                {issue.title}
              </Link>
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={issue.status} />
              <PriorityBadge priority={issue.priority} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            截止：{formatDateOnly(issue.due_date)}
            {variant === "stale" ? (
              <span className="ml-2 font-medium text-amber-600 dark:text-amber-400">等你更新今日进展</span>
            ) : (
              <span className="ml-2 font-medium text-emerald-700 dark:text-emerald-400">
                今日已推进
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <QuickIssueUpdateDialog issueId={issue.id} source="my_tasks" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* 今日推进成果摘要 */}
      {updatedToday.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="text-sm text-emerald-800 dark:text-emerald-300">
            今天你已推进了 <span className="font-semibold">{updatedToday.length}</span> 项任务
            {needUpdate.length === 0
              ? "，全部事项都已更新，节奏很棒"
              : `，还有 ${needUpdate.length} 项等你同步进展`}
          </p>
        </div>
      )}

      {needUpdate.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-amber-700 dark:text-amber-400">
            等你同步进展（{needUpdate.length}）
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {needUpdate.map((issue) => (
              <TaskCard key={issue.id} issue={issue} variant="stale" />
            ))}
          </div>
        </section>
      ) : null}
      {updatedToday.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-emerald-800 dark:text-emerald-400">
            今日已推进（{updatedToday.length}）
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {updatedToday.map((issue) => (
              <TaskCard key={issue.id} issue={issue} variant="ok" />
            ))}
          </div>
        </section>
      ) : null}

      {following.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-blue-700 dark:text-blue-400">
            我跟进的（{following.length}）
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            你曾经交接出去、仍需关注结果的事项
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {following.map((issue) => (
              <Card
                key={issue.id}
                className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20"
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="min-w-0 max-w-full flex-1 text-base font-semibold">
                      <Link href={`/issues/${issue.id}`} className="break-words hover:underline">
                        {issue.title}
                      </Link>
                    </CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={issue.status} />
                      <PriorityBadge priority={issue.priority} />
                    </div>
                  </div>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span>当前负责人：</span>
                    {issue.assignee ? (
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <UserAvatar user={issue.assignee} className="h-5 w-5 shrink-0" fallbackClassName="text-[9px]" />
                        {issue.assignee.name}
                      </span>
                    ) : (
                      <span>未分配</span>
                    )}
                    {issue.due_date && <span>· 截止：{formatDateOnly(issue.due_date)}</span>}
                  </p>
                </CardHeader>
                <CardContent>
                  <Link
                    href={`/issues/${issue.id}`}
                    className="text-sm text-primary hover:underline"
                  >
                    查看详情 →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
