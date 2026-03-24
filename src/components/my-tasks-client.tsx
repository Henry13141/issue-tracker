"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { addIssueUpdate } from "@/actions/issues";
import type { IssueWithRelations } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { formatDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";

export function MyTasksClient({
  needUpdate,
  updatedToday,
}: {
  needUpdate: IssueWithRelations[];
  updatedToday: IssueWithRelations[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(issueId: string) {
    if (!content.trim()) {
      toast.error("请填写进度");
      return;
    }
    setLoading(true);
    try {
      await addIssueUpdate(issueId, content.trim());
      setContent("");
      setOpenId(null);
      toast.success("已更新进度");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "失败");
    } finally {
      setLoading(false);
    }
  }

  if (needUpdate.length === 0 && updatedToday.length === 0) {
    return (
      <EmptyState
        title="当前没有分配给你的任务"
        description="休息一下吧，或到问题列表查看团队其他事项。"
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
    const expanded = openId === issue.id;
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
            <CardTitle className="text-base font-semibold">
              <Link href={`/issues/${issue.id}`} className="hover:underline">
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
              <span className="ml-2 font-medium text-red-600">今日尚未更新进度</span>
            ) : (
              <span className="ml-2 font-medium text-emerald-700 dark:text-emerald-400">
                今日已更新
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {!expanded ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setOpenId(issue.id);
                setContent("");
              }}
            >
              快速更新进度
            </Button>
          ) : (
            <div className="space-y-2">
              <Textarea
                value={openId === issue.id ? content : ""}
                onChange={(e) => setContent(e.target.value)}
                placeholder="简要说明今日进展…"
                rows={3}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => submit(issue.id)}
                  disabled={loading}
                >
                  {loading ? "提交中…" : "提交"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setOpenId(null);
                    setContent("");
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {needUpdate.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-red-700 dark:text-red-400">
            需要今日更新
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
            今日已更新
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            {updatedToday.map((issue) => (
              <TaskCard key={issue.id} issue={issue} variant="ok" />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
