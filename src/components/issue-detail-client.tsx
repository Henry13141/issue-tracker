"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addIssueUpdate, addUpdateComment, updateIssue } from "@/actions/issues";
import { deleteAttachment } from "@/actions/attachments";
import type {
  IssuePriority,
  IssueAttachmentWithUrl,
  IssueEventWithActor,
  IssueStatus,
  IssueUpdateWithUser,
  IssueWithRelations,
  UpdateCommentWithUser,
  User,
} from "@/types";
import { getAllowedNextStatuses } from "@/lib/issue-state-machine";
import { AttachmentUploadButton, AttachmentList } from "@/components/attachment-upload";
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
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/constants";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon, MessageSquare, Send, Clock, GitBranch } from "lucide-react";
import { toast } from "sonner";

// ─── 事件类型中文标签 ──────────────────────────────────────────────────────
const EVENT_TYPE_LABELS: Record<string, string> = {
  issue_created:                 "创建了问题",
  issue_updated:                 "更新了问题信息",
  assignee_changed:              "变更了负责人",
  reviewer_changed:              "变更了审核人",
  status_changed:                "变更了状态",
  priority_changed:              "变更了优先级",
  due_date_changed:              "变更了截止日期",
  reminder_created:              "系统生成了提醒",
  reminder_sent:                 "系统发送了提醒",
  notification_delivery_success: "通知发送成功",
  notification_delivery_failed:  "通知发送失败",
  issue_reopened:                "重新打开了问题",
  issue_closed:                  "关闭了问题",
};

