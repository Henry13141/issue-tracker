import { Suspense } from "react";
import { getIssues, type IssueFilters, type IssueSortBy, type IssueRisk } from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { IssuesToolbar } from "@/components/issues-toolbar";
import { IssuesTable } from "@/components/issues-table";
import { IssueFormDialog } from "@/components/issue-form-dialog";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { EmptyState } from "@/components/empty-state";
import type { IssuePriority, IssueStatus } from "@/types";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

const VALID_SORT_BY: IssueSortBy[] = ["updated_at", "created_at", "due_date", "last_activity_at", "priority"];
const VALID_RISK: IssueRisk[]      = ["overdue", "stale", "blocked", "urgent"];

function parseFilters(sp: Record<string, string | string[] | undefined>): IssueFilters {
  const rawSortBy = str(sp.sortBy);
  const rawRisk   = str(sp.risk);

  return {
    status:     str(sp.status)   ? ([str(sp.status)] as IssueStatus[])   : undefined,
    priority:   str(sp.priority) ? ([str(sp.priority)] as IssuePriority[]) : undefined,
    assigneeId: str(sp.assignee),
    reviewerId: str(sp.reviewer),
    category:   str(sp.category),
    module:     str(sp.module),
    source:     str(sp.source),
    risk:       (rawRisk && VALID_RISK.includes(rawRisk as IssueRisk)) ? rawRisk as IssueRisk : undefined,
    sortBy:     (rawSortBy && VALID_SORT_BY.includes(rawSortBy as IssueSortBy)) ? rawSortBy as IssueSortBy : undefined,
    sortDir:    str(sp.sortDir) === "asc" ? "asc" : "desc",
    q:          str(sp.q),
  };
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const [issues, members, user] = await Promise.all([
    getIssues(filters),
    getMembers(),
    getCurrentUser(),
  ]);

  if (!user) return null;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">问题列表</h1>
          <p className="text-sm text-muted-foreground">查看、筛选并跟踪所有问题</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExcelDialog />
          <IssueFormDialog members={members} />
        </div>
      </div>

      <Suspense fallback={null}>
        <IssuesToolbar members={members} />
      </Suspense>

      {issues.length === 0 ? (
        <EmptyState
          title="还没有问题记录"
          description="点击右上角「新建问题」创建第一条记录，或使用筛选条件调整查询。"
        />
      ) : (
        <IssuesTable issues={issues} currentUser={user} />
      )}
    </div>
  );
}
