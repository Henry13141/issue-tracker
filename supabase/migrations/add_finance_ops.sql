-- 财务行政周期待办：权限能力 + 模板/实例模型

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS can_access_finance_ops BOOLEAN NOT NULL DEFAULT false;

UPDATE public.users
SET can_access_finance_ops = true
WHERE name = '李梦艳';

CREATE OR REPLACE FUNCTION public.has_finance_ops_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = auth.uid()
      AND (u.role = 'admin' OR u.can_access_finance_ops = true)
  );
$$;

CREATE TABLE IF NOT EXISTS public.finance_task_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  area TEXT NOT NULL DEFAULT 'finance'
    CHECK (area IN ('finance', 'cashier', 'admin_hr', 'other')),
  cadence TEXT NOT NULL
    CHECK (cadence IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  due_weekday INTEGER CHECK (due_weekday BETWEEN 1 AND 7),
  due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  due_month_in_quarter INTEGER CHECK (due_month_in_quarter BETWEEN 1 AND 3),
  due_month INTEGER CHECK (due_month BETWEEN 1 AND 12),
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_task_templates_due_rule_check CHECK (
    (cadence = 'weekly'    AND due_weekday IS NOT NULL AND due_month_in_quarter IS NULL AND due_month IS NULL) OR
    (cadence = 'monthly'   AND due_weekday IS NULL AND due_month_in_quarter IS NULL AND due_month IS NULL) OR
    (cadence = 'quarterly' AND due_weekday IS NULL AND due_month_in_quarter IS NOT NULL AND due_month IS NULL) OR
    (cadence = 'yearly'    AND due_weekday IS NULL AND due_month_in_quarter IS NULL AND due_month IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.finance_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.finance_task_templates(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  area TEXT NOT NULL
    CHECK (area IN ('finance', 'cashier', 'admin_hr', 'other')),
  source TEXT NOT NULL DEFAULT 'template'
    CHECK (source IN ('template', 'manual')),
  period_key TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  notes TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_task_instances_template_source_check CHECK (
    (source = 'template' AND template_id IS NOT NULL) OR
    (source = 'manual' AND template_id IS NULL)
  ),
  CONSTRAINT finance_task_instances_unique_period UNIQUE (template_id, period_key)
);

CREATE INDEX IF NOT EXISTS idx_finance_task_templates_active
  ON public.finance_task_templates (is_active, cadence, owner_user_id);

CREATE INDEX IF NOT EXISTS idx_finance_task_instances_due_date
  ON public.finance_task_instances (due_date, status);

CREATE INDEX IF NOT EXISTS idx_finance_task_instances_owner
  ON public.finance_task_instances (owner_user_id, due_date);

CREATE INDEX IF NOT EXISTS idx_finance_task_instances_period
  ON public.finance_task_instances (period_key, template_id);

DROP TRIGGER IF EXISTS finance_task_templates_updated_at ON public.finance_task_templates;
CREATE TRIGGER finance_task_templates_updated_at
  BEFORE UPDATE ON public.finance_task_templates
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS finance_task_instances_updated_at ON public.finance_task_instances;
CREATE TRIGGER finance_task_instances_updated_at
  BEFORE UPDATE ON public.finance_task_instances
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.finance_task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_task_instances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_templates'
      AND policyname = 'finance_templates_select_access'
  ) THEN
    CREATE POLICY "finance_templates_select_access"
      ON public.finance_task_templates FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_templates'
      AND policyname = 'finance_templates_insert_access'
  ) THEN
    CREATE POLICY "finance_templates_insert_access"
      ON public.finance_task_templates FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access() AND created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_templates'
      AND policyname = 'finance_templates_update_access'
  ) THEN
    CREATE POLICY "finance_templates_update_access"
      ON public.finance_task_templates FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_templates'
      AND policyname = 'finance_templates_delete_access'
  ) THEN
    CREATE POLICY "finance_templates_delete_access"
      ON public.finance_task_templates FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_instances'
      AND policyname = 'finance_instances_select_access'
  ) THEN
    CREATE POLICY "finance_instances_select_access"
      ON public.finance_task_instances FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_instances'
      AND policyname = 'finance_instances_insert_access'
  ) THEN
    CREATE POLICY "finance_instances_insert_access"
      ON public.finance_task_instances FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_instances'
      AND policyname = 'finance_instances_update_access'
  ) THEN
    CREATE POLICY "finance_instances_update_access"
      ON public.finance_task_instances FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_instances'
      AND policyname = 'finance_instances_delete_access'
  ) THEN
    CREATE POLICY "finance_instances_delete_access"
      ON public.finance_task_instances FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;
