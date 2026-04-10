-- 为已存在的 finance_ops 表结构补齐“行政人事归类 + 临时待办”支持

ALTER TABLE public.finance_task_templates
  ADD COLUMN IF NOT EXISTS area TEXT;

UPDATE public.finance_task_templates
SET area = 'finance'
WHERE area IS NULL;

ALTER TABLE public.finance_task_templates
  ALTER COLUMN area SET DEFAULT 'finance';

ALTER TABLE public.finance_task_templates
  ALTER COLUMN area SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_task_templates_area_check'
      AND conrelid = 'public.finance_task_templates'::regclass
  ) THEN
    ALTER TABLE public.finance_task_templates
      ADD CONSTRAINT finance_task_templates_area_check
      CHECK (area IN ('finance', 'cashier', 'admin_hr', 'other'));
  END IF;
END $$;

ALTER TABLE public.finance_task_instances
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE public.finance_task_instances
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.finance_task_instances
  ADD COLUMN IF NOT EXISTS area TEXT;

ALTER TABLE public.finance_task_instances
  ADD COLUMN IF NOT EXISTS source TEXT;

UPDATE public.finance_task_instances AS inst
SET
  title = COALESCE(inst.title, tpl.title, '未命名待办'),
  description = COALESCE(inst.description, tpl.description),
  area = COALESCE(inst.area, tpl.area, 'finance'),
  source = COALESCE(inst.source, 'template')
FROM public.finance_task_templates AS tpl
WHERE inst.template_id = tpl.id;

UPDATE public.finance_task_instances
SET
  title = COALESCE(title, '临时待办'),
  area = COALESCE(area, 'other'),
  source = COALESCE(source, CASE WHEN template_id IS NULL THEN 'manual' ELSE 'template' END)
WHERE title IS NULL OR area IS NULL OR source IS NULL;

ALTER TABLE public.finance_task_instances
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.finance_task_instances
  ALTER COLUMN title SET NOT NULL;

ALTER TABLE public.finance_task_instances
  ALTER COLUMN area SET NOT NULL;

ALTER TABLE public.finance_task_instances
  ALTER COLUMN source SET DEFAULT 'template';

ALTER TABLE public.finance_task_instances
  ALTER COLUMN source SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_task_instances_area_check'
      AND conrelid = 'public.finance_task_instances'::regclass
  ) THEN
    ALTER TABLE public.finance_task_instances
      ADD CONSTRAINT finance_task_instances_area_check
      CHECK (area IN ('finance', 'cashier', 'admin_hr', 'other'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_task_instances_source_check'
      AND conrelid = 'public.finance_task_instances'::regclass
  ) THEN
    ALTER TABLE public.finance_task_instances
      ADD CONSTRAINT finance_task_instances_source_check
      CHECK (source IN ('template', 'manual'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'finance_task_instances_template_source_check'
      AND conrelid = 'public.finance_task_instances'::regclass
  ) THEN
    ALTER TABLE public.finance_task_instances
      ADD CONSTRAINT finance_task_instances_template_source_check
      CHECK (
        (source = 'template' AND template_id IS NOT NULL) OR
        (source = 'manual' AND template_id IS NULL)
      );
  END IF;
END $$;
