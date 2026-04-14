"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureFinanceTaskInstancesForCurrentPeriod } from "@/lib/finance-ops-queries";
import {
  buildFinanceWeekKey,
  getFinanceWeekInfo,
  getFinanceWeekStartsBetween,
  getRangeIntersection,
  parseDateOnly,
  shiftDateOnly,
} from "@/lib/finance-ops";
import { getFinanceOpsSchemaHint, isFinanceOpsSchemaMissingError } from "@/lib/finance-ops-schema";
import { canAccessFinanceOps } from "@/lib/permissions";
import type {
  FinanceTaskArea,
  FinanceTaskCadence,
  FinanceTaskInstanceStatus,
  FinanceTaskWeekSchedule,
  FinanceWeekPlanItemSource,
  FinanceWeekPlanItemStatus,
} from "@/types";

type FinanceTaskTemplateInput = {
  title: string;
  description?: string | null;
  area: FinanceTaskArea;
  cadence: FinanceTaskCadence;
  due_weekday?: number | null;
  due_day: number;
  due_month_in_quarter?: number | null;
  due_month?: number | null;
  owner_user_id?: string | null;
  is_active?: boolean;
};

type FinanceTaskAdHocInput = {
  title: string;
  description?: string | null;
  area: FinanceTaskArea;
  due_date: string;
  owner_user_id?: string | null;
  notes?: string | null;
};

type FinanceTaskInstanceUpdateInput = {
  status: FinanceTaskInstanceStatus;
  notes?: string | null;
};

type FinanceWeekPlanItemInput = {
  title: string;
  description?: string | null;
  area: FinanceTaskArea;
  source: FinanceWeekPlanItemSource;
  start_date: string;
  duration_days: number;
  owner_user_id?: string | null;
  status?: FinanceWeekPlanItemStatus;
  notes?: string | null;
  sort_order?: number;
};

type FinanceWeekPlanItemUpdateInput = FinanceWeekPlanItemInput;

type FinanceTaskWeekScheduleInput = {
  week_start: string;
  start_date: string;
  end_date: string;
  planned_hours?: number | null;
  actual_hours?: number | null;
  arrangement_notes?: string | null;
  is_hidden?: boolean;
};

function normalizeArea(area: FinanceTaskArea) {
  if (area === "finance" || area === "cashier" || area === "admin_hr" || area === "other") {
    return area;
  }
  throw new Error("事项归类无效");
}

function normalizeTemplateInput(input: FinanceTaskTemplateInput) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("请先填写事项名称");
  }

  let dueWeekday: number | null = null;
  let dueDay = 1;

  let dueMonthInQuarter: number | null = null;
  let dueMonth: number | null = null;

  if (input.cadence === "weekly") {
    const weekday = Number(input.due_weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new Error("周任务需要指定星期几");
    }
    dueWeekday = weekday;
  } else {
    dueDay = Number(input.due_day);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      throw new Error("日期规则里的日必须在 1 到 31 之间");
    }
  }

  if (input.cadence === "quarterly") {
    const monthInQuarter = Number(input.due_month_in_quarter);
    if (!Number.isInteger(monthInQuarter) || monthInQuarter < 1 || monthInQuarter > 3) {
      throw new Error("季度任务需要指定季度中的第几个月");
    }
    dueMonthInQuarter = monthInQuarter;
  }

  if (input.cadence === "yearly") {
    const month = Number(input.due_month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error("年度任务需要指定月份");
    }
    dueMonth = month;
  }

  return {
    title,
    description: input.description?.trim() || null,
    area: normalizeArea(input.area),
    cadence: input.cadence,
    due_weekday: dueWeekday,
    due_day: dueDay,
    due_month_in_quarter: dueMonthInQuarter,
    due_month: dueMonth,
    owner_user_id: input.owner_user_id || null,
    is_active: input.is_active ?? true,
  };
}

async function requireFinanceOpsUser() {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) {
    throw new Error("无权限操作财务行政待办");
  }
  return user;
}

