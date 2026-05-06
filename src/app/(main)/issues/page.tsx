import { Suspense } from "react";
import Link from "next/link";
import {
  getIssues,
  getIssuesGrouped,
  type IssueFilters,
  type IssueSortBy,
  type IssueRisk,
  type IssueTab,
} from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { IssuesToolbar } from "@/components/issues-toolbar";
import { IssuesTabRow } from "@/components/issues-tab-row";
import { IssuesTable } from "@/components/issues-table";
import { IssuesGroupedView } from "@/components/issues-grouped-view";
import { IssueFormDialog } from "@/components/issue-form-dialog";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { ExportTemplateButton } from "@/components/export-template-button";
import { EmptyState } from "@/components/empty-state";
import type { IssuePriority, IssueStatus } from "@/types";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/button-variants";
import { isIssueCategory, isIssueModule } from "@/lib/constants";

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

const VALID_SORT_BY: IssueSortBy[] = ["updated_at", "created_at", "due_date", "last_activity_at", "priority"];
const VALID_RISK: IssueRisk[]      = ["overdue", "stale", "blocked", "urgent"];
const VALID_TAB: IssueTab[]        = ["all", "mine", "risk"];

function toSearchParams(sp: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) params.set(k, v);
  }
  return params;
}

function buildHref(
  sp: Record<string, string | string[] | undefined>,
  patch: Record<string, string | null>,
  resetFilters = false
) {
  const next = resetFilters ? new URLSearchParams() : toSearchParams(sp);
  for (const [k, v] of Object.entries(patch)) {
    if (!v) next.delete(k);
    else next.set(k, v);
  }
  const qs = next.toString();
  return qs ? `/issues?${qs}` : "/issues";
}

function parseFilters(sp: Record<string, string | string[] | undefined>): IssueFilters {
  const rawSortBy = str(sp.sortBy);
  const rawRisk   = str(sp.risk);
  const rawCategory = str(sp.category);
  const rawModule = str(sp.module);
  const rawPage = Number(str(sp.page) ?? "");
  const rawTab = str(sp.tab);

  return {
    status:     str(sp.status)   ? ([str(sp.status)] as IssueStatus[])   : undefined,
    priority:   str(sp.priority) ? ([str(sp.priority)] as IssuePriority[]) : undefined,
    assigneeId: str(sp.assignee),
    reviewerId: str(sp.reviewer),
    category:   rawCategory && isIssueCategory(rawCategory) ? rawCategory : undefined,
    module:     rawModule && isIssueModule(rawModule) ? rawModule : undefined,
    source:     str(sp.source),
    risk:       (rawRisk && VALID_RISK.includes(rawRisk as IssueRisk)) ? rawRisk as IssueRisk : undefined,
    sortBy:     (rawSortBy && VALID_SORT_BY.includes(rawSortBy as IssueSortBy)) ? rawSortBy as IssueSortBy : undefined,
    sortDir:    str(sp.sortDir) === "asc" ? "asc" : "desc",
    q:          str(sp.q),
    page:       Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1,
    pageSize:   20,
    tab:        (rawTab && VALID_TAB.includes(rawTab as IssueTab)) ? (rawTab as IssueTab) : undefined,
  };
}

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const user = await getCurrentUser();

  if (!user) return null;

  const filters = parseFilters(sp);
  const effectiveTab: IssueTab = filters.tab ?? (user.role === "admin" ? "all" : "mine");
  const isGrouped = str(sp.view) === "grouped" && !filters.module; // 有具体模块时不强制分组

  const [issueData, groupedData, members] = await Promise.all([
    isGrouped
      ? Promise.resolve(null)
      : getIssues({
          ...filters,
          tab: effectiveTab,
          assigneeId: effectiveTab === "mine" ? user.id : filters.assigneeId,
        }),
    isGrouped
      ? getIssuesGrouped({
          ...filters,
          tab: effectiveTab,
          assigneeId: effectiveTab === "mine" ? user.id : filters.assigneeId,
        })
      : Promise.resolve(null),
    getMembers(),
  ]);

  const items     = issueData?.items ?? [];
  const total     = issueData?.total ?? 0;
  const page      = issueData?.page  ?? 1;
  const pageSize  = issueData?.pageSize ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">问题列表</h1>
          <p className="text-sm text-muted-foreground">团队在推进的事情都在这里</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportTemplateButton />
          <ImportExcelDialog />
          <IssueFormDialog members={members} currentUser={user} />
        </div>
      </div>

      <Suspense fallback={<div className="mb-3 h-9" aria-hidden />}>
        <IssuesTabRow
          tabs={[
            {
              key: "all",
              label: "全部",
              href: buildHref(sp, { tab: "all", page: null }, true),
              active: effectiveTab === "all",
            },
            {
              key: "mine",
              label: "待我处理",
              href: buildHref(sp, { tab: "mine", page: null }, true),
              active: effectiveTab === "mine",
            },
            {
              key: "risk",
              label: "高风险",
              href: buildHref(sp, { tab: "risk", page: null }, true),
              active: effectiveTab === "risk",
            },
          ]}
        />
      </Suspense>

      <Suspense fallback={null}>
        <IssuesToolbar members={members} />
      </Suspense>

      {isGrouped ? (
        groupedData && groupedData.length > 0 ? (
          <IssuesGroupedView groups={groupedData} currentUser={user} />
        ) : (
          <EmptyState
            title="当前没有匹配的记录"
            description="可以新建问题开启跟踪，或调整筛选条件重新查看。"
          />
        )
      ) : items.length === 0 ? (
        <EmptyState
          title="当前没有匹配的记录"
          description="可以新建问题开启跟踪，或调整筛选条件重新查看。"
        />
      ) : (
        <>
          <IssuesTable issues={items} currentUser={user} />
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <Link
                href={buildHref(sp, { page: String(page - 1) })}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}
              >
                上一页
              </Link>
              <span className="text-sm text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Link
                href={buildHref(sp, { page: String(page + 1) })}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= totalPages && "pointer-events-none opacity-50")}
              >
                下一页
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
