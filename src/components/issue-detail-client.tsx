"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { handoverIssue, updateIssue } from "@/actions/issues";
import { deleteAttachment, reassignAttachmentIssue } from "@/actions/attachments";
import type {
  IssuePriority,
  IssueAttachmentWithUrl,
  IssueHandoverWithUsers,
  IssueStatus,
  IssueWithRelations,
  User,
} from "@/types";
import { canActorTransition, getAllowedNextStatuses } from "@/lib/issue-state-machine";
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
import { formatDateTime, formatDateOnly } from "@/lib/dates";
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS, ISSUE_SOURCE_LABELS, ISSUE_CATEGORIES, ISSUE_MODULES, isIssueCategory, isIssueModule } from "@/lib/constants";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, CalendarIcon, Loader2, RotateCcw, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { generateDescriptionDraft, generateHandoverDraft, suggestPriority } from "@/actions/ai";
import { UserAvatar } from "@/components/user-avatar";

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
  const [category, setCategory]       = useState(
    initial.category && isIssueCategory(initial.category) ? initial.category : "__none__"
  );
  const [module, setModule]           = useState(
    initial.module && isIssueModule(initial.module) ? initial.module : "__none__"
  );
  const [blockedReason, setBlockedReason] = useState(initial.blocked_reason ?? "");
  const [closedReason,  setClosedReason]  = useState(initial.closed_reason  ?? "");
  const [dueDate, setDueDate] = useState<Date | undefined>(
    initial.due_date ? new Date(initial.due_date + "T12:00:00") : undefined
  );
  const [savingMeta, setSavingMeta] = useState(false);
  const [issueAttachments, setIssueAttachments] = useState<IssueAttachmentWithUrl[]>(
    (initial.attachments ?? []) as IssueAttachmentWithUrl[]
  );

  const isAdmin    = currentUser.role === "admin";
  const isAssignee = currentUser.id === initial.assignee_id;
  const isReviewer = currentUser.id === initial.reviewer_id;
  const isCreator  = currentUser.id === initial.creator_id;

  const canEditFields = isAdmin || isAssignee || isCreator;
  const canEditStatusInMeta = isAdmin || isAssignee;
  /** 优先级 / 负责人 / 审核人仅管理员可改，普通员工即使为创建人或负责人也不可改 */
  const canEditAssignmentMeta = isAdmin;

  // 交接：当前负责人或管理员可发起
  const canHandover =
    isAdmin ||
    isAssignee;

  // ─── 交接状态 ─────────────────────────────────────────────────────────────
  const [showHandover,        setShowHandover]        = useState(false);
  const [handoverTo,          setHandoverTo]          = useState("__none__");
  const [handoverNote,        setHandoverNote]        = useState("");
  const [savingHandover,      setSavingHandover]      = useState(false);
  const [handoverAttachments, setHandoverAttachments] = useState<IssueAttachmentWithUrl[]>([]);
  const [aiDrafting,          setAiDrafting]          = useState(false);
  const [aiDescDrafting,      setAiDescDrafting]      = useState(false);
  const [aiPrioritySuggesting, setAiPrioritySuggesting] = useState(false);

  const assigneeMember = useMemo(
    () =>
      assigneeId && assigneeId !== "__none__" ? members.find((m) => m.id === assigneeId) ?? null : null,
    [members, assigneeId],
  );
  const reviewerMember = useMemo(
    () =>
      reviewerId && reviewerId !== "__none__" ? members.find((m) => m.id === reviewerId) ?? null : null,
    [members, reviewerId],
  );
  const handoverToLabel = useMemo(() => {
    if (handoverTo === "__none__") return "选择同事";
    return members.find((m) => m.id === handoverTo)?.name ?? "未知成员";
  }, [members, handoverTo]);

  const dueStr = useMemo(() => {
    if (!dueDate) return null;
    const y = dueDate.getFullYear();
    const m = String(dueDate.getMonth() + 1).padStart(2, "0");
    const d = String(dueDate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [dueDate]);

  const hasIncompleteSubtasks = useMemo(
    () => (initial.children ?? []).some((subtask) => subtask.status !== "resolved" && subtask.status !== "closed"),
    [initial.children]
  );
  const attachmentOwnershipOptions = useMemo(
    () => [
      { issueId: initial.id, label: "主任务" },
      ...((initial.children ?? []).map((child, index) => ({
        issueId: child.id,
        label: `子任务${index + 1} · ${child.title}`,
      }))),
    ],
    [initial.id, initial.children]
  );

  // 允许切换的目标状态必须基于数据库里的当前状态（initial.status），
  // 而非用户正在选择的中间值——否则用户选了"已关闭"之后，
  // allowedNextStatuses 会立即换成从 closed 出发的转移，导致 "已关闭" 选项
  // 从列表里消失、Select 触发器显示空白，用户误以为选择失效而重新选别的状态。
  const allowedNextStatuses = useMemo(
    () =>
      getAllowedNextStatuses(initial.status)
        .filter((next) => !(next === "pending_review" && hasIncompleteSubtasks))
        .filter((next) =>
          canActorTransition({
            from: initial.status,
            to: next,
            isAdmin,
            isAssignee,
            isReviewer,
          })
        ),
    [initial.status, hasIncompleteSubtasks, isAdmin, isAssignee, isReviewer]
  );

  // ─── 保存元数据 ───────────────────────────────────────────────────────
  async function saveMeta() {
    if (!canEditFields) return;
    if (status === "pending_review" && hasIncompleteSubtasks) {
      toast.error("还有子任务未完成，全部搞定后就可以提交验证了");
      return;
    }
    setSavingMeta(true);
    try {
      const basePatch = {
        title:          title.trim(),
        description:    description.trim() || null,
        status,
        due_date:       dueStr,
        category:       category === "__none__" ? null : category,
        module:         module === "__none__" ? null : module,
        blocked_reason: status === "blocked" ? blockedReason.trim() || null : null,
        closed_reason:  status === "closed"  ? closedReason.trim()  || null : null,
      };
      const result = await updateIssue(
        initial.id,
        canEditAssignmentMeta
          ? {
              ...basePatch,
              priority,
              assignee_id: assigneeId === "__none__" ? null : assigneeId,
              reviewer_id: reviewerId === "__none__" ? null : reviewerId,
            }
          : basePatch
      );
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success("信息已更新，相关同事会看到最新内容");
        router.refresh();
      }
    } catch {
      toast.error("保存暂时没成功，你的修改还在，可以再试一次");
    } finally {
      setSavingMeta(false);
    }
  }

  const handovers = initial.handovers ?? [];
  const lastActiveHandover = [...handovers].reverse().find((h) => h.status === "active");
  const canReturn = (isAssignee || isAdmin) && lastActiveHandover && lastActiveHandover.from_user_id !== currentUser.id;
  const returnTargetName = lastActiveHandover?.from_user?.name ?? "上一位处理人";
  const [showReturnNote, setShowReturnNote] = useState(false);
  const [returnNote, setReturnNote]         = useState("");
  const [savingReturn, setSavingReturn]     = useState(false);

  async function submitHandover() {
    if (handoverTo === "__none__") {
      toast.error("请选择交接给哪位同事");
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
        kind:            "handover",
      });
      if (result?.error) { toast.error(result.error); return; }

      toast.success("交接已完成，新负责人已收到通知并接上了");
      setShowHandover(false);
      setHandoverTo("__none__");
      setHandoverNote("");
      setHandoverAttachments([]);
      router.refresh();
    } catch {
      toast.error("交接暂时没成功，可以稍后再试");
    } finally {
      setSavingHandover(false);
    }
  }

  async function submitReturn() {
    if (!lastActiveHandover) return;
    setSavingReturn(true);
    try {
      const result = await handoverIssue({
        issueId:  initial.id,
        toUserId: lastActiveHandover.from_user_id,
        note:     returnNote.trim() || undefined,
        kind:     "return",
      });
      if (result?.error) { toast.error(result.error); return; }
      toast.success("已发送修改需求给上一位处理人，对方会收到通知");
      setShowReturnNote(false);
      setReturnNote("");
      router.refresh();
    } catch {
      toast.error("退回暂时没成功，可以稍后再试");
    } finally {
      setSavingReturn(false);
    }
  }

  async function handleDeleteAttachment(attachmentId: string) {
    try {
      await deleteAttachment(attachmentId);
      setIssueAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除暂时没成功，可以稍后再试");
    }
  }

  async function handleReassignAttachment(attachmentId: string, targetIssueId: string) {
    try {
      await reassignAttachmentIssue({
        attachmentId,
        targetIssueId,
        parentIssueId: initial.id,
      });

      const childMetaMap = new Map(
        (initial.children ?? []).map((child, index) => [child.id, { idx: index + 1, title: child.title }])
      );
      setIssueAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== attachmentId) return a;
          const childMeta = childMetaMap.get(targetIssueId);
          return {
            ...a,
            issue_id: targetIssueId,
            source_subtask_index: childMeta?.idx ?? null,
            source_subtask_title: childMeta?.title ?? null,
          };
        })
      );
      toast.success("附件归属已更新");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "归属修改失败");
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
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEditFields} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>描述</Label>
              {canEditFields && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                  disabled={aiDescDrafting || savingMeta || (!title.trim() && !description.trim())}
                  onClick={async () => {
                    setAiDescDrafting(true);
                    try {
                      const draft = await generateDescriptionDraft(title, description);
                      if (draft) {
                        setDescription(draft);
                        toast.success("AI 草稿已就绪，你可以修改后再保存");
                      } else {
                        toast.info("请先填写标题或描述，AI 需要一些线索才能帮你扩写");
                      }
                    } catch {
                      toast.error("AI 生成暂时不可用，你也可以直接手动补充");
                    } finally {
                      setAiDescDrafting(false);
                    }
                  }}
                >
                  {aiDescDrafting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  AI 生成草稿
                </Button>
              )}
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              disabled={!canEditFields}
              placeholder="可简要写现象与期望；也可用「AI 生成草稿」根据标题与已有内容扩写"
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
                disabled={!canEditStatusInMeta || allowedNextStatuses.length === 0}
              >
                <SelectTrigger>
                  <SelectValue>
                    {status === initial.status
                      ? `${ISSUE_STATUS_LABELS[status]}（当前）`
                      : ISSUE_STATUS_LABELS[status]}
                  </SelectValue>
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
              {initial.status === "pending_review" && !isAdmin && !isReviewer && (
                <p className="text-xs text-muted-foreground">
                  当前处于待验证，需由审核人或管理员在进度区提交审核结果。
                </p>
              )}
              {initial.status === "pending_rework" && (
                <p className="text-xs text-muted-foreground">
                  当前为待返修（验证未通过）。负责人可先改为「处理中」再修改，或改完后直接再次提交「待验证」。
                </p>
              )}
              {initial.status !== "pending_review" && hasIncompleteSubtasks && (
                <p className="text-xs text-muted-foreground">
                  需先完成全部子任务，才可提交待验证。
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>优先级</Label>
                {canEditAssignmentMeta && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                    disabled={aiPrioritySuggesting || savingMeta || (!title.trim() && !description.trim())}
                    onClick={async () => {
                      setAiPrioritySuggesting(true);
                      try {
                        const result = await suggestPriority(title, description);
                        if (result) {
                          setPriority(result.priority);
                          if (result.suggestedDueDays != null && !dueDate) {
                            const d = new Date();
                            d.setDate(d.getDate() + result.suggestedDueDays);
                            setDueDate(d);
                          }
                          toast.success(`AI 建议优先级为「${ISSUE_PRIORITY_LABELS[result.priority]}」— ${result.reason}`);
                        } else {
                          toast.info("AI 这次没有把握，你可以根据实际情况手动设置");
                        }
                      } catch {
                        toast.error("AI 推荐暂时不可用，手动设置也很快");
                      } finally {
                        setAiPrioritySuggesting(false);
                      }
                    }}
                  >
                    {aiPrioritySuggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    AI 推荐
                  </Button>
                )}
              </div>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as IssuePriority)}
                disabled={!canEditAssignmentMeta}
              >
                <SelectTrigger>
                  <SelectValue>{ISSUE_PRIORITY_LABELS[priority]}</SelectValue>
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
                disabled={!canEditStatusInMeta}
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
                disabled={!canEditStatusInMeta}
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>负责人</Label>
              <Select
                value={assigneeId}
                onValueChange={(v) => setAssigneeId(v ?? "__none__")}
                disabled={!canEditAssignmentMeta}
              >
                <SelectTrigger className="min-h-9">
                  <div className="flex min-w-0 items-center gap-2">
                    {assigneeMember ? (
                      <>
                        <UserAvatar user={assigneeMember} className="h-6 w-6 shrink-0" fallbackClassName="text-[10px]" />
                        <span className="truncate">{assigneeMember.name}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">未分配</span>
                    )}
                  </div>
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
                disabled={!canEditAssignmentMeta}
              >
                <SelectTrigger className="min-h-9">
                  <div className="flex min-w-0 items-center gap-2">
                    {reviewerMember ? (
                      <>
                        <UserAvatar user={reviewerMember} className="h-6 w-6 shrink-0" fallbackClassName="text-[10px]" />
                        <span className="truncate">{reviewerMember.name}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">未指定</span>
                    )}
                  </div>
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
                  disabled={!canEditFields}
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
                {ISSUE_SOURCE_LABELS[initial.source ?? "manual"] ?? initial.source ?? "手动录入"}
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
              <Select
                value={category}
                onValueChange={(v) => setCategory(v ?? "__none__")}
                disabled={!canEditFields}
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择分类" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未设置</SelectItem>
                  {ISSUE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>模块</Label>
              <Select
                value={module}
                onValueChange={(v) => setModule(v ?? "__none__")}
                disabled={!canEditFields}
              >
                <SelectTrigger>
                  <SelectValue placeholder="请选择模块" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未设置</SelectItem>
                  {ISSUE_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="text-sm text-muted-foreground space-y-1">
            <p className="flex flex-wrap items-center gap-x-1 gap-y-1">
              <span>创建者：</span>
              {initial.creator ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserAvatar user={initial.creator} className="h-6 w-6 shrink-0" fallbackClassName="text-[10px]" />
                  <span>{initial.creator.name}</span>
                </span>
              ) : (
                <span>—</span>
              )}
              <span>· 创建于 {formatDateTime(initial.created_at)}</span>
            </p>
            <p>最近更新：{formatDateTime(initial.updated_at)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {canEditFields && (
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
                    <SelectTrigger className="w-full justify-between [&>span]:min-w-0">
                      <span className="line-clamp-1 flex-1 text-left">{handoverToLabel}</span>
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
                  <div className="flex items-center justify-between">
                    <Label>交接说明 <span className="text-xs text-muted-foreground">（可选）</span></Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                      disabled={aiDrafting || savingHandover}
                      onClick={async () => {
                        setAiDrafting(true);
                        try {
                          const draft = await generateHandoverDraft(initial.id);
                          if (draft) {
                            setHandoverNote(draft);
                            toast.success("AI 已帮你准备了交接说明，可以修改后确认");
                          } else {
                            toast.info("AI 这次没有把握，你可以手动补充交接说明");
                          }
                        } catch {
                        toast.error("AI 生成暂时不可用，你可以直接手动填写");
                    } finally {
                          setAiDrafting(false);
                        }
                      }}
                    >
                      {aiDrafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI 生成草稿
                    </Button>
                  </div>
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
                      variant="list"
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

          {/* ── 协作流转 ── */}
          {handovers.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-base font-semibold">协作流转</Label>
                </div>
                <div className="rounded-lg border bg-muted/20 p-3">
                  <div className="space-y-2">
                    {handovers.map((h, i) => (
                      <div key={h.id} className="flex items-start gap-2">
                        <div className="flex flex-col items-center pt-1.5">
                          <div className={cn(
                            "h-2.5 w-2.5 rounded-full shrink-0",
                            h.kind === "return" ? "bg-amber-500" : "bg-primary"
                          )} />
                          {i < handovers.length - 1 && <div className="w-px flex-1 bg-border mt-0.5 min-h-[16px]" />}
                        </div>
                        <div className="min-w-0 flex-1 pb-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-sm">
                            <span className="font-medium">{h.from_user?.name ?? "未知"}</span>
                            <span className="text-muted-foreground">
                                  {h.kind === "return" ? "已发送修改需求给" : "交接给"}
                            </span>
                                <span className="font-medium">{h.to_user?.name ?? "未知"}</span>
                            {h.kind === "return" && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                返工
                              </span>
                            )}
                            {h.status === "returned" && (
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                已退回
                              </span>
                            )}
                          </div>
                          {h.note && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{h.note}</p>
                          )}
                          <p className="text-[11px] text-muted-foreground/70">{formatDateTime(h.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {canReturn && !showReturnNote && (
                  <div className="space-y-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowReturnNote(true)}
                      className="gap-1.5"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      发送修改需求给{returnTargetName}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      也可以交给其他人发送需求，点击“交接给同事”。
                    </p>
                  </div>
                )}

                {showReturnNote && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2 dark:border-amber-900/50 dark:bg-amber-950/20">
                          <p className="text-sm font-medium">发送修改需求给 {returnTargetName}</p>
                    <Textarea
                      value={returnNote}
                      onChange={(e) => setReturnNote(e.target.value)}
                      placeholder="说明需要返工的原因和具体问题…"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={submitReturn} disabled={savingReturn}>
                              {savingReturn ? "发送中…" : "确认发送需求"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={savingReturn}
                        onClick={() => { setShowReturnNote(false); setReturnNote(""); }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-base font-semibold">附件</Label>
              <AttachmentUploadButton
                issueId={initial.id}
                onUploaded={(a) => setIssueAttachments((prev) => [...prev, a])}
              />
            </div>
            <div className="rounded-lg border bg-muted/20 p-3">
              {issueAttachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无附件，点击右上角添加</p>
              ) : (
                <AttachmentList
                  attachments={issueAttachments}
                  variant="list"
                  canDelete={currentUser.role === "admin" || currentUser.id === initial.creator_id}
                  ownershipOptions={attachmentOwnershipOptions}
                  onReassign={handleReassignAttachment}
                  onDelete={(id) => handleDeleteAttachment(id)}
                />
              )}
            </div>
          </div>

          {/* ── 父问题引用 ── */}
          {initial.parent && (
            <>
              <Separator />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">所属父问题</Label>
                <Link
                  href={`/issues/${initial.parent.id}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
                >
                  <StatusBadge status={initial.parent.status} />
                  <span className="truncate font-medium text-primary hover:underline">
                    {initial.parent.title}
                  </span>
                </Link>
              </div>
            </>
          )}

        </CardContent>
      </Card>
    </>
  );
}
