"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateIssue, deleteIssue } from "@/actions/issues";
import type { IssueStatus, IssueWithRelations, User } from "@/types";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/button-variants";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

function isOverdue(issue: IssueWithRelations) {
  if (!issue.due_date) return false;
  if (issue.status === "resolved" || issue.status === "closed") return false;
  const d = new Date(issue.due_date + "T23:59:59+08:00");
  return d.getTime() < Date.now();
}

export function IssuesTable({
  issues,
  currentUser,
}: {
  issues: IssueWithRelations[];
  currentUser: User;
}) {
  const router = useRouter();

  async function onStatusChange(id: string, status: IssueStatus) {
    try {
      await updateIssue(id, { status });
      toast.success("状态已更新");
      router.refresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "更新失败");
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

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[200px]">标题</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>优先级</TableHead>
            <TableHead>负责人</TableHead>
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
                      {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((s) => (
                        <DropdownMenuItem
                          key={s}
                          disabled={issue.status === s}
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
  );
}
