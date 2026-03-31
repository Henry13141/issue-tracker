import { Suspense } from "react";
import Link from "next/link";
import {
  getIssues,
  type IssueFilters,
  type IssueSortBy,
  type IssueRisk,
  type IssueTab,
} from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { IssuesToolbar } from "@/components/issues-toolbar";
import { IssuesTable } from "@/components/issues-table";
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
  const [{ items, total, page, pageSize }, members] = await Promise.all([
    getIssues({
      ...filters,
      tab: effectiveTab,
      assigneeId: effectiveTab === "mine" ? user.id : filters.assigneeId,
    }),
    getMembers(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">问题列表</h1>
          <p className="text-sm text-muted-foreground">查看、筛选并跟踪所有问题</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportTemplateButton />
          <ImportExcelDialog />
          <IssueFormDialog members={members} />
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {[
          { key: "all", label: "全部" },
          { key: "mine", label: "待我处理" },
          { key: "risk", label: "高风险" },
        ].map((tab) => {
          const active = effectiveTab === tab.key;
          return (
            <Link
              key={tab.key}
              href={buildHref(
                sp,
                { tab: tab.key, page: null },
                true
              )}
              className={cn(
                buttonVariants({ variant: active ? "default" : "outline", size: "sm" })
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Suspense fallback={null}>
        <IssuesToolbar members={members} />
      </Suspense>

      {items.length === 0 ? (
        <EmptyState
          title="还没有问题记录"
          description="点击右上角「新建问题」创建第一条记录，或使用筛选条件调整查询。"
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
