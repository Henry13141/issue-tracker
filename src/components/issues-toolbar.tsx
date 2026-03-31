"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition, useState } from "react";
import type { IssuePriority, IssueStatus, User } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ISSUE_CATEGORIES, ISSUE_MODULES, ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/constants";

const ALL = "__all__";

function buildQuery(base: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(base.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || v === ALL) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

export function IssuesToolbar({
  members,
}: {
  members: User[];
}) {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [showAdvanced, setShowAdvanced] = useState(() =>
    Boolean(
      searchParams.get("reviewer") ||
      searchParams.get("category") ||
      searchParams.get("module") ||
      searchParams.get("source") ||
      searchParams.get("risk") ||
      searchParams.get("sortBy")
    )
  );

  const push = useCallback(
    (patch: Record<string, string | null>) => {
      const q = buildQuery(searchParams, patch);
      startTransition(() => { router.push(q ? `/issues?${q}` : "/issues"); });
    },
    [router, searchParams]
  );

  const status   = searchParams.get("status")   ?? ALL;
  const priority = searchParams.get("priority") ?? ALL;
  const assignee = searchParams.get("assignee") ?? ALL;
  const reviewer = searchParams.get("reviewer") ?? ALL;
  const risk     = searchParams.get("risk")     ?? ALL;
  const category = searchParams.get("category") ?? ALL;
  const moduleFilter = searchParams.get("module") ?? ALL;
  const source   = searchParams.get("source")   ?? ALL;
  const sortBy   = searchParams.get("sortBy")   ?? ALL;
  const sortDir  = searchParams.get("sortDir")  ?? "desc";
  const q        = searchParams.get("q")        ?? "";
  const quickPendingReview = status === "pending_review";

  return (
    <div className="mb-6 space-y-3">
      {/* ── 快捷筛选 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={quickPendingReview ? "default" : "outline"}
          disabled={pending}
          onClick={() => push({ status: quickPendingReview ? null : "pending_review", page: null })}
        >
          待验证
        </Button>
      </div>

      {/* ── 基础筛选行 ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">状态</p>
          <Select value={status} onValueChange={(v) => push({ status: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="全部状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部状态</SelectItem>
              {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{ISSUE_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">优先级</p>
          <Select value={priority} onValueChange={(v) => push({ priority: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
            <SelectTrigger className="w-[130px]"><SelectValue placeholder="全部优先级" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部优先级</SelectItem>
              {(Object.keys(ISSUE_PRIORITY_LABELS) as IssuePriority[]).map((p) => (
                <SelectItem key={p} value={p}>{ISSUE_PRIORITY_LABELS[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">负责人</p>
          <Select value={assignee} onValueChange={(v) => push({ assignee: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="全部成员" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>全部成员</SelectItem>
              {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <form className="flex flex-1 gap-2 min-w-[200px]"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const term = String(fd.get("q") ?? "");
            push({ q: term.trim() ? term.trim() : null });
          }}>
          <Input key={q} name="q" defaultValue={q} placeholder="搜索标题…" className="max-w-sm" />
          <Button type="submit" variant="secondary" disabled={pending}>搜索</Button>
        </form>

        <Button type="button" variant="ghost" onClick={() => { startTransition(() => router.push("/issues")); }} disabled={pending}>
          清除筛选
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "收起高级筛选" : "高级筛选"}
        </Button>
      </div>

      {/* ── 高级筛选行 ── */}
      {showAdvanced && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">验收人</p>
            <Select value={reviewer} onValueChange={(v) => push({ reviewer: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部</SelectItem>
                {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">风险标签</p>
            <Select value={risk} onValueChange={(v) => push({ risk: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部</SelectItem>
                <SelectItem value="overdue">逾期</SelectItem>
                <SelectItem value="blocked">阻塞</SelectItem>
                <SelectItem value="stale">3天未更新</SelectItem>
                <SelectItem value="urgent">紧急</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">来源</p>
            <Select value={source} onValueChange={(v) => push({ source: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部</SelectItem>
                <SelectItem value="manual">手动创建</SelectItem>
                <SelectItem value="import">批量导入</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">分类</p>
            <Select
              value={category}
              onValueChange={(v) => push({ category: (v ?? ALL) === ALL ? null : (v ?? null), page: null })}
              disabled={pending}
            >
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部</SelectItem>
                {ISSUE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">模块</p>
            <Select
              value={moduleFilter}
              onValueChange={(v) => push({ module: (v ?? ALL) === ALL ? null : (v ?? null), page: null })}
              disabled={pending}
            >
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="全部" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>全部</SelectItem>
                {ISSUE_MODULES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">排序</p>
            <div className="flex gap-1">
              <Select value={sortBy} onValueChange={(v) => push({ sortBy: (v ?? ALL) === ALL ? null : (v ?? null) })} disabled={pending}>
                <SelectTrigger className="w-[150px]"><SelectValue placeholder="默认排序" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>默认（更新时间）</SelectItem>
                  <SelectItem value="due_date">截止日期</SelectItem>
                  <SelectItem value="last_activity_at">最后活动</SelectItem>
                  <SelectItem value="priority">优先级</SelectItem>
                  <SelectItem value="created_at">创建时间</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortDir} onValueChange={(v) => push({ sortDir: v ?? "desc" })} disabled={pending}>
                <SelectTrigger className="w-[80px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">降序</SelectItem>
                  <SelectItem value="asc">升序</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
