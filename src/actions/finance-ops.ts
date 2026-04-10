"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { ensureFinanceTaskInstancesForCurrentPeriod } from "@/lib/finance-ops-queries";
import { getFinanceOpsSchemaHint, isFinanceOpsSchemaMissingError } from "@/lib/finance-ops-schema";
import { canAccessFinanceOps } from "@/lib/permissions";
import type { FinanceTaskArea, FinanceTaskCadence, FinanceTaskInstanceStatus } from "@/types";

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
