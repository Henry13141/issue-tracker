"use server";

import { getCurrentUser } from "@/lib/auth";
import {
  assignFinanceWeekLanes,
  buildFinanceWeekKey,
  formatFinancePeriodLabel,
  getFinanceTaskDisplayStatus,
  getDateDiffInDays,
  getFinanceWeekInfo,
  isFinanceTaskOverdue,
  sortFinanceInstances,
  toDateOnly,
} from "@/lib/finance-ops";
import { getFinanceOpsSchemaHint, isFinanceOpsSchemaMissingError } from "@/lib/finance-ops-schema";
import { canAccessFinanceOps } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type {
  FinanceTaskInstanceWithTemplate,
  FinanceTaskWeekScheduleWithTask,
  FinanceWeekPlanItemWithOwner,
  FinanceWeekViewRow,
} from "@/types";

const financeWeekPlanSelect = `
  *,
  owner:users!finance_week_plan_items_owner_user_id_fkey(id, name, avatar_url),
  creator:users!finance_week_plan_items_created_by_fkey(id, name)
`;

const financeInstanceSelect = `
  *,
  owner:users!finance_task_instances_owner_user_id_fkey(id, name, avatar_url),
  completed_by_user:users!finance_task_instances_completed_by_fkey(id, name),
  template:finance_task_templates(
    *,
    owner:users!finance_task_templates_owner_user_id_fkey(id, name, avatar_url),
    creator:users!finance_task_templates_created_by_fkey(id, name)
  )
`;

const financeTaskWeekScheduleSelect = `
  *,
  creator:users!finance_task_week_schedules_created_by_fkey(id, name),
  task:finance_task_instances!finance_task_week_schedules_task_instance_id_fkey(
    *,
    owner:users!finance_task_instances_owner_user_id_fkey(id, name, avatar_url),
    completed_by_user:users!finance_task_instances_completed_by_fkey(id, name),
    template:finance_task_templates(
      *,
      owner:users!finance_task_templates_owner_user_id_fkey(id, name, avatar_url),
      creator:users!finance_task_templates_created_by_fkey(id, name)
    )
  )
`;

export type FinanceWeekPlanBundle = {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  summary: {
    total: number;
    taskCount: number;
    multiDay: number;
    adHoc: number;
    completed: number;
    inProgress: number;
    plannedHours: number;
    actualHours: number;
    overlapCount: number;
  };
  rows: FinanceWeekViewRow[];
  schemaReady: boolean;
  setupMessage: string | null;
};

function createEmptyFinanceWeekPlanBundle(anchorDate: Date, setupMessage?: string): FinanceWeekPlanBundle {
  const weekInfo = getFinanceWeekInfo(anchorDate);

  return {
    weekKey: weekInfo.weekKey,
    weekStart: weekInfo.weekStart,
    weekEnd: weekInfo.weekEnd,
    summary: {
      total: 0,
      taskCount: 0,
      multiDay: 0,
      adHoc: 0,
      completed: 0,
      inProgress: 0,
      plannedHours: 0,
      actualHours: 0,
      overlapCount: 0,
    },
    rows: [],
    schemaReady: !setupMessage,
    setupMessage: setupMessage ?? null,
  };
}

function enrichInstances(instances: FinanceTaskInstanceWithTemplate[]) {
  const today = toDateOnly(new Date());
  return instances
    .map((instance) => ({
      ...instance,
      display_status: getFinanceTaskDisplayStatus(instance, today),
      is_overdue: isFinanceTaskOverdue(instance, today),
      period_label: formatFinancePeriodLabel(instance),
    }))
    .sort(sortFinanceInstances);
}

