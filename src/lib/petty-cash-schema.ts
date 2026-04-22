const PETTY_CASH_SCHEMA_HINT =
  "备用金登记所需数据表尚未完成初始化，请先执行最新的 petty cash migrations（`supabase/migrations/add_petty_cash_entries.sql`、`supabase/migrations/add_petty_cash_replacement_invoices.sql` 与 `supabase/migrations/add_petty_cash_custom_project.sql`）后再刷新页面。";

export function isPettyCashSchemaMissingError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

  return (
    message.includes("Could not find the table 'public.petty_cash_entries' in the schema cache") ||
    message.includes("Could not find the table 'public.petty_cash_replacement_invoices' in the schema cache") ||
    message.includes('relation "public.petty_cash_entries" does not exist') ||
    message.includes('relation "public.petty_cash_replacement_invoices" does not exist') ||
    message.includes("column petty_cash_entries.invoice_availability does not exist") ||
    message.includes("column petty_cash_entries.invoice_replacement_status does not exist") ||
    message.includes("column petty_cash_entries.invoice_collected_status does not exist") ||
    message.includes("column petty_cash_entries.reimbursement_status does not exist") ||
    message.includes("column petty_cash_entries.custom_project_label does not exist") ||
    message.includes("new row for relation \"petty_cash_entries\" violates check constraint \"petty_cash_entries_invoice_replacement_status_check\"") ||
    message.includes("new row for relation \"petty_cash_entries\" violates check constraint \"petty_cash_entries_expense_project_check\"")
  );
}

export function getPettyCashSchemaHint() {
  return PETTY_CASH_SCHEMA_HINT;
}