function rethrowFinanceOpsError(error: { message: string }) {
  if (isFinanceOpsSchemaMissingError(error)) {
    throw new Error(getFinanceOpsSchemaHint());
  }
  throw new Error(error.message);
}

function normalizeAdHocInput(input: FinanceTaskAdHocInput) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("请先填写待办名称");
  }

  const dueDate = input.due_date?.trim();
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new Error("请填写有效的截止日期");
  }

  return {
    title,
    description: input.description?.trim() || null,
    area: normalizeArea(input.area),
    due_date: dueDate,
    owner_user_id: input.owner_user_id || null,
    notes: input.notes?.trim() || null,
  };
}

function normalizeWeekPlanStatus(status: FinanceWeekPlanItemStatus | undefined) {
  if (!status) return "pending";
  if (status === "pending" || status === "in_progress" || status === "completed" || status === "skipped") {
    return status;
  }
  throw new Error("事项状态无效");
}

function normalizeWeekPlanSource(source: FinanceWeekPlanItemSource) {
  if (source === "weekly_plan" || source === "ad_hoc") {
    return source;
  }
  throw new Error("事项来源无效");
}

function normalizeWeekPlanItemInput(input: FinanceWeekPlanItemInput) {
  const title = input.title.trim();
  if (!title) {
    throw new Error("请先填写事项名称");
  }

  const startDate = input.start_date?.trim();
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("请填写有效的开始日期");
  }

  const durationDays = Number(input.duration_days);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 7) {
    throw new Error("持续天数必须在 1 到 7 天之间");
  }

  const anchorDate = parseDateOnly(startDate);
  const weekInfo = getFinanceWeekInfo(anchorDate);
  if (weekInfo.weekStart !== startDate && startDate < weekInfo.weekStart) {
    throw new Error("开始日期必须落在某一周内");
  }

  const endDate = shiftDateOnly(startDate, durationDays - 1);
  if (endDate > weekInfo.weekEnd) {
    throw new Error("第一版周计划暂不支持跨周，请调整开始日期或持续天数");
  }

  return {
    week_key: buildFinanceWeekKey(anchorDate),
    title,
    description: input.description?.trim() || null,
    area: normalizeArea(input.area),
    source: normalizeWeekPlanSource(input.source),
    start_date: startDate,
    end_date: endDate,
    owner_user_id: input.owner_user_id || null,
    status: normalizeWeekPlanStatus(input.status),
    notes: input.notes?.trim() || null,
    sort_order: Number.isInteger(input.sort_order) ? Number(input.sort_order) : 0,
  };
}

function normalizeOptionalHours(value: number | string | null | undefined, label: string) {
  if (value == null || value === "") return null;
  const hours = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(hours) || hours < 0) {
    throw new Error(`${label}必须是大于等于 0 的数字`);
  }
  return Math.round(hours * 10) / 10;
}

function normalizeTaskWeekScheduleInput(input: FinanceTaskWeekScheduleInput) {
  const weekStart = input.week_start?.trim();
  const startDate = input.start_date?.trim();
  const endDate = input.end_date?.trim();
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new Error("请提供当前周的开始日期");
  }
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    throw new Error("请填写有效的开始日期");
  }
  if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("请填写有效的结束日期");
  }
  if (startDate > endDate) {
    throw new Error("结束日期不能早于开始日期");
  }

  const anchorWeek = getFinanceWeekInfo(parseDateOnly(weekStart));
  if (endDate < anchorWeek.weekStart || startDate > anchorWeek.weekEnd) {
    throw new Error("当前编辑的过程安排至少需要覆盖本周中的一天");
  }

  return {
    weekStart: anchorWeek.weekStart,
    weekKey: anchorWeek.weekKey,
    startDate,
    endDate,
    plannedHours: normalizeOptionalHours(input.planned_hours, "计划工时"),
    actualHours: normalizeOptionalHours(input.actual_hours, "实际工时"),
    arrangementNotes: input.arrangement_notes?.trim() || null,
    isHidden: Boolean(input.is_hidden),
  };
}

