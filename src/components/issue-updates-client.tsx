"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { addIssueUpdate, addUpdateComment, summarizeIssueDiscussion } from "@/actions/issues";
import { deleteAttachment } from "@/actions/attachments";
import type {
  IssueAttachmentWithUrl,
  IssueStatus,
  IssueUpdateWithUser,
  IssueWithRelations,
  UpdateCommentWithUser,
  User,
} from "@/types";
import { canActorTransition, getAllowedNextStatuses } from "@/lib/issue-state-machine";
import { AttachmentUploadButton, AttachmentList } from "@/components/attachment-upload";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
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
import { UserAvatar } from "@/components/user-avatar";
import { formatDateTime } from "@/lib/dates";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import { ChevronDown, ChevronUp, MessageSquare, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { QuickIssueUpdateDialog } from "@/components/quick-issue-update-dialog";

export function IssueUpdatesClient({
  issue,
  updates: initialUpdates,
  currentUser,
}: {
  issue: Pick<IssueWithRelations, "id" | "status" | "assignee_id" | "reviewer_id" | "creator_id" | "children">;
  updates: IssueUpdateWithUser[];
  currentUser: User;
}) {
  const router = useRouter();

  const [updateContent, setUpdateContent] = useState("");
  const [updateStatus, setUpdateStatus] = useState<IssueStatus | "__keep__">("__keep__");
  const [updateBlockedReason, setUpdateBlockedReason] = useState("");
  const [updateClosedReason, setUpdateClosedReason] = useState("");
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<IssueAttachmentWithUrl[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [updateAttachments, setUpdateAttachments] = useState<Record<string, IssueAttachmentWithUrl[]>>(
    Object.fromEntries(initialUpdates.map((u) => [u.id, (u.attachments ?? []) as IssueAttachmentWithUrl[]]))
  );

  const isAdmin    = currentUser.role === "admin";
  const isAssignee = currentUser.id === issue.assignee_id;
  const isReviewer = currentUser.id === issue.reviewer_id;
  const hasIncompleteSubtasks = useMemo(
    () => (issue.children ?? []).some((child) => child.status !== "resolved" && child.status !== "closed"),
    [issue.children]
  );
  const allowedUpdateStatuses = useMemo(
    () =>
      getAllowedNextStatuses(issue.status)
        .filter((next) => !(next === "pending_review" && hasIncompleteSubtasks))
        .filter((next) =>
          canActorTransition({
            from: issue.status,
            to: next,
            isAdmin,
            isAssignee,
            isReviewer,
          })
        ),
    [issue.status, hasIncompleteSubtasks, isAdmin, isAssignee, isReviewer]
  );

  async function submitUpdate() {
    if (!updateContent.trim()) {
      toast.error("写几句进展说明，帮团队了解最新情况");
      return;
    }
    if (updateStatus === "blocked" && !updateBlockedReason.trim()) {
      toast.error("写下阻塞原因，团队才能更快帮你解决");
      return;
    }
    if (updateStatus === "closed" && !updateClosedReason.trim()) {
      toast.error("关闭前补充一下原因，方便后续复盘参考");
      return;
    }
    if (updateStatus === "pending_review" && hasIncompleteSubtasks) {
      toast.error("还有子任务未完成，全部搞定后就可以提交验证了");
      return;
    }
    setSavingUpdate(true);
    try {
      await addIssueUpdate(
        issue.id,
        updateContent.trim(),
        updateStatus === "__keep__" ? undefined : updateStatus,
        pendingAttachments.map((a) => a.storage_path),
        {
          blockedReason: updateStatus === "blocked" ? updateBlockedReason.trim() || null : null,
          closedReason: updateStatus === "closed" ? updateClosedReason.trim() || null : null,
        }
      );
      setUpdateContent("");
      setUpdateStatus("__keep__");
      setUpdateBlockedReason("");
      setUpdateClosedReason("");
      setPendingAttachments([]);
      toast.success("进展已记录，相关同事现在能看到最新状态了");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "提交暂时没成功，你的内容还在，可以再试一次");
    } finally {
      setSavingUpdate(false);
    }
  }

  async function handleDeleteUpdateAttachment(attachmentId: string, updateId: string) {
    try {
      await deleteAttachment(attachmentId);
      setUpdateAttachments((prev) => ({
        ...prev,
        [updateId]: (prev[updateId] ?? []).filter((a) => a.id !== attachmentId),
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除暂时没成功，可以稍后再试");
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>进度时间线</CardTitle>
          <div className="flex flex-wrap gap-2">
            {initialUpdates.filter((u) => !u.is_system_generated).length >= 3 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1"
                disabled={generatingSummary}
                onClick={async () => {
                  setGeneratingSummary(true);
                  try {
                    const result = await summarizeIssueDiscussion(issue.id);
                    if ("error" in result) {
                      toast.error(result.error);
                    } else {
                      setAiSummary(result.summary);
                      setSummaryExpanded(true);
                    }
                  } finally {
                    setGeneratingSummary(false);
                  }
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {generatingSummary ? "总结中…" : "AI 总结"}
              </Button>
            )}
            <QuickIssueUpdateDialog
              issueId={issue.id}
              source="issue_detail"
              trigger={
                <Button type="button" variant="outline" size="sm" className="w-full shrink-0 sm:w-auto">
                  弹窗快速写一句
                </Button>
              }
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {aiSummary && (
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                AI 总结
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setSummaryExpanded((v) => !v)}
              >
                {summaryExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {summaryExpanded && (
              <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {aiSummary}
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          {initialUpdates.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有进度记录，添加第一条进展来启动推进轨迹</p>
          ) : (
            initialUpdates.map((u) => (
              <div key={u.id} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex gap-3">
                  <UserAvatar user={u.user} className="h-9 w-9 shrink-0" />
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
                  <div className="space-y-2 sm:ml-12">
                    <AttachmentList
                      attachments={updateAttachments[u.id] ?? []}
                      canDelete={currentUser.role === "admin" || currentUser.id === u.user?.id}
                      onDelete={(id) => handleDeleteUpdateAttachment(id, u.id)}
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
          <div>
            <Label>追加进度</Label>
            <p className="text-xs text-muted-foreground mt-0.5">每一条进展都在让协作信息更完整，团队能看到你的推进</p>
          </div>
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
                if (v !== "closed") setUpdateClosedReason("");
              }}
              disabled={allowedUpdateStatuses.length === 0}
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
            {allowedUpdateStatuses.length === 0 && (
              <span className="text-xs text-muted-foreground">
                {issue.status === "pending_review"
                  ? "当前处于待验证，仅审核人或管理员可变更状态"
                  : issue.status === "pending_rework"
                    ? "当前为待返修，仅负责人或管理员可通过此处变更状态"
                    : "仅负责人或管理员可变更状态"}
              </span>
            )}
            {allowedUpdateStatuses.length > 0 && hasIncompleteSubtasks && (
              <span className="text-xs text-muted-foreground">
                子任务未全部完成，暂不可提交待验证
              </span>
            )}
          </div>

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
              issueId={issue.id}
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
  );
}

// ─── 进度评论子组件 ────────────────────────────────────────────────────────────
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
      toast.success("评论已发送，同事能看到你的反馈了");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "评论发送没成功，可以再试一次");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-border/60 pt-3">
      {comments.length > 0 && (
        <div className="space-y-1.5">
          {comments.map((c) => (
            <div key={c.id} className="flex items-start gap-2 rounded-md bg-background/60 px-3 py-2">
              <UserAvatar user={c.user} className="h-6 w-6 shrink-0" fallbackClassName="text-[10px]" />
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