export function IssueDetailClient({
  issue: initial,
  members,
  currentUser,
  events,
}: {
  issue: IssueWithRelations;
  members: User[];
  currentUser: User;
  events: IssueEventWithActor[];
}) {
  const router = useRouter();

  // ─── 元数据编辑状态 ───────────────────────────────────────────────────
  const [title, setTitle]             = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [status, setStatus]           = useState<IssueStatus>(initial.status);
  const [priority, setPriority]       = useState<IssuePriority>(initial.priority);
  const [assigneeId, setAssigneeId]   = useState<string>(initial.assignee_id ?? "__none__");
  const [reviewerId, setReviewerId]   = useState<string>(initial.reviewer_id ?? "__none__");
  const [category, setCategory]       = useState(initial.category ?? "");
  const [module, setModule]           = useState(initial.module ?? "");
  const [blockedReason, setBlockedReason] = useState(initial.blocked_reason ?? "");
  const [closedReason,  setClosedReason]  = useState(initial.closed_reason  ?? "");
  const [dueDate, setDueDate] = useState<Date | undefined>(
    initial.due_date ? new Date(initial.due_date + "T12:00:00") : undefined
  );
  const [savingMeta, setSavingMeta] = useState(false);

  // ─── 进度更新状态 ─────────────────────────────────────────────────────
  const [updateContent, setUpdateContent] = useState("");
  const [updateStatus, setUpdateStatus]   = useState<IssueStatus | "__keep__">("__keep__");
  const [updateBlockedReason, setUpdateBlockedReason] = useState("");
  const [updateClosedReason,  setUpdateClosedReason]  = useState("");
  const [savingUpdate, setSavingUpdate] = useState(false);

  const updates = (initial.issue_updates ?? []) as IssueUpdateWithUser[];
  const [issueAttachments, setIssueAttachments] = useState<IssueAttachmentWithUrl[]>(
    (initial.attachments ?? []) as IssueAttachmentWithUrl[]
  );
  const [updateAttachments, setUpdateAttachments] = useState<Record<string, IssueAttachmentWithUrl[]>>(
    Object.fromEntries(updates.map((u) => [u.id, (u.attachments ?? []) as IssueAttachmentWithUrl[]]))
  );
  const [pendingAttachments, setPendingAttachments] = useState<IssueAttachmentWithUrl[]>([]);

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

  // 当前状态允许切换到的目标状态
  const allowedNextStatuses = useMemo(() => getAllowedNextStatuses(status), [status]);

  // 进度区「同时变更状态」下拉可选项（基于当前 issue 真实状态）
  const allowedUpdateStatuses = useMemo(
    () => getAllowedNextStatuses(initial.status),
    [initial.status]
  );

  // ─── 保存元数据 ───────────────────────────────────────────────────────
  async function saveMeta() {
    if (!canEdit) return;
    setSavingMeta(true);
    try {
      await updateIssue(initial.id, {
        title:          title.trim(),
        description:    description.trim() || null,
        status,
        priority,
        assignee_id:    assigneeId === "__none__" ? null : assigneeId,
        reviewer_id:    reviewerId === "__none__" ? null : reviewerId,
        due_date:       dueStr,
        category:       category.trim() || null,
        module:         module.trim()   || null,
        blocked_reason: status === "blocked" ? blockedReason.trim() || null : null,
        closed_reason:  status === "closed"  ? closedReason.trim()  || null : null,
      });
      toast.success("已保存");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMeta(false);
    }
  }

  // ─── 提交进度 ─────────────────────────────────────────────────────────
  async function submitUpdate() {
    if (!updateContent.trim()) {
      toast.error("请填写进度说明");
      return;
    }
    if (updateStatus === "blocked" && !updateBlockedReason.trim()) {
      toast.error("切换到「已阻塞」状态时，必须填写阻塞原因");
      return;
    }
    if (updateStatus === "closed" && !updateClosedReason.trim()) {
      toast.error("关闭问题时必须填写关闭原因");
      return;
    }
    setSavingUpdate(true);
    try {
      await addIssueUpdate(
        initial.id,
        updateContent.trim(),
        updateStatus === "__keep__" ? undefined : updateStatus,
        pendingAttachments.map((a) => a.storage_path),
        {
          blockedReason: updateStatus === "blocked" ? updateBlockedReason.trim() || null : null,
          closedReason:  updateStatus === "closed"  ? updateClosedReason.trim()  || null : null,
        }
      );
      setUpdateContent("");
      setUpdateStatus("__keep__");
      setUpdateBlockedReason("");
      setUpdateClosedReason("");
      setPendingAttachments([]);
      toast.success("已记录进度");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSavingUpdate(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string, updateId?: string) {
    try {
      await deleteAttachment(attachmentId);
      if (updateId) {
        setUpdateAttachments((prev) => ({
          ...prev,
          [updateId]: (prev[updateId] ?? []).filter((a) => a.id !== attachmentId),
        }));
      } else {
        setIssueAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── 问题基础信息 ── */}
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
              rows={4}
              disabled={!canEdit}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select
                value={status}
                onValueChange={(v) => {
                  setStatus(v as IssueStatus);
                  // 离开 blocked 时清空阻塞原因
                  if (v !== "blocked") setBlockedReason("");
                  if (v !== "closed")  setClosedReason("");
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* 当前状态始终保留 */}
                  <SelectItem value={initial.status}>
                    {ISSUE_STATUS_LABELS[initial.status]}（当前）
                  </SelectItem>
                  {allowedNextStatuses.map((s) => (
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
                  {(Object.entries(ISSUE_PRIORITY_LABELS) as [IssuePriority, string][]).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 阻塞原因（仅当状态为 blocked 时显示） */}
          {status === "blocked" && (
            <div className="space-y-2">
              <Label className="text-destructive">阻塞原因 *</Label>
              <Textarea
                value={blockedReason}
                onChange={(e) => setBlockedReason(e.target.value)}
                placeholder="请描述阻塞原因（必填）"
                rows={2}
                disabled={!canEdit}
              />
            </div>
          )}

          {/* 关闭原因（仅当状态为 closed 时显示） */}
          {status === "closed" && (
            <div className="space-y-2">
              <Label className="text-destructive">关闭原因 *</Label>
              <Textarea
                value={closedReason}
                onChange={(e) => setClosedReason(e.target.value)}
                placeholder="请描述关闭原因（必填）"
                rows={2}
                disabled={!canEdit}
              />
            </div>
          )}

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
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>审核人</Label>
              <Select
                value={reviewerId}
                onValueChange={(v) => setReviewerId(v ?? "__none__")}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未指定</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="space-y-2">
              <Label>来源</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">
                {initial.source ?? "manual"}
                {initial.reopen_count > 0 && (
                  <span className="ml-auto text-xs text-orange-500">
                    已重开 {initial.reopen_count} 次
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>分类</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="可选，如「前端」「后端」"
                disabled={!canEdit}
              />
            </div>
            <div className="space-y-2">
              <Label>模块</Label>
              <Input
                value={module}
                onChange={(e) => setModule(e.target.value)}
                placeholder="可选，如「登录」「报表」"
                disabled={!canEdit}
              />
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

      {/* ── 附件 ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">附件</CardTitle>
          <AttachmentUploadButton
            issueId={initial.id}
            onUploaded={(a) => setIssueAttachments((prev) => [...prev, a])}
          />
        </CardHeader>
        <CardContent>
          {issueAttachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无附件，点击右上角添加</p>
          ) : (
            <AttachmentList
              attachments={issueAttachments}
              canDelete={currentUser.role === "admin" || currentUser.id === initial.creator_id}
              onDelete={(id) => handleDeleteAttachment(id)}
            />
          )}
        </CardContent>
      </Card>

      {/* ── 进度时间线 ── */}
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
                <div key={u.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                  <div className="flex gap-3">
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
                        {u.is_system_generated && (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            系统
                          </span>
                        )}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{u.content}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(u.created_at)}</p>
                    </div>
                  </div>
                  {(updateAttachments[u.id] ?? []).length > 0 && (
                    <div className="ml-12 mt-1">
                      <AttachmentList
                        attachments={updateAttachments[u.id] ?? []}
                        canDelete={currentUser.role === "admin" || currentUser.id === u.user?.id}
                        onDelete={(id) => handleDeleteAttachment(id, u.id)}
                      />
                    </div>
                  )}
                  <UpdateCommentsSection updateId={u.id} comments={u.comments ?? []} />
                </div>
              ))
            )}
          </div>
          <Separator />
          {/* 追加进度表单 */}
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
                onValueChange={(v) => {
                  setUpdateStatus(v as IssueStatus | "__keep__");
                  if (v !== "blocked") setUpdateBlockedReason("");
                  if (v !== "closed")  setUpdateClosedReason("");
                }}
              >
                <SelectTrigger className="sm:max-w-[220px]">
                  <SelectValue placeholder="不改变状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">不改变状态</SelectItem>
                  {allowedUpdateStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {ISSUE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 阻塞原因（进度区） */}
            {updateStatus === "blocked" && (
              <div className="space-y-1">
                <Label className="text-destructive text-sm">阻塞原因 *</Label>
                <Textarea
                  value={updateBlockedReason}
                  onChange={(e) => setUpdateBlockedReason(e.target.value)}
                  placeholder="请描述阻塞原因（必填）"
                  rows={2}
                />
              </div>
            )}

            {/* 关闭原因（进度区） */}
            {updateStatus === "closed" && (
              <div className="space-y-1">
                <Label className="text-destructive text-sm">关闭原因 *</Label>
                <Textarea
                  value={updateClosedReason}
                  onChange={(e) => setUpdateClosedReason(e.target.value)}
                  placeholder="请描述关闭原因（必填）"
                  rows={2}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={submitUpdate} disabled={savingUpdate}>
                {savingUpdate ? "提交中…" : "提交进度"}
              </Button>
              <AttachmentUploadButton
                issueId={initial.id}
                onUploaded={(a) => setPendingAttachments((prev) => [...prev, a])}
              />
            </div>
            {pendingAttachments.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">待附上的图片/文件（提交后关联到本次进度）：</p>
                <AttachmentList
                  attachments={pendingAttachments}
                  canDelete
                  onDelete={(id) => setPendingAttachments((prev) => prev.filter((a) => a.id !== id))}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── 事件审计时间线 ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">事件审计轨迹</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无事件记录</p>
          ) : (
            <div className="relative space-y-0">
              {events.map((ev, i) => (
                <div key={ev.id} className="flex gap-3 pb-4">
                  <div className="flex flex-col items-center">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    {i < events.length - 1 && (
                      <div className="w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-1 pt-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">
                        {ev.actor?.name ?? "系统"}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                      </span>
                      <EventPayloadSummary eventType={ev.event_type} payload={ev.event_payload} />
                    </div>
                    <p className="text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── 事件 payload 摘要渲染 ────────────────────────────────────────────────
function EventPayloadSummary({
  eventType,
  payload,
}: {
  eventType: string;
  payload: Record<string, unknown>;
}) {
  if (eventType === "status_changed" || eventType === "issue_reopened" || eventType === "issue_closed") {
    const from = payload.from as string | undefined;
    const to   = payload.to   as string | undefined;
    if (from && to) {
      return (
        <span className="text-xs text-muted-foreground">
          {from} → {to}
        </span>
      );
    }
  }
  if (eventType === "priority_changed") {
    return (
      <span className="text-xs text-muted-foreground">
        {payload.from as string} → {payload.to as string}
      </span>
    );
  }
  if (eventType === "due_date_changed") {
    const from = payload.from as string | null;
    const to   = payload.to   as string | null;
    return (
      <span className="text-xs text-muted-foreground">
        {from ?? "—"} → {to ?? "—"}
      </span>
    );
  }
  return null;
}

// ─── 进度评论子组件 ───────────────────────────────────────────────────────
function UpdateCommentsSection({
  updateId,
  comments,
}: {
  updateId: string;
  comments: UpdateCommentWithUser[];
}) {
  const router = useRouter();
  const [showInput, setShowInput] = useState(false);
  const [text, setText]           = useState("");
  const [sending, setSending]     = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setSending(true);
    try {
      await addUpdateComment(updateId, text.trim());
      setText("");
      setShowInput(false);
      toast.success("评论已发送");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "评论失败");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="ml-12 space-y-2">
      {comments.length > 0 && (
        <div className="space-y-1.5">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-md bg-background/60 px-2.5 py-1.5">
              <Avatar className="h-6 w-6 shrink-0">
                <AvatarFallback className="text-[10px]">{c.user?.name?.slice(0, 2) ?? "?"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium">{c.user?.name ?? "成员"}</span>
                <span className="mx-1.5 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</span>
                <p className="text-sm whitespace-pre-wrap">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showInput ? (
        <div className="flex items-center gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="写评论…"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            autoFocus
          />
          <Button size="xs" disabled={sending || !text.trim()} onClick={submit}>
            <Send className="h-3.5 w-3.5" />
          </Button>
          <Button size="xs" variant="ghost" onClick={() => { setShowInput(false); setText(""); }}>
            取消
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowInput(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {comments.length > 0 ? `${comments.length} 条评论` : "评论"}
        </button>
      )}
    </div>
  );
}