export async function createFinanceTaskTemplate(input: FinanceTaskTemplateInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeTemplateInput(input);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("finance_task_templates")
    .insert({
      ...payload,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    rethrowFinanceOpsError(error);
  }

  try {
    await ensureFinanceTaskInstancesForCurrentPeriod();
  } catch (ensureError) {
    console.error("[finance-ops] create template ensure failed:", ensureError);
  }

  revalidatePath("/finance-ops");
  return (data as { id: string }).id;
}

export async function updateFinanceTaskTemplate(id: string, input: FinanceTaskTemplateInput) {
  await requireFinanceOpsUser();
  const payload = normalizeTemplateInput(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_task_templates")
    .update(payload)
    .eq("id", id);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  try {
    await ensureFinanceTaskInstancesForCurrentPeriod();
  } catch (ensureError) {
    console.error("[finance-ops] update template ensure failed:", ensureError);
  }

  revalidatePath("/finance-ops");
}

export async function createFinanceTaskAdHocInstance(input: FinanceTaskAdHocInput) {
  await requireFinanceOpsUser();
  const payload = normalizeAdHocInput(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_task_instances")
    .insert({
      template_id: null,
      title: payload.title,
      description: payload.description,
      area: payload.area,
      source: "manual",
      period_key: `manual-${payload.due_date}-${Date.now()}`,
      period_start: payload.due_date,
      period_end: payload.due_date,
      due_date: payload.due_date,
      owner_user_id: payload.owner_user_id,
      status: "pending",
      notes: payload.notes,
      completed_at: null,
      completed_by: null,
    });

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function setFinanceTaskTemplateActive(id: string, isActive: boolean) {
  await requireFinanceOpsUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_task_templates")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function updateFinanceTaskInstance(id: string, input: FinanceTaskInstanceUpdateInput) {
  const user = await requireFinanceOpsUser();
  const supabase = await createClient();
  const notes = input.notes?.trim() || null;

  const patch: {
    status: FinanceTaskInstanceStatus;
    notes: string | null;
    completed_at?: string | null;
    completed_by?: string | null;
  } = {
    status: input.status,
    notes,
  };

  if (input.status === "completed") {
    patch.completed_at = new Date().toISOString();
    patch.completed_by = user.id;
  } else {
    patch.completed_at = null;
    patch.completed_by = null;
  }

  const { error } = await supabase
    .from("finance_task_instances")
    .update(patch)
    .eq("id", id);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function createFinanceWeekPlanItem(input: FinanceWeekPlanItemInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeWeekPlanItemInput(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_week_plan_items")
    .insert({
      ...payload,
      created_by: user.id,
    });

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function updateFinanceWeekPlanItem(id: string, input: FinanceWeekPlanItemUpdateInput) {
  await requireFinanceOpsUser();
  const payload = normalizeWeekPlanItemInput(input);
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_week_plan_items")
    .update(payload)
    .eq("id", id);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function deleteFinanceWeekPlanItem(id: string) {
  await requireFinanceOpsUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_week_plan_items")
    .delete()
    .eq("id", id);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function upsertFinanceTaskWeekSchedule(taskInstanceId: string, input: FinanceTaskWeekScheduleInput) {
  const user = await requireFinanceOpsUser();
  const payload = normalizeTaskWeekScheduleInput(input);
  const supabase = await createClient();

  const { data: existingRows, error: existingError } = await supabase
    .from("finance_task_week_schedules")
    .select("*")
    .eq("task_instance_id", taskInstanceId);

  if (existingError) {
    rethrowFinanceOpsError(existingError);
  }

  const existingMap = new Map(
    ((existingRows ?? []) as FinanceTaskWeekSchedule[]).map((row) => [row.week_key, row])
  );

  if ((existingRows ?? []).length > 0) {
    const { error: deleteError } = await supabase
      .from("finance_task_week_schedules")
      .delete()
      .eq("task_instance_id", taskInstanceId);
    if (deleteError) {
      rethrowFinanceOpsError(deleteError);
    }
  }

  const rows = getFinanceWeekStartsBetween(payload.startDate, payload.endDate)
    .map((weekStart) => {
      const weekInfo = getFinanceWeekInfo(parseDateOnly(weekStart));
      const intersection = getRangeIntersection(
        payload.startDate,
        payload.endDate,
        weekInfo.weekStart,
        weekInfo.weekEnd
      );
      if (!intersection) return null;
      const previous = existingMap.get(weekInfo.weekKey);
      const isAnchorWeek = weekInfo.weekKey === payload.weekKey;

      return {
        task_instance_id: taskInstanceId,
        week_key: weekInfo.weekKey,
        start_date: intersection.startDate,
        end_date: intersection.endDate,
        planned_hours: isAnchorWeek ? payload.plannedHours : previous?.planned_hours ?? null,
        actual_hours: isAnchorWeek ? payload.actualHours : previous?.actual_hours ?? null,
        arrangement_notes: isAnchorWeek ? payload.arrangementNotes : previous?.arrangement_notes ?? null,
        lane: previous?.lane ?? 0,
        is_hidden: isAnchorWeek ? payload.isHidden : previous?.is_hidden ?? false,
        created_by: previous?.created_by ?? user.id,
      };
    })
    .filter(Boolean);

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("finance_task_week_schedules").insert(rows);
    if (insertError) {
      rethrowFinanceOpsError(insertError);
    }
  }

  revalidatePath("/finance-ops");
}

export async function resetFinanceTaskWeekSchedule(taskInstanceId: string) {
  await requireFinanceOpsUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("finance_task_week_schedules")
    .delete()
    .eq("task_instance_id", taskInstanceId);

  if (error) {
    rethrowFinanceOpsError(error);
  }

  revalidatePath("/finance-ops");
}

export async function toggleFinanceTaskWeekHidden(taskInstanceId: string, weekStart: string, isHidden: boolean) {
  const user = await requireFinanceOpsUser();
  const supabase = await createClient();
  const weekInfo = getFinanceWeekInfo(parseDateOnly(weekStart));
  const { data: existingRow, error: rowError } = await supabase
    .from("finance_task_week_schedules")
    .select("id")
    .eq("task_instance_id", taskInstanceId)
    .eq("week_key", weekInfo.weekKey)
    .maybeSingle();

  if (rowError) {
    rethrowFinanceOpsError(rowError);
  }

  if (existingRow) {
    const { error: updateError } = await supabase
      .from("finance_task_week_schedules")
      .update({ is_hidden: isHidden })
      .eq("id", (existingRow as { id: string }).id);
    if (updateError) {
      rethrowFinanceOpsError(updateError);
    }
    revalidatePath("/finance-ops");
    return;
  }

  if (!isHidden) {
    revalidatePath("/finance-ops");
    return;
  }

  const { data: instance, error: instanceError } = await supabase
    .from("finance_task_instances")
    .select("due_date")
    .eq("id", taskInstanceId)
    .single();
  if (instanceError) {
    rethrowFinanceOpsError(instanceError);
  }

  const dueDate = (instance as { due_date: string }).due_date;
  const startDate = dueDate < weekInfo.weekStart ? weekInfo.weekStart : dueDate > weekInfo.weekEnd ? weekInfo.weekEnd : dueDate;
  const { error: insertError } = await supabase.from("finance_task_week_schedules").insert({
    task_instance_id: taskInstanceId,
    week_key: weekInfo.weekKey,
    start_date: startDate,
    end_date: startDate,
    planned_hours: null,
    actual_hours: null,
    arrangement_notes: null,
    lane: 0,
    is_hidden: true,
    created_by: user.id,
  });
  if (insertError) {
    rethrowFinanceOpsError(insertError);
  }

  revalidatePath("/finance-ops");
}
