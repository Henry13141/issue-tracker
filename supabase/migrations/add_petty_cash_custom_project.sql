-- 备用金：支持自定义项目类型

ALTER TABLE public.petty_cash_entries
  ADD COLUMN IF NOT EXISTS custom_project_label TEXT;

ALTER TABLE public.petty_cash_entries
  DROP CONSTRAINT IF EXISTS petty_cash_entries_expense_project_check;

ALTER TABLE public.petty_cash_entries
  ADD CONSTRAINT petty_cash_entries_expense_project_check
  CHECK (
    expense_project IN (
      'admin_procurement_invoice',
      'office_supplies_invoice',
      'employee_benefits_invoice',
      'hospitality_replacement',
      'logistics_invoice',
      'travel_mixed',
      'maintenance_mixed',
      'other',
      'custom'
    )
  );
