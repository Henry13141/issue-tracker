-- 为财务行政待办补齐 weekly 周任务支持

ALTER TABLE public.finance_task_templates
  ADD COLUMN IF NOT EXISTS due_weekday INTEGER;

UPDATE public.finance_task_templates
SET due_weekday = 1
WHERE cadence = 'weekly'
  AND due_weekday IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_task_templates_due_weekday_check'
      AND conrelid = 'public.finance_task_templates'::regclass
  ) THEN
    ALTER TABLE public.finance_task_templates
      ADD CONSTRAINT finance_task_templates_due_weekday_check
      CHECK (due_weekday BETWEEN 1 AND 7);
  END IF;
END $$;

ALTER TABLE public.finance_task_templates
  DROP CONSTRAINT IF EXISTS finance_task_templates_due_rule_check;

ALTER TABLE public.finance_task_templates
  ADD CONSTRAINT finance_task_templates_due_rule_check
  CHECK (
    (cadence = 'weekly'    AND due_weekday IS NOT NULL AND due_month_in_quarter IS NULL AND due_month IS NULL) OR
    (cadence = 'monthly'   AND due_weekday IS NULL AND due_month_in_quarter IS NULL AND due_month IS NULL) OR
    (cadence = 'quarterly' AND due_weekday IS NULL AND due_month_in_quarter IS NOT NULL AND due_month IS NULL) OR
    (cadence = 'yearly'    AND due_weekday IS NULL AND due_month_in_quarter IS NULL AND due_month IS NOT NULL)
  );

ALTER TABLE public.finance_task_templates
  DROP CONSTRAINT IF EXISTS finance_task_templates_cadence_check;

ALTER TABLE public.finance_task_templates
  ADD CONSTRAINT finance_task_templates_cadence_check
  CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly'));
