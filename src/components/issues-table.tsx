"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateIssue, deleteIssue } from "@/actions/issues";
import type { IssueStatus, IssueWithRelations, User } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateOnly } from "@/lib/dates";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import { canActorTransition, getAllowedNextStatuses } from "@/lib/issue-state-machine";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/button-variants";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

function isOverdue(issue: IssueWithRelations) {
  if (!issue.due_date) return false;
  if (issue.status === "resolved" || issue.status === "closed") return false;
  const d = new Date(issue.due_date + "T23:59:59+08:00");
  return d.getTime() < Date.now();
}

type RiskTag = "overdue" | "blocked" | "urgent" | "stale";

const RISK_TAG_LABELS: Record<RiskTag, string> = {
  overdue: "逾期",
  blocked: "阻塞",
  urgent: "紧急",
  stale: "未更新",
};

const RISK_TAG_CLASSNAMES: Record<RiskTag, string> = {
  overdue: "border-red-200 bg-red-100 text-red-700 dark:border-red-900/70 dark:bg-red-950/50 dark:text-red-200",
  blocked: "border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-900/70 dark:bg-orange-950/50 dark:text-orange-200",
  urgent: "border-pink-200 bg-pink-100 text-pink-700 dark:border-pink-900/70 dark:bg-pink-950/50 dark:text-pink-200",
  stale: "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/50 dark:text-amber-200",
};

function getRiskTags(issue: IssueWithRelations): RiskTag[] {
  const tags: RiskTag[] = [];
  if (isOverdue(issue)) tags.push("overdue");
  if (issue.status === "blocked") tags.push("blocked");
  if (issue.priority === "urgent") tags.push("urgent");

  const activeForStale = ["in_progress", "blocked", "pending_review", "pending_rework"].includes(issue.status);
  const lastActivity = issue.last_activity_at ? new Date(issue.last_activity_at).getTime() : Number.NaN;
  if (activeForStale && Number.isFinite(lastActivity) && lastActivity < Date.now() - 3 * 86_400_000) {
    tags.push("stale");
  }
  return tags;
}

function formatRelativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.max(1, Math.floor(diff / 3_600_000))} 小时前`;
  return `${Math.max(1, Math.floor(diff / 86_400_000))} 天前`;
}

type ReasonDialog = {
  open: boolean;
  issueId: string;
  status: "closed" | "blocked";
  reason: string;
  submitting: boolean;
};

export function IssuesTable({
  issues,
  currentUser,
  compact = false,
}: {
  issues: IssueWithRelations[];
  currentUser: User;
  /** 分组视图中使用：移除外层 border，融入父卡片 */
  compact?: boolean;
}) {
  const router = useRouter();
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog>({
    open: false,
    issueId: "",
    status: "closed",
    reason: "",
    submitting: false,
  });
  const isAdmin = currentUser.role === "admin";

  async function onStatusChange(id: string, status: IssueStatus) {
    if (status === "closed" || status === "blocked") {
      setReasonDialog({ open: true, issueId: id, status, reason: "", submitting: false });
      return;
    }
    try {
      const result = await updateIssue(id, { status });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("状态已更新，这件事又往前推了一步");
      router.refresh();
    } catch {
      toast.error("更新暂时没成功，可以稍后再试");
    }
  }

  async function onReasonConfirm() {
    const { issueId, status, reason } = reasonDialog;
    if (!reason.trim()) {
      toast.error(status === "closed" ? "补充一下关闭原因，方便后续复盘" : "写下阻塞原因，团队才能更快帮你解决");
      return;
    }
    setReasonDialog((d) => ({ ...d, submitting: true }));
    try {
      const patch =
        status === "closed"
          ? { status: "closed" as IssueStatus, closed_reason: reason.trim() }
          : { status: "blocked" as IssueStatus, blocked_reason: reason.trim() };
      const result = await updateIssue(issueId, patch);
      if (result?.error) {
        toast.error(result.error);
        setReasonDialog((d) => ({ ...d, submitting: false }));
        return;
      }
      toast.success("状态已更新，这件事又往前推了一步");
      setReasonDialog((d) => ({ ...d, open: false, submitting: false }));
      router.refresh();
    } catch {
      toast.error("更新暂时没成功，可以稍后再试");
      setReasonDialog((d) => ({ ...d, submitting: false }));
    }
  }

  async function onDelete(id: string) {
    if (!confirm("确定删除该问题？")) return;
    try {
      await deleteIssue(id);
      toast.success("问题已移除，列表更清爽了");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "删除没成功，可以稍后再试");
    }
  }

  const isBlocked = reasonDialog.status === "blocked";

  return (
    <>
    <Dialog
      open={reasonDialog.open}
      onOpenChange={(open) => !reasonDialog.submitting && setReasonDialog((d) => ({ ...d, open }))}
    >
      <DialogContent showCloseButton={!reasonDialog.submitting}>
        <DialogHeader>
          <DialogTitle>{isBlocked ? "填写阻塞原因" : "填写关闭原因"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-destructive">
            {isBlocked ? "阻塞原因" : "关闭原因"} *
          </Label>
          <Textarea
            autoFocus
            rows={3}
            placeholder={isBlocked ? "请描述阻塞原因（必填）" : "请描述关闭原因（必填）"}
            value={reasonDialog.reason}
            onChange={(e) => setReasonDialog((d) => ({ ...d, reason: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onReasonConfirm();
            }}
            disabled={reasonDialog.submitting}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setReasonDialog((d) => ({ ...d, open: false }))}
            disabled={reasonDialog.submitting}
          >
            取消
          </Button>
          <Button
            variant={isBlocked ? "default" : "destructive"}
            onClick={onReasonConfirm}
            disabled={reasonDialog.submitting}
          >
            {reasonDialog.submitting ? "提交中…" : "确认"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <div className={cn(!compact && "rounded-md border")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[360px]">标题</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>负责人</TableHead>
            <TableHead>截止日期</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => {
            const overdue = isOverdue(issue);
            const riskTags = getRiskTags(issue);
            const quickStatuses = getAllowedNextStatuses(issue.status).filter((next) =>
              canActorTransition({
                from: issue.status,
                to: next,
                isAdmin,
                isAssignee: currentUser.id === issue.assignee_id,
                isReviewer: currentUser.id === issue.reviewer_id,
              })
            );
            const reviewerName = issue.reviewer?.name?.trim();
            const showReviewer = Boolean(
              issue.reviewer_id &&
              reviewerName &&
              reviewerName !== "未设置"
            );
            const metaBits = [
              issue.category || "未分类",
              issue.module || "未分模块",
              ...(showReviewer ? [`评审：${reviewerName}`] : []),
              `最近更新：${formatRelativeTime(issue.last_activity_at ?? issue.updated_at)}`,
            ];
            const attachmentCount = issue.attachmentCount ?? issue.attachments?.length ?? 0;
            return (
              <TableRow
                key={issue.id}
                className={cn(overdue && "bg-red-50 dark:bg-red-950/30")}
              >
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {issue.parent_issue_id && (
                        <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/50 dark:text-indigo-200">
                          子任务
                        </span>
                      )}
                      {riskTags.map((tag) => (
                        <span
                          key={`${issue.id}-${tag}`}
                          className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-medium", RISK_TAG_CLASSNAMES[tag])}
                        >
                          {RISK_TAG_LABELS[tag]}
                        </span>
                      ))}
                      <Link
                        href={`/issues/${issue.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {issue.title}
                      </Link>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span>{metaBits.join(" · ")}</span>
                      {attachmentCount > 0 && <span>📎 {attachmentCount}</span>}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {quickStatuses.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "sm" }),
                          "h-8 px-1.5 gap-1.5"
                        )}
                      >
                        <StatusBadge status={issue.status} />
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {quickStatuses.map((s) => (
                          <DropdownMenuItem
                            key={`quick-status-${issue.id}-${s}`}
                            onClick={() => onStatusChange(issue.id, s)}
                          >
                            设为 {ISSUE_STATUS_LABELS[s]}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <StatusBadge status={issue.status} />
                  )}
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={issue.priority} />
                </TableCell>
                <TableCell>
                  {issue.assignee ? (
                    <div className="flex items-center gap-2">
                      <UserAvatar user={issue.assignee} className="h-7 w-7" fallbackClassName="text-xs" />
                      <span className="text-sm">{issue.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">未分配</span>
                  )}
                </TableCell>
                <TableCell className={cn(overdue && "font-medium text-red-600")}>
                  {formatDateOnly(issue.due_date)}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className={cn(
                        buttonVariants({ variant: "ghost", size: "icon" }),
                        "h-8 w-8"
                      )}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => router.push(`/issues/${issue.id}`)}
                      >
                        查看详情
                      </DropdownMenuItem>
                      {quickStatuses.length > 0 && <DropdownMenuSeparator />}
                      {quickStatuses.map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => onStatusChange(issue.id, s)}
                        >
                          设为 {ISSUE_STATUS_LABELS[s]}
                        </DropdownMenuItem>
                      ))}
                      {currentUser.role === "admin" ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => onDelete(issue.id)}
                          >
                            删除
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
    </>
  );
}
