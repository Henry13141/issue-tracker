"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addIssueUpdate, addUpdateComment, updateIssue } from "@/actions/issues";
import { deleteAttachment } from "@/actions/attachments";
import type { IssuePriority, IssueAttachmentWithUrl, IssueStatus, IssueUpdateWithUser, IssueWithRelations, UpdateCommentWithUser, User } from "@/types";
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
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon, MessageSquare, Send } from "lucide-react";
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
  const [issueAttachments, setIssueAttachments] = useState<IssueAttachmentWithUrl[]>(
    (initial.attachments ?? []) as IssueAttachmentWithUrl[]
  );
  const [updateAttachments, setUpdateAttachments] = useState<
    Record<string, IssueAttachmentWithUrl[]>
  >(
    Object.fromEntries(
      updates.map((u) => [u.id, (u.attachments ?? []) as IssueAttachmentWithUrl[]])
    )
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
        updateStatus === "__keep__" ? undefined : updateStatus,
        pendingAttachments.map((a) => a.storage_path)
      );
      setUpdateContent("");
      setUpdateStatus("__keep__");
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
                  onDelete={(id) =>
                    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
                  }
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UpdateCommentsSection({
  updateId,
  comments,
}: {
  updateId: string;
  comments: UpdateCommentWithUser[];
}) {
  const router = useRouter();
  const [showInput, setShowInput] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

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
