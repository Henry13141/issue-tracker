"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FinanceTaskWeekScheduleDialog } from "@/components/finance-task-week-schedule-dialog";
import { StatCard } from "@/components/stat-card";
import { FinanceWeekPlanGrid } from "@/components/finance-week-plan-grid";
import { FinanceWeekPlanItemDialog } from "@/components/finance-week-plan-item-dialog";
import {
  FinanceWeekPlanToolbar,
  type FinanceWeekPlanFilters,
} from "@/components/finance-week-plan-toolbar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FINANCE_TASK_AREA_LABELS,
  FINANCE_WEEK_VIEW_SOURCE_LABELS,
  FINANCE_WEEK_PLAN_STATUS_LABELS,
  formatHours,
  formatFinanceDateShort,
  getDateDiffInDays,
  getFinanceWeekInfo,
  getFinanceWeekTitle,
  shiftDateOnly,
} from "@/lib/finance-ops";
import type { FinanceWeekPlanBundle } from "@/lib/finance-week-plan-queries";
import type { User } from "@/types";

const DEFAULT_FILTERS: FinanceWeekPlanFilters = {
  area: "all",
  showAdHocOnly: false,
  showOpenOnly: false,
};

export function FinanceWeekPlanClient({
  bundle,
  members,
}: {
  bundle: FinanceWeekPlanBundle;
  members: User[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FinanceWeekPlanFilters>(DEFAULT_FILTERS);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(bundle.rows[0]?.id ?? null);

  function switchWeek(nextWeekStart: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", nextWeekStart);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const filteredRows = useMemo(() => {
    return bundle.rows.filter((row) => {
      if (filters.area !== "all" && row.area !== filters.area) return false;
      if (filters.showAdHocOnly && row.source !== "ad_hoc") return false;
      if (filters.showOpenOnly && (row.status === "completed" || row.status === "skipped")) return false;
      return true;
    });
  }, [bundle.rows, filters]);

  const selectedRow = filteredRows.find((row) => row.id === selectedRowId) ?? filteredRows[0] ?? null;

  const summary = useMemo(
    () => ({
      total: filteredRows.length,
      taskCount: filteredRows.filter((row) => row.kind === "task").length,
      multiDay: filteredRows.filter((row) => getDateDiffInDays(row.start_date, row.end_date) > 0).length,
      adHoc: filteredRows.filter((row) => row.source === "ad_hoc").length,
      completed: filteredRows.filter((row) => row.status === "completed").length,
      inProgress: filteredRows.filter((row) => row.status === "in_progress").length,
    }),
    [filteredRows]
  );

  const weekTitle = getFinanceWeekTitle(new Date(`${bundle.weekStart}T12:00:00+08:00`));

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-wide text-muted-foreground">本周编排</h2>
          <p
            className="text-sm text-muted-foreground"
            // Turbopack HMR 有时只更新客户端 bundle，已缓存的 RSC HTML 仍含旧文案，会触发一次 recoverable hydration 警告；此处为纯静态说明。
            suppressHydrationWarning
          >
            待办管理只保留状态，这里把本周的执行过程与跨天安排集中展示出来。
          </p>
        </div>
        <FinanceWeekPlanToolbar
          weekTitle={weekTitle}
          filters={filters}
          onChangeFilters={setFilters}
          onPrevWeek={() => switchWeek(shiftDateOnly(bundle.weekStart, -7))}
          onToday={() => switchWeek(getFinanceWeekInfo().weekStart)}
          onNextWeek={() => switchWeek(shiftDateOnly(bundle.weekStart, 7))}
          action={<FinanceWeekPlanItemDialog members={members} weekStart={bundle.weekStart} weekEnd={bundle.weekEnd} />}
        />
      </section>

      <section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard title="本周事项总数" value={summary.total} description="当前筛选范围内的所有周视图行" />
          <StatCard title="同步待办数" value={summary.taskCount} description="来自待办管理并自动带入周视图的任务" />
          <StatCard title="跨天事项数" value={summary.multiDay} description="持续 2 天及以上的事项" />
          <StatCard title="临时事项数" value={summary.adHoc} description="标记为临时插入的工作" />
          <StatCard title="进行中" value={summary.inProgress} description="已经开始推进的事项" />
          <StatCard title="已完成" value={summary.completed} description="已完成但仍保留在当前周视图中" />
        </div>
      </section>

      <section>
        <FinanceWeekPlanGrid
          rows={filteredRows}
          members={members}
          weekStart={bundle.weekStart}
          weekEnd={bundle.weekEnd}
          selectedRowId={selectedRow?.id ?? null}
          onSelectRow={setSelectedRowId}
        />
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-wide text-muted-foreground">本周事项明细</h2>
          <p className="text-sm text-muted-foreground">
            点击上方任意条带可定位到对应事项；待办同步项在这里补充过程信息，临时事项继续按原周事项编辑。
          </p>
        </div>

        {filteredRows.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              当前筛选条件下没有事项，可以放宽筛选条件，或直接新增临时周事项。
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">明细列表</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>事项</TableHead>
                    <TableHead>时间</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>工时</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="w-[96px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={selectedRow?.id === row.id ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelectedRowId(row.id)}
                    >
                      <TableCell className="whitespace-normal">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{FINANCE_TASK_AREA_LABELS[row.area]}</Badge>
                            <Badge variant="outline">{FINANCE_WEEK_VIEW_SOURCE_LABELS[row.source]}</Badge>
                            {row.is_auto_generated ? <Badge variant="outline">自动带入</Badge> : null}
                          </div>
                          <div>
                            <p className="font-medium">{row.title}</p>
                            {row.description ? (
                              <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {formatFinanceDateShort(row.start_date)}
                        {row.start_date === row.end_date ? "" : ` - ${formatFinanceDateShort(row.end_date)}`}
                        {row.due_date ? (
                          <p className="mt-1 text-xs text-muted-foreground">截止：{formatFinanceDateShort(row.due_date)}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{FINANCE_WEEK_PLAN_STATUS_LABELS[row.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <div>计划：{formatHours(row.planned_hours)}</div>
                        <div>实际：{formatHours(row.actual_hours)}</div>
                      </TableCell>
                      <TableCell className="max-w-[320px] whitespace-normal text-sm text-muted-foreground">
                        {row.notes || "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.kind === "task" ? (
                          <FinanceTaskWeekScheduleDialog
                            row={row}
                            weekStart={bundle.weekStart}
                            weekEnd={bundle.weekEnd}
                            trigger={<Badge className="cursor-pointer">安排</Badge>}
                          />
                        ) : row.plan_item ? (
                          <FinanceWeekPlanItemDialog
                            members={members}
                            weekStart={bundle.weekStart}
                            weekEnd={bundle.weekEnd}
                            item={row.plan_item}
                            trigger={<Badge className="cursor-pointer">编辑</Badge>}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