function toHours(value: number | null | undefined) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function getFinanceWeekPlanBundle(anchorDate: Date = new Date()): Promise<FinanceWeekPlanBundle | null> {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) return null;

  const weekInfo = getFinanceWeekInfo(anchorDate);
  const supabase = await createClient();
  const [planRes, taskRes, scheduleRes] = await Promise.all([
    supabase
      .from("finance_week_plan_items")
      .select(financeWeekPlanSelect)
      .eq("week_key", buildFinanceWeekKey(anchorDate))
      .order("sort_order", { ascending: true })
      .order("start_date", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("finance_task_instances")
      .select(financeInstanceSelect)
      .gte("due_date", weekInfo.weekStart)
      .lte("due_date", weekInfo.weekEnd)
      .order("due_date", { ascending: true })
      .limit(400),
    supabase
      .from("finance_task_week_schedules")
      .select(financeTaskWeekScheduleSelect)
      .eq("week_key", weekInfo.weekKey)
      .order("lane", { ascending: true })
      .order("start_date", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  if (planRes.error || taskRes.error || scheduleRes.error) {
    const firstError = planRes.error ?? taskRes.error ?? scheduleRes.error;
    if (firstError && isFinanceOpsSchemaMissingError(firstError)) {
      return createEmptyFinanceWeekPlanBundle(anchorDate, getFinanceOpsSchemaHint());
    }
    throw new Error(firstError?.message ?? "加载周工作计划失败");
  }

  const items = ((planRes.data ?? []) as FinanceWeekPlanItemWithOwner[]).sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
    return a.title.localeCompare(b.title, "zh-CN");
  });
  const dueTasks = enrichInstances((taskRes.data ?? []) as FinanceTaskInstanceWithTemplate[]);
  const schedules = (scheduleRes.data ?? []) as FinanceTaskWeekScheduleWithTask[];
  const scheduleMap = new Map(schedules.map((schedule) => [schedule.task_instance_id, schedule]));
  const tasksById = new Map<string, FinanceTaskInstanceWithTemplate>();

  for (const task of dueTasks) {
    tasksById.set(task.id, task);
  }
  for (const schedule of schedules) {
    if (schedule.task) {
      const [enriched] = enrichInstances([schedule.task as FinanceTaskInstanceWithTemplate]);
      tasksById.set(enriched.id, enriched);
    }
  }

  const taskRows: FinanceWeekViewRow[] = [];
  for (const task of tasksById.values()) {
    const schedule = scheduleMap.get(task.id);
    if (schedule?.is_hidden) continue;
    const startDate = schedule?.start_date ?? task.due_date;
    const endDate = schedule?.end_date ?? task.due_date;
    taskRows.push({
      id: `task:${task.id}`,
      kind: "task",
      source: "task",
      title: task.title ?? task.template?.title ?? "未命名事项",
      description: task.description ?? task.template?.description ?? null,
      area: task.area,
      start_date: startDate,
      end_date: endDate,
      owner_user_id: task.owner_user_id,
      status: task.status,
      notes: schedule?.arrangement_notes ?? null,
      planned_hours: toHours(schedule?.planned_hours),
      actual_hours: toHours(schedule?.actual_hours),
      lane: schedule?.lane ?? 0,
      is_hidden: false,
      sort_order: 0,
      owner: task.owner ?? null,
      creator: schedule?.creator ?? null,
      task_instance_id: task.id,
      task,
      schedule: schedule ?? null,
      plan_item: null,
      due_date: task.due_date,
      is_auto_generated: !schedule,
    });
  }

  const planRows: FinanceWeekViewRow[] = items.map((item) => ({
    id: `plan:${item.id}`,
    kind: "plan",
    source: item.source,
    title: item.title,
    description: item.description,
    area: item.area,
    start_date: item.start_date,
    end_date: item.end_date,
    owner_user_id: item.owner_user_id,
    status: item.status,
    notes: item.notes,
    planned_hours: null,
    actual_hours: null,
    lane: 0,
    is_hidden: false,
    sort_order: item.sort_order,
    owner: item.owner ?? null,
    creator: item.creator ?? null,
    task_instance_id: null,
    task: null,
    schedule: null,
    plan_item: item,
    due_date: null,
    is_auto_generated: false,
  }));

  const rows = [...taskRows, ...planRows].sort((a, b) => {
    const ownerA = a.owner?.name ?? "";
    const ownerB = b.owner?.name ?? "";
    if (ownerA !== ownerB) return ownerA.localeCompare(ownerB, "zh-CN");
    if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
    if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
    if (a.kind !== b.kind) return a.kind === "task" ? -1 : 1;
    return a.title.localeCompare(b.title, "zh-CN");
  });
  const laneMap = assignFinanceWeekLanes(rows);
  const rowsWithLanes = rows.map((row) => ({
    ...row,
    lane: laneMap.get(row.id) ?? row.lane ?? 0,
  }));

  return {
    weekKey: weekInfo.weekKey,
    weekStart: weekInfo.weekStart,
    weekEnd: weekInfo.weekEnd,
    summary: {
      total: rowsWithLanes.length,
      taskCount: taskRows.length,
      multiDay: rowsWithLanes.filter((row) => getDateDiffInDays(row.start_date, row.end_date) > 0).length,
      adHoc: planRows.filter((row) => row.source === "ad_hoc").length,
      completed: rowsWithLanes.filter((row) => row.status === "completed").length,
      inProgress: rowsWithLanes.filter((row) => row.status === "in_progress").length,
      plannedHours: rowsWithLanes.reduce((sum, row) => sum + (row.planned_hours ?? 0), 0),
      actualHours: rowsWithLanes.reduce((sum, row) => sum + (row.actual_hours ?? 0), 0),
      overlapCount: rowsWithLanes.filter((row) => row.lane > 0).length,
    },
    rows: rowsWithLanes,
    schemaReady: true,
    setupMessage: null,
  };
}
