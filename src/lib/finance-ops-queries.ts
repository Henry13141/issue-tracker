"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessFinanceOps } from "@/lib/permissions";
import { getFinanceOpsSchemaHint, isFinanceOpsSchemaMissingError } from "@/lib/finance-ops-schema";
import {
  buildFinanceTaskPeriod,
  formatFinancePeriodLabel,
  getFinanceTaskDisplayStatus,
  isFinanceTaskClosedStatus,
  isFinanceTaskOverdue,
  matchesFinanceOpsView,
  sortFinanceInstances,
  toDateOnly,
  type FinanceOpsView,
} from "@/lib/finance-ops";
import type { FinanceTaskInstanceWithTemplate, FinanceTaskTemplateWithOwner } from "@/types";

type TemplateSeedRow = {
  id: string;
  title: string;
  description: string | null;
  area: "finance" | "cashier" | "admin_hr" | "other";
  cadence: "weekly" | "monthly" | "quarterly" | "yearly";
  due_weekday: number | null;
  due_day: number;
  due_month_in_quarter: number | null;
  due_month: number | null;
  owner_user_id: string | null;
};

type InstanceSeedRow = {
  id: string;
  template_id: string;
  period_key: string;
  title: string;
  description: string | null;
  area: "finance" | "cashier" | "admin_hr" | "other";
  due_date: string;
  owner_user_id: string | null;
};

