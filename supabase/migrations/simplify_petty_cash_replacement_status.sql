-- 备用金：替票状态仅保留「无需替票 / 待替票」，去掉「替票中 / 已替票」

UPDATE public.petty_cash_entries
SET invoice_replacement_status = CASE invoice_replacement_status
  WHEN 'in_progress' THEN 'pending'
  WHEN 'completed' THEN 'not_needed'
  ELSE invoice_replacement_status
END
WHERE invoice_replacement_status IN ('in_progress', 'completed');

ALTER TABLE public.petty_cash_entries
  DROP CONSTRAINT IF EXISTS petty_cash_entries_invoice_replacement_status_check;

ALTER TABLE public.petty_cash_entries
  ADD CONSTRAINT petty_cash_entries_invoice_replacement_status_check
  CHECK (invoice_replacement_status IN ('not_needed', 'pending'));
