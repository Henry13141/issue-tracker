"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { updateIssue, handoverIssue } from "@/actions/issues";
import { deleteAttachment } from "@/actions/attachments";
import type {
  IssuePriority,
  IssueAttachmentWithUrl,
  IssueStatus,
  IssueWithRelations,
  User,
} from "@/types";
import { getAllowedNextStatuses } from "@/lib/issue-state-machine";
import { AttachmentUploadButton, AttachmentList } from "@/components/attachment-upload";
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
import { formatDateTime, formatDateOnly } from "@/lib/dates";
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/constants";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon, ArrowRightLeft } from "lucide-react";
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
  const [issueAttachments, setIssueAttachments] = useState<IssueAttachmentWithUrl[]>(
    (initial.attachments ?? []) as IssueAttachmentWithUrl[]
  );

  const canEdit =
    currentUser.role === "admin" ||
    currentUser.id === initial.assignee_id ||
    currentUser.id === initial.creator_id;

  // 交接：当前负责人或管理员可发起
  const canHandover =
    currentUser.role === "admin" ||
    currentUser.id === initial.assignee_id;

  // ─── 交接状态 ─────────────────────────────────────────────────────────────
  const [showHandover,        setShowHandover]        = useState(false);
  const [handoverTo,          setHandoverTo]          = useState("__none__");
  const [handoverNote,        setHandoverNote]        = useState("");
  const [savingHandover,      setSavingHandover]      = useState(false);
  const [handoverAttachments, setHandoverAttachments] = useState<IssueAttachmentWithUrl[]>([]);

  const dueStr = useMemo(() => {
    if (!dueDate) return null;
    const y = dueDate.getFullYear();
    const m = String(dueDate.getMonth() + 1).padStart(2, "0");
    const d = String(dueDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [dueDate]);

  // 允许切换的目标状态必须基于数据库里的当前状态（initial.status），
  // 而非用户正在选择的中间值——否则用户选了"已关闭"之后，
  // allowedNextStatuses 会立即换成从 closed 出发的转移，导致 "已关闭" 选项
  // 从列表里消失、Select 触发器显示空白，用户误以为选择失效而重新选别的状态。
  const allowedNextStatuses = useMemo(() => getAllowedNextStatuses(initial.status), [initial.status]);

  // ─── 保存元数据 ───────────────────────────────────────────────────────
  async function saveMeta() {
    if (!canEdit) return;
    setSavingMeta(true);
    try {
      const result = await updateIssue(initial.id, {
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
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("已保存");
        router.refresh();
      }
    } catch {
      toast.error("保存失败，请稍后再试");
    } finally {
      setSavingMeta(false);
    }
  }

  async function submitHandover() {
    if (handoverTo === "__none__") {
      toast.error("请选择交接对象");
      return;
    }
    setSavingHandover(true);
    try {
      const result = await handoverIssue({
        issueId:         initial.id,
        toUserId:        handoverTo,
        note:            handoverNote.trim() || undefined,
        attachmentNames: handoverAttachments.length > 0
          ? handoverAttachments.map((a) => a.filename)
          : undefined,
      });
      if (result?.error) { toast.error(result.error); return; }

      toast.success("交接成功，对方已收到通知");
      setShowHandover(false);
      setHandoverTo("__none__");
      setHandoverNote("");
      setHandoverAttachments([]);
      router.refresh();
    } catch {
      toast.error("交接失败，请稍后再试");
    } finally {
      setSavingHandover(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    try {
      await deleteAttachment(attachmentId);
      setIssueAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <>
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
                  if (v !== "blocked") setBlockedReason("");
                  if (v !== "closed")  setClosedReason("");
                }}
                disabled={!canEdit}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
          <div className="flex flex-wrap items-center gap-3">
            {canEdit && (
              <Button onClick={saveMeta} disabled={savingMeta}>
                {savingMeta ? "保存中…" : "保存修改"}
              </Button>
            )}
            {canHandover && !showHandover && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHandover(true)}
              >
                <ArrowRightLeft className="mr-1.5 h-4 w-4" />
                交接给同事
              </Button>
            )}
          </div>

          {/* ── 交接面板 ── */}
          {showHandover && (
            <>
              <Separator />
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-sm font-semibold">交接任务</p>
                <div className="space-y-1.5">
                  <Label>交接给 <span className="text-destructive">*</span></Label>
                  <Select value={handoverTo} onValueChange={(v) => setHandoverTo(v ?? "__none__")}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择同事" />
                    </SelectTrigger>
                    <SelectContent>
                      {members
                        .filter((m) => m.id !== currentUser.id)
                        .map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>交接说明 <span className="text-xs text-muted-foreground">（可选）</span></Label>
                  <Textarea
                    value={handoverNote}
                    onChange={(e) => setHandoverNote(e.target.value)}
                    placeholder="当前进展、注意事项、待办事项…"
                    rows={3}
                  />
                </div>

                {/* 交接附件 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>
                      交接附件
                      <span className="ml-1.5 text-xs text-muted-foreground">（可选，文件将以任务名自动命名）</span>
                    </Label>
                    <AttachmentUploadButton
                      issueId={initial.id}
                      label="上传附件"
                      disabled={savingHandover}
                      filenameTransform={(file) => {
                        const safeTitle = initial.title
                          .replace(/[<>:"/\\|?*]/g, "_")
                          .slice(0, 60)
                          .trim();
                        const ext = file.name.includes(".")
                          ? "." + file.name.split(".").pop()
                          : "";
                        const baseName = file.name.replace(/\.[^.]+$/, "");
                        return new File([file], `${safeTitle}_${baseName}${ext}`, { type: file.type });
                      }}
                      onUploaded={(a) => {
                        setHandoverAttachments((prev) => [...prev, a]);
                        setIssueAttachments((prev) => [...prev, a]);
                      }}
                    />
                  </div>
                  {handoverAttachments.length > 0 && (
                    <AttachmentList
                      attachments={handoverAttachments}
                      canDelete
                      onDelete={(id) => {
                        setHandoverAttachments((prev) => prev.filter((a) => a.id !== id));
                        handleDeleteAttachment(id);
                      }}
                    />
                  )}
                  {handoverAttachments.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      可上传文档、截图等，接手同事可直接下载
                    </p>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={submitHandover}
                    disabled={savingHandover || handoverTo === "__none__"}
                  >
                    {savingHandover ? "交接中…" : "确认交接"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={savingHandover}
                    onClick={() => {
                      setShowHandover(false);
                      setHandoverTo("__none__");
                      setHandoverNote("");
                      setHandoverAttachments([]);
                    }}
                  >
                    取消
                  </Button>
                </div>
              </div>
            </>
          )}
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
    </>
  );
}
