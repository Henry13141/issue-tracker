"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toggleSubtaskCompletion } from "@/actions/issues";
import { CreateSubtaskDialog } from "@/components/create-subtask-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { IssueSummary, IssueWithRelations, User } from "@/types";
import { toast } from "sonner";

export function IssueSubtasksClient({
  parentIssue,
  currentUser,
}: {
  parentIssue: IssueWithRelations;
  currentUser: User;
}) {
  const router = useRouter();
  const [subtasks, setSubtasks] = useState<IssueSummary[]>(parentIssue.children ?? []);
  const [togglingSubtaskId, setTogglingSubtaskId] = useState<string | null>(null);

  const doneCount = subtasks.filter(
    (c) => c.status === "resolved" || c.status === "closed"
  ).length;
  const canToggle = currentUser.role === "admin" || currentUser.id === parentIssue.assignee_id;

  async function handleToggleSubtask(child: IssueSummary) {
    const completed = child.status !== "resolved" && child.status !== "closed";
    setTogglingSubtaskId(child.id);
    try {
      await toggleSubtaskCompletion(child.id, completed);
      setSubtasks((prev) =>
        prev.map((item) =>
          item.id === child.id
            ? {
                ...item,
                status: completed ? "resolved" : "todo",
              }
            : item
        )
      );
      toast.success(completed ? "子任务搞定了，离整体完成又近了一步" : "已取消完成，可以继续处理");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作暂时没成功，可以再试一次");
    } finally {
      setTogglingSubtaskId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">子任务</CardTitle>
            {subtasks.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {doneCount}/{subtasks.length} 已完成
              </span>
            )}
          </div>
          <CreateSubtaskDialog
            parentIssue={parentIssue}
            onCreated={(child) => setSubtasks((prev) => [...prev, child])}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {subtasks.length > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.round((doneCount / subtasks.length) * 100)}%` }}
            />
          </div>
        )}

        {subtasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无子任务</p>
        ) : (
          <div className="rounded-xl border bg-muted/15">
            {subtasks.map((child) => {
              const isDone = child.status === "resolved" || child.status === "closed";
              const isLoading = togglingSubtaskId === child.id;

              return (
                <div
                  key={child.id}
                  className="flex items-start gap-3 border-b px-4 py-3 last:border-b-0"
                >
                  <button
                    type="button"
                    disabled={!canToggle || isLoading}
                    onClick={() => void handleToggleSubtask(child)}
                    className={cn(
                      "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm transition-all",
                      isDone
                        ? "border-emerald-500 bg-emerald-50 text-emerald-600 shadow-sm"
                        : "border-muted-foreground/30 bg-background text-transparent hover:border-emerald-400 hover:bg-emerald-50",
                      !canToggle && "cursor-not-allowed opacity-60"
                    )}
                    aria-label={isDone ? "取消完成" : "标记完成"}
                    title={canToggle ? (isDone ? "取消完成" : "标记完成") : "仅父任务负责人或管理员可操作"}
                  >
                    {isLoading ? "…" : isDone ? "✅" : "✓"}
                  </button>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/issues/${child.id}`}
                      className={cn(
                        "block truncate font-medium text-primary hover:underline",
                        isDone && "text-muted-foreground line-through"
                      )}
                    >
                      {child.title}
                    </Link>
                    {child.description && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {child.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