const financeTemplateSelect = `
  *,
  owner:users!finance_task_templates_owner_user_id_fkey(id, name, avatar_url),
  creator:users!finance_task_templates_created_by_fkey(id, name)
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

function createEmptyFinanceOpsBundle(setupMessage?: string): FinanceOpsBundle {
  return {
    templates: [],
    instances: [],
    openInstances: [],
    completedInstances: [],
    summary: {
      dueThisMonth: 0,
      dueThisQuarter: 0,
      overdue: 0,
      completedThisYear: 0,
      activeTemplates: 0,
    },
    schemaReady: !setupMessage,
    setupMessage: setupMessage ?? null,
  };
}

export async function ensureFinanceTaskInstancesForCurrentPeriod(anchorDate: Date = new Date()) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { inserted: 0, updated: 0 };
  }

  const admin = createAdminClient();
  const { data: templates, error } = await admin
    .from("finance_task_templates")
    .select("id, title, description, area, cadence, due_weekday, due_day, due_month_in_quarter, due_month, owner_user_id")
    .eq("is_active", true);

  if (error) {
    if (isFinanceOpsSchemaMissingError(error)) {
      console.warn("[finance-ops] schema missing during ensure; skip seeding current period instances");
      return { inserted: 0, updated: 0 };
    }
    throw new Error(error.message);
  }

  const activeTemplates = (templates ?? []) as TemplateSeedRow[];
  if (activeTemplates.length === 0) {
    return { inserted: 0, updated: 0 };
  }

  const periodRows = activeTemplates.map((template) => ({
    template,
    period: buildFinanceTaskPeriod(template, anchorDate),
  }));

  const templateIds = activeTemplates.map((template) => template.id);
  const periodKeys = [...new Set(periodRows.map((row) => row.period.periodKey))];

  const { data: existingRows, error: existingError } = await admin
    .from("finance_task_instances")
    .select("id, template_id, period_key, title, description, area, due_date, owner_user_id")
    .in("template_id", templateIds)
    .in("period_key", periodKeys);

  if (existingError) {
    if (isFinanceOpsSchemaMissingError(existingError)) {
      console.warn("[finance-ops] schema missing during ensure existing-row lookup; skip seeding");
      return { inserted: 0, updated: 0 };
    }
    throw new Error(existingError.message);
  }

  const existingMap = new Map(
    ((existingRows ?? []) as InstanceSeedRow[]).map((row) => [`${row.template_id}:${row.period_key}`, row])
  );

  const inserts: Array<{
    template_id: string;
    title: string;
    description: string | null;
    area: "finance" | "cashier" | "admin_hr" | "other";
    source: "template";
    period_key: string;
    period_start: string;
    period_end: string;
    due_date: string;
    owner_user_id: string | null;
  }> = [];
  const updates: Array<{
    id: string;
    title: string;
    description: string | null;
    area: "finance" | "cashier" | "admin_hr" | "other";
    due_date: string;
    owner_user_id: string | null;
  }> = [];

  for (const row of periodRows) {
    const key = `${row.template.id}:${row.period.periodKey}`;
    const existing = existingMap.get(key);

    if (!existing) {
      inserts.push({
        template_id: row.template.id,
        title: row.template.title,
        description: row.template.description,
        area: row.template.area,
        source: "template",
        period_key: row.period.periodKey,
        period_start: row.period.periodStart,
        period_end: row.period.periodEnd,
        due_date: row.period.dueDate,
        owner_user_id: row.template.owner_user_id,
      });
      continue;
    }

    if (
      existing.due_date !== row.period.dueDate ||
      existing.owner_user_id !== row.template.owner_user_id ||
      existing.title !== row.template.title ||
      existing.description !== row.template.description ||
      existing.area !== row.template.area
    ) {
      updates.push({
        id: existing.id,
        title: row.template.title,
        description: row.template.description,
        area: row.template.area,
        due_date: row.period.dueDate,
        owner_user_id: row.template.owner_user_id,
      });
    }
  }

  if (inserts.length > 0) {
    const { error: insertError } = await admin
      .from("finance_task_instances")
      .upsert(inserts, { onConflict: "template_id,period_key" });
    if (insertError) {
      if (isFinanceOpsSchemaMissingError(insertError)) {
        console.warn("[finance-ops] schema missing during ensure insert; skip seeding");
        return { inserted: 0, updated: 0 };
      }
      throw new Error(insertError.message);
    }
  }

  for (const update of updates) {
    const { error: updateError } = await admin
      .from("finance_task_instances")
      .update({
        title: update.title,
        description: update.description,
        area: update.area,
        due_date: update.due_date,
        owner_user_id: update.owner_user_id,
      })
      .eq("id", update.id);

    if (updateError) {
      if (isFinanceOpsSchemaMissingError(updateError)) {
        console.warn("[finance-ops] schema missing during ensure update; skip seeding");
        return { inserted: 0, updated: 0 };
      }
      throw new Error(updateError.message);
    }
  }

  return { inserted: inserts.length, updated: updates.length };
}

export type FinanceOpsBundle = {
  templates: FinanceTaskTemplateWithOwner[];
  instances: FinanceTaskInstanceWithTemplate[];
  openInstances: FinanceTaskInstanceWithTemplate[];
  completedInstances: FinanceTaskInstanceWithTemplate[];
  summary: {
    dueThisMonth: number;
    dueThisQuarter: number;
    overdue: number;
    completedThisYear: number;
    activeTemplates: number;
  };
  schemaReady: boolean;
  setupMessage: string | null;
};

export async function getFinanceOpsBundle(view: FinanceOpsView): Promise<FinanceOpsBundle | null> {
  const user = await getCurrentUser();
  if (!user || !canAccessFinanceOps(user)) return null;

  try {
    await ensureFinanceTaskInstancesForCurrentPeriod();
  } catch (error) {
    console.error("[finance-ops] ensure current instances failed:", error);
  }

  const supabase = await createClient();
  const [templateRes, instanceRes] = await Promise.all([
    supabase.from("finance_task_templates").select(financeTemplateSelect).order("is_active", { ascending: false }).order("created_at", { ascending: true }),
    supabase.from("finance_task_instances").select(financeInstanceSelect).order("due_date", { ascending: true }).limit(400),
  ]);

  if (templateRes.error) {
    if (isFinanceOpsSchemaMissingError(templateRes.error)) {
      return createEmptyFinanceOpsBundle(getFinanceOpsSchemaHint());
    }
    throw new Error(templateRes.error.message);
  }
  if (instanceRes.error) {
    if (isFinanceOpsSchemaMissingError(instanceRes.error)) {
      return createEmptyFinanceOpsBundle(getFinanceOpsSchemaHint());
    }
    throw new Error(instanceRes.error.message);
  }

  const today = new Date();
  const todayStr = toDateOnly(today);
  const templates = (templateRes.data ?? []) as FinanceTaskTemplateWithOwner[];
  const allInstances = ((instanceRes.data ?? []) as FinanceTaskInstanceWithTemplate[])
    .map((instance) => ({
      ...instance,
      display_status: getFinanceTaskDisplayStatus(instance, todayStr),
      is_overdue: isFinanceTaskOverdue(instance, todayStr),
      period_label: formatFinancePeriodLabel(instance),
    }))
    .sort(sortFinanceInstances);

  const instances = allInstances.filter((instance) => matchesFinanceOpsView(instance, view, today));
  const openInstances = instances.filter((instance) => !isFinanceTaskClosedStatus(instance.status));
  const completedInstances = instances.filter((instance) => isFinanceTaskClosedStatus(instance.status));

  const summary = {
    dueThisMonth: allInstances.filter(
      (instance) => matchesFinanceOpsView(instance, "month", today) && !isFinanceTaskClosedStatus(instance.status)
    ).length,
    dueThisQuarter: allInstances.filter(
      (instance) => matchesFinanceOpsView(instance, "quarter", today) && !isFinanceTaskClosedStatus(instance.status)
    ).length,
    overdue: allInstances.filter((instance) => isFinanceTaskOverdue(instance, todayStr)).length,
    completedThisYear: allInstances.filter(
      (instance) => matchesFinanceOpsView(instance, "year", today) && instance.status === "completed"
    ).length,
    activeTemplates: templates.filter((template) => template.is_active).length,
  };

  return {
    templates,
    instances,
    openInstances,
    completedInstances,
    summary,
    schemaReady: true,
    setupMessage: null,
  };
}
