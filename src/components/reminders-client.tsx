"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAllRemindersRead, markReminderRead, markMultipleRemindersRead } from "@/actions/reminders";
import type { ReminderType, ReminderWithIssue, User } from "@/types";
import { QuickIssueUpdateDialog } from "@/components/quick-issue-update-dialog";
import { REMINDER_TYPE_LABELS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/dates";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_ALL = "__all__";

function reminderSupportsQuickUpdate(t: ReminderType) {
  return t === "no_update_today" || t === "stale_3_days" || t === "overdue";
}

function ReminderRow({
  r,
  selected,
  onToggle,
  onRead,
  onAfterQuickUpdate,
}: {
  r: ReminderWithIssue;
  selected: boolean;
  onToggle: () => void;
  onRead: (id: string) => void;
  onAfterQuickUpdate?: (id: string) => void;
}) {
  return (
    <Card className={cn(!r.is_read ? "border-primary/40 bg-primary/5" : "")}>
      <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 min-w-0">
          {!r.is_read && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggle}
              className="mt-1 h-4 w-4 cursor-pointer rounded border-gray-300"
            />
          )}
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{REMINDER_TYPE_LABELS[r.type] ?? r.type}</Badge>
              {!r.is_read && <Badge>未读</Badge>}
            </div>
            <p className="font-medium">
              {r.issue ? (
                <Link href={`/issues/${r.issue.id}`} className="hover:underline">
                  {r.issue.title}
                </Link>
              ) : (
                "关联问题"
              )}
            </p>
            {r.message && <p className="text-sm text-muted-foreground">{r.message}</p>}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{formatDateTime(r.created_at)}</span>
              {r.issue && (
                <Link href={`/issues/${r.issue.id}`} className="text-blue-600 hover:underline">
                  查看工单详情 →
                </Link>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {r.issue && reminderSupportsQuickUpdate(r.type) ? (
            <QuickIssueUpdateDialog
              issueId={r.issue.id}
              source="reminders"
              trigger={<Button size="sm">写进展</Button>}
              afterSubmit={async () => {
                await markReminderRead(r.id);
                onAfterQuickUpdate?.(r.id);
              }}
            />
          ) : null}
          {!r.is_read && (
            <Button size="sm" variant="outline" onClick={() => onRead(r.id)} className="shrink-0">
              标为已读
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function RemindersClient({
  mine,
  adminAll,
  user,
}: {
  mine: ReminderWithIssue[];
  adminAll: ReminderWithIssue[];
  user: User;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>(TYPE_ALL);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  // 按 tab + type 过滤
  const filtered = useMemo(() => {
    let items = mine;
    if (tab === "unread") items = items.filter((r) => !r.is_read);
    if (tab === "read")   items = items.filter((r) => r.is_read);
    if (typeFilter !== TYPE_ALL) items = items.filter((r) => r.type === typeFilter);
    return items;
  }, [mine, tab, typeFilter]);

  // 未读条目（用于批量选择）
  const unreadFiltered = filtered.filter((r) => !r.is_read);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const unreadIds = unreadFiltered.map((r) => r.id);
    if (unreadIds.every((id) => selectedIds.has(id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(unreadIds));
    }
  }

  function onRead(id: string) {
    startTransition(async () => {
      try {
        await markReminderRead(id);
        toast.success("收到，这条提醒已处理");
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "操作没成功，可以再试一次");
      }
    });
  }

  function onReadAll() {
    startTransition(async () => {
      try {
        await markAllRemindersRead();
        toast.success("全部清理完毕，待办清单更聚焦了");
        setSelectedIds(new Set());
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "操作没成功，可以再试一次");
      }
    });
  }

  function onReadSelected() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    startTransition(async () => {
      try {
        await markMultipleRemindersRead(ids);
        toast.success(`${ids.length} 条提醒已处理，今天的关注项更清晰了`);
        setSelectedIds(new Set());
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "操作没成功，可以再试一次");
      }
    });
  }

  const allUnreadSelected = unreadFiltered.length > 0 && unreadFiltered.every((r) => selectedIds.has(r.id));

  return (
    <div className="space-y-6">
      {/* ── 工具栏 ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedIds(new Set()); }} className="w-auto">
            <TabsList>
              <TabsTrigger value="all">全部</TabsTrigger>
              <TabsTrigger value="unread">未读</TabsTrigger>
              <TabsTrigger value="read">已读</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">类型</span>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v ?? TYPE_ALL); setSelectedIds(new Set()); }}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TYPE_ALL}>全部类型</SelectItem>
                {Object.entries(REMINDER_TYPE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {selectedIds.size > 0 && (
            <Button size="sm" onClick={onReadSelected} disabled={pending}>
              已选 {selectedIds.size} 条标为已读
            </Button>
          )}
          {unreadFiltered.length > 0 && (
            <Button size="sm" variant="ghost" onClick={toggleSelectAll} disabled={pending}>
              {allUnreadSelected ? "取消全选" : "全选未读"}
            </Button>
          )}
          <Button variant="secondary" onClick={onReadAll} disabled={pending}>
            全部标为已读
          </Button>
        </div>
      </div>

      {/* ── 未读摘要 ── */}
      {mine.filter(r => !r.is_read).length > 0 && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{mine.filter(r => !r.is_read).length} 条等你回应</span>
          {typeFilter !== TYPE_ALL && <span>· 当前类型筛选: {REMINDER_TYPE_LABELS[typeFilter] ?? typeFilter}</span>}
        </div>
      )}

      {/* ── 提醒列表 ── */}
      {filtered.length === 0 ? (
        <EmptyState title="全都处理好了" description="当前没有需要回应的提醒，保持这个节奏。" />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReminderRow
              key={r.id}
              r={r}
              selected={selectedIds.has(r.id)}
              onToggle={() => toggleSelect(r.id)}
              onRead={onRead}
              onAfterQuickUpdate={(id) => {
                setSelectedIds((prev) => {
                  const n = new Set(prev);
                  n.delete(id);
                  return n;
                });
              }}
            />
          ))}
        </div>
      )}

      {/* ── 管理员汇总 ── */}
      {user.role === "admin" && adminAll.length > 0 && (
        <div className="pt-8">
          <h2 className="mb-3 text-lg font-semibold">全员提醒汇总（最近 200 条）</h2>
          <div className="space-y-3">
            {adminAll.map((r) => (
              <ReminderRow key={`admin-${r.id}`} r={r} selected={false} onToggle={() => {}} onRead={onRead} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
