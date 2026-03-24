"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markAllRemindersRead, markReminderRead } from "@/actions/reminders";
import type { ReminderWithIssue, User } from "@/types";
import { REMINDER_TYPE_LABELS } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/dates";
import { EmptyState } from "@/components/empty-state";
import { toast } from "sonner";

function ReminderRow({
  r,
  onRead,
}: {
  r: ReminderWithIssue;
  onRead: (id: string) => void;
}) {
  return (
    <Card className={!r.is_read ? "border-primary/40 bg-primary/5" : ""}>
      <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{REMINDER_TYPE_LABELS[r.type] ?? r.type}</Badge>
            {!r.is_read ? <Badge>未读</Badge> : null}
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
          {r.message ? <p className="text-sm text-muted-foreground">{r.message}</p> : null}
          <p className="text-xs text-muted-foreground">{formatDateTime(r.created_at)}</p>
        </div>
        {!r.is_read ? (
          <Button size="sm" variant="outline" onClick={() => onRead(r.id)}>
            标为已读
          </Button>
        ) : null}
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
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (tab === "unread") return mine.filter((r) => !r.is_read);
    if (tab === "read") return mine.filter((r) => r.is_read);
    return mine;
  }, [mine, tab]);

  function onRead(id: string) {
    startTransition(async () => {
      try {
        await markReminderRead(id);
        toast.success("已标记已读");
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "失败");
      }
    });
  }

  function onReadAll() {
    startTransition(async () => {
      try {
        await markAllRemindersRead();
        toast.success("已全部标为已读");
        router.refresh();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "失败");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={setTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="unread">未读</TabsTrigger>
            <TabsTrigger value="read">已读</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button variant="secondary" onClick={onReadAll} disabled={pending}>
          全部标为已读
        </Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="没有提醒" description="没有新的提醒，一切正常。" />
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <ReminderRow key={r.id} r={r} onRead={onRead} />
          ))}
        </div>
      )}

      {user.role === "admin" ? (
        <div className="pt-8">
          <h2 className="mb-3 text-lg font-semibold">全员提醒汇总（最近 200 条）</h2>
          {adminAll.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无记录</p>
          ) : (
            <div className="space-y-3">
              {adminAll.map((r) => (
                <ReminderRow key={`admin-${r.id}`} r={r} onRead={onRead} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
