"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addIssueUpdate, updateIssue } from "@/actions/issues";
import type { IssuePriority, IssueStatus, IssueUpdateWithUser, IssueWithRelations, User } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/lib/button-variants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { formatDateTime, formatDateOnly } from "@/lib/dates";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { toast } from "sonner";

export function IssueDetailClient({
  issue: initial,
  members,
  currentUser,
}: {
  issue: IssueWithRelations;
  members: User[];
  currentUser: User;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [status, setStatus] = useState<IssueStatus>(initial.status);
  const [priority, setPriority] = useState<IssuePriority>(initial.priority);
  const [assigneeId, setAssigneeId] = useState<string>(initial.assignee_id ?? "__none__");
  const [dueDate, setDueDate] = useState<Date | undefined>(
    initial.due_date ? new Date(initial.due_date + "T12:00:00") : undefined
  );
  const [savingMeta, setSavingMeta] = useState(false);

  const [updateContent, setUpdateContent] = useState("");
  const [updateStatus, setUpdateStatus] = useState<IssueStatus | "__keep__">("__keep__");
  const [savingUpdate, setSavingUpdate] = useState(false);

  const updates = (initial.issue_updates ?? []) as IssueUpdateWithUser[];

  const canEdit =
    currentUser.role === "admin" ||
    currentUser.id === initial.assignee_id ||
    currentUser.id === initial.creator_id;

  const dueStr = useMemo(() => {
    if (!dueDate) return null;
    const y = dueDate.getFullYear();
    const m = String(dueDate.getMonth() + 1).padStart(2, "0");
    const d = String(dueDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [dueDate]);

  async function saveMeta() {
    if (!canEdit) return;
    setSavingMeta(true);
    try {
      await updateIssue(initial.id, {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority,
        assignee_id: assigneeId === "__none__" ? null : assigneeId,
        due_date: dueStr,
      });
      toast.success("已保存");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMeta(false);
    }
  }

  async function submitUpdate() {
    if (!updateContent.trim()) {
      toast.error("请填写进度说明");
      return;
    }
    setSavingUpdate(true);
    try {
      await addIssueUpdate(
        initial.id,
        updateContent.trim(),
        updateStatus === "__keep__" ? undefined : updateStatus
      );
      setUpdateContent("");
      setUpdateStatus("__keep__");
      toast.success("已记录进度");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSavingUpdate(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>问题信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>标题</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
          </div>
          <div className="space-y-2">
            <Label>描述</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as IssueStatus)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {ISSUE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>优先级</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as IssuePriority)}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">低</SelectItem>
                  <SelectItem value="medium">中</SelectItem>
                  <SelectItem value="high">高</SelectItem>
                  <SelectItem value="urgent">紧急</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>负责人</Label>
              <Select
                value={assigneeId}
                onValueChange={(v) => setAssigneeId(v ?? "__none__")}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分配</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>截止日期</Label>
              <Popover>
                <PopoverTrigger
                  disabled={!canEdit}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "w-full justify-start text-left font-normal",
                    !dueDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dueDate ? formatDateOnly(dueStr) : "选择日期"}
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              创建者：{initial.creator?.name ?? "—"} · 创建于 {formatDateTime(initial.created_at)}
            </p>
            <p>最近更新：{formatDateTime(initial.updated_at)}</p>
          </div>
          {canEdit ? (
            <Button onClick={saveMeta} disabled={savingMeta}>
              {savingMeta ? "保存中…" : "保存修改"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>进度时间线</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <div className="max-h-[420px] space-y-4 overflow-y-auto pr-1">
            {updates.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无进度记录</p>
            ) : (
              updates.map((u) => (
                <div key={u.id} className="flex gap-3 rounded-lg border bg-muted/20 p-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback>{u.user?.name?.slice(0, 2) ?? "?"}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{u.user?.name ?? "成员"}</span>
                      {u.status_from && u.status_to && u.status_from !== u.status_to ? (
                        <span className="text-xs text-muted-foreground">
                          <StatusBadge status={u.status_from} /> →{" "}
                          <StatusBadge status={u.status_to} />
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{u.content}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(u.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <Separator />
          <div className="space-y-3">
            <Label>追加进度</Label>
            <Textarea
              value={updateContent}
              onChange={(e) => setUpdateContent(e.target.value)}
              placeholder="今天处理了什么、阻塞点等"
              rows={3}
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <span className="text-sm text-muted-foreground shrink-0">同时变更状态（可选）</span>
              <Select
                value={updateStatus}
                onValueChange={(v) => setUpdateStatus(v as IssueStatus | "__keep__")}
              >
                <SelectTrigger className="sm:max-w-[220px]">
                  <SelectValue placeholder="不改变状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">不改变状态</SelectItem>
                  {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {ISSUE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submitUpdate} disabled={savingUpdate}>
              {savingUpdate ? "提交中…" : "提交进度"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
