"use client";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinanceTaskWeekScheduleDialog } from "@/components/finance-task-week-schedule-dialog";
import { FinanceWeekPlanItemDialog } from "@/components/finance-week-plan-item-dialog";
import {
  FINANCE_TASK_AREA_LABELS,
  FINANCE_WEEK_PLAN_STATUS_LABELS,
  formatFinanceDateShort,
  getFinanceWeekDays,
  getFinanceWeekPlanSpan,
} from "@/lib/finance-ops";
import { cn } from "@/lib/utils";
import type { FinanceWeekViewRow, User } from "@/types";
import { Pencil } from "lucide-react";

function getStatusClassName(row: FinanceWeekViewRow) {
  if (row.kind === "task") {
    if (row.status === "completed") {
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    }
    if (row.status === "in_progress") {
      return "border-blue-200 bg-blue-100 text-blue-800";
    }
    if (row.status === "skipped") {
      return "border-slate-200 bg-slate-100 text-slate-600";
    }
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  const source = row.source;
  if (row.status === "completed") {
    return "border-emerald-200 bg-emerald-100 text-emerald-800";
  }
  if (row.status === "in_progress") {
    return "border-blue-200 bg-blue-100 text-blue-800";
  }
  if (row.status === "skipped") {
    return "border-slate-200 bg-slate-100 text-slate-600";
  }
  return source === "ad_hoc"
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : "border-violet-200 bg-violet-100 text-violet-800";
}

export function FinanceWeekPlanGrid({
  rows,
  members,
  weekStart,
  weekEnd,
  selectedRowId,
  onSelectRow,
}: {
  rows: FinanceWeekViewRow[];
  members: User[];
  weekStart: string;
  weekEnd: string;
  selectedRowId?: string | null;
  onSelectRow: (rowId: string) => void;
}) {
  const weekDays = getFinanceWeekDays(new Date(`${weekStart}T12:00:00+08:00`));
  const lanes = [...new Set(rows.map((row) => row.lane))].sort((a, b) => a - b);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">本周视图</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        <div className="min-w-[980px] overflow-hidden rounded-2xl border border-border/50 bg-background">
          <div className="grid grid-cols-7 gap-0 bg-muted/20">
            {weekDays.map((day) => (
              <div
                key={day.date}
                className="border-l border-border/40 px-3 py-3 text-center first:border-l-0"
              >
                <p className="text-sm font-medium">{day.weekday}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatFinanceDateShort(day.date)}</p>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="border-t border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              当前周暂无事项，系统自动带入的待办或新增的临时事项都会显示在这里。
            </div>
          ) : (
            <div className="border-t border-border/50">
              {lanes.map((lane, laneIndex) => {
                const laneRows = rows
                  .filter((row) => row.lane === lane)
                  .sort((a, b) => a.start_date.localeCompare(b.start_date));
                return (
                  <div
                    key={lane}
                    className={cn(
                      "grid min-h-[128px] grid-cols-7 gap-0",
                      laneIndex === 0 ? "" : "border-t-2 border-border/60"
                    )}
                  >
                    <div
                      className="pointer-events-none col-span-7 grid grid-cols-7 gap-0 items-start px-2 py-3"
                      aria-hidden="true"
                    >
                      {laneRows.map((row) => {
                        const span = getFinanceWeekPlanSpan(row, weekStart, weekEnd);
                        const statusClassName = getStatusClassName(row);
                        return (
                          <div
                            key={row.id}
                            className={cn(
                              "pointer-events-auto relative self-start min-h-[112px] rounded-lg border px-3 py-3 text-left",
                              row.source === "ad_hoc" ? "border-dashed" : undefined,
                              selectedRowId === row.id ? "ring-2 ring-primary/30" : undefined,
                              statusClassName
                            )}
                            style={{ gridColumn: `${span.startColumn} / ${span.endColumn + 1}` }}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectRow(row.id)}
                              className="flex min-h-[106px] w-full min-w-0 flex-col pr-8 text-left"
                            >
                              <div className="text-[15px] font-semibold leading-6 break-words">
                                {row.title}
                              </div>
                              <div className="mt-auto pt-4 text-[10px] leading-4 opacity-90">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="rounded-full bg-background/35 px-1.5 py-0.5">
                                    {FINANCE_TASK_AREA_LABELS[row.area]}
                                  </span>
                                  <span className="rounded-full bg-background/35 px-1.5 py-0.5">
                                    {FINANCE_WEEK_PLAN_STATUS_LABELS[row.status]}
                                  </span>
                                </div>
                              </div>
                            </button>
                            {row.kind === "task" ? (
                              <FinanceTaskWeekScheduleDialog
                                row={row}
                                weekStart={weekStart}
                                weekEnd={weekEnd}
                                trigger={
                                  <span
                                    className={cn(
                                      buttonVariants({ variant: "ghost", size: "icon" }),
                                      "absolute right-2 top-2 h-6 w-6 rounded-full p-0 opacity-80 hover:opacity-100"
                                    )}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </span>
                                }
                              />
                            ) : row.plan_item ? (
                              <FinanceWeekPlanItemDialog
                                members={members}
                                weekStart={weekStart}
                                weekEnd={weekEnd}
                                item={row.plan_item}
                                trigger={
                                  <span
                                    className={cn(
                                      buttonVariants({ variant: "ghost", size: "icon" }),
                                      "absolute right-2 top-2 h-6 w-6 rounded-full p-0 opacity-80 hover:opacity-100"
                                    )}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </span>
                                }
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
