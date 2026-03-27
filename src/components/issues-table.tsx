"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateIssue, deleteIssue } from "@/actions/issues";
import type { IssueStatus, IssueWithRelations, User } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { formatDateTime, formatDateOnly } from "@/lib/dates";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";
import { getAllowedNextStatuses } from "@/lib/issue-state-machine";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/button-variants";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AttachmentThumbnails } from "@/components/attachment-thumbnails";

function isOverdue(issue: IssueWithRelations) {
  if (!issue.due_date) return false;
  if (issue.status === "resolved" || issue.status === "closed") return false;
  const d = new Date(issue.due_date + "T23:59:59+08:00");
  return d.getTime() < Date.now();
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
}: {
  issues: IssueWithRelations[];
  currentUser: User;
}) {
  const router = useRouter();
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog>({
    open: false,
    issueId: "",
    status: "closed",
    reason: "",
    submitting: false,
  });

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
      toast.success("状态已更新");
      router.refresh();
    } catch {
      toast.error("更新失败，请稍后再试");
    }
  }

  async function onReasonConfirm() {
    const { issueId, status, reason } = reasonDialog;
    if (!reason.trim()) {
      toast.error(status === "closed" ? "请填写关闭原因" : "请填写阻塞原因");
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
      toast.success("状态已更新");
      setReasonDialog((d) => ({ ...d, open: false, submitting: false }));
      router.refresh();
    } catch {
      toast.error("更新失败，请稍后再试");
      setReasonDialog((d) => ({ ...d, submitting: false }));
    }
  }

  async function onDelete(id: string) {
    if (!confirm("确定删除该问题？")) return;
    try {
      await deleteIssue(id);
      toast.success("已删除");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "删除失败");
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
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">标题</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>负责人</TableHead>
            <TableHead className="w-[120px]">附件</TableHead>
            <TableHead>截止日期</TableHead>
            <TableHead>最后活动</TableHead>
            <TableHead className="w-[60px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {issues.map((issue) => {
            const overdue = isOverdue(issue);
            return (
              <TableRow
                key={issue.id}
                className={cn(overdue && "bg-red-50 dark:bg-red-950/30")}
              >
                <TableCell>
                  <Link
                    href={`/issues/${issue.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {issue.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={issue.status} />
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={issue.priority} />
                </TableCell>
                <TableCell>
                  {issue.assignee ? (
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-xs">
                          {issue.assignee.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{issue.assignee.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground text-sm">未分配</span>
                  )}
                </TableCell>
                <TableCell>
                  <AttachmentThumbnails attachments={issue.attachments ?? []} />
                </TableCell>
                <TableCell className={cn(overdue && "font-medium text-red-600")}>
                  {formatDateOnly(issue.due_date)}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDateTime(issue.updated_at)}
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
                      <DropdownMenuSeparator />
                      {getAllowedNextStatuses(issue.status).map((s) => (
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
