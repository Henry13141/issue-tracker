const FINANCE_OPS_SCHEMA_HINT =
  "财务行政待办所需数据表尚未完成升级，请先执行最新的 finance ops migrations（至少包括 `supabase/migrations/add_finance_ops.sql` 与 `supabase/migrations/add_finance_ops_ad_hoc_support.sql`）后再刷新页面。";

export function isFinanceOpsSchemaMissingError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  return (
    message.includes("Could not find the table 'public.finance_task_templates' in the schema cache") ||
    message.includes("Could not find the table 'public.finance_task_instances' in the schema cache") ||
    message.includes("column finance_task_templates.area does not exist") ||
    message.includes("column finance_task_templates.due_weekday does not exist") ||
    message.includes("column finance_task_instances.title does not exist") ||
    message.includes("column finance_task_instances.description does not exist") ||
    message.includes("column finance_task_instances.area does not exist") ||
    message.includes("column finance_task_instances.source does not exist") ||
    message.includes('relation "public.finance_task_templates" does not exist') ||
    message.includes('relation "public.finance_task_instances" does not exist')
  );
}

export function getFinanceOpsSchemaHint() {
  return FINANCE_OPS_SCHEMA_HINT;
}
