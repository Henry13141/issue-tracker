"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
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
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/constants";

const ALL = "__all__";

function buildQuery(
  base: URLSearchParams,
  patch: Record<string, string | null>
) {
  const next = new URLSearchParams(base.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "" || v === ALL) next.delete(k);
    else next.set(k, v);
  }
  return next.toString();
}

export function IssuesToolbar({ members }: { members: User[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const push = useCallback(
    (patch: Record<string, string | null>) => {
      const q = buildQuery(searchParams, patch);
      startTransition(() => {
        router.push(q ? `/issues?${q}` : "/issues");
      });
    },
    [router, searchParams]
  );

  const status = searchParams.get("status") ?? ALL;
  const priority = searchParams.get("priority") ?? ALL;
  const assignee = searchParams.get("assignee") ?? ALL;
  const q = searchParams.get("q") ?? "";

  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">状态</p>
        <Select
          value={status}
          onValueChange={(v) => push({ status: v === ALL ? null : v })}
          disabled={pending}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部状态</SelectItem>
            {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ISSUE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">优先级</p>
        <Select
          value={priority}
          onValueChange={(v) => push({ priority: v === ALL ? null : v })}
          disabled={pending}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="全部优先级" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部优先级</SelectItem>
            {(Object.keys(ISSUE_PRIORITY_LABELS) as IssuePriority[]).map((p) => (
              <SelectItem key={p} value={p}>
                {ISSUE_PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">负责人</p>
        <Select
          value={assignee}
          onValueChange={(v) => push({ assignee: v === ALL ? null : v })}
          disabled={pending}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="全部成员" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>全部成员</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <form
        className="flex flex-1 gap-2 min-w-[200px]"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const term = String(fd.get("q") ?? "");
          push({ q: term.trim() ? term.trim() : null });
        }}
      >
        <Input key={q} name="q" defaultValue={q} placeholder="搜索标题…" className="max-w-sm" />
        <Button type="submit" variant="secondary" disabled={pending}>
          搜索
        </Button>
      </form>
      <Button type="button" variant="ghost" onClick={() => router.push("/issues")} disabled={pending}>
        清除筛选
      </Button>
    </div>
  );
}
