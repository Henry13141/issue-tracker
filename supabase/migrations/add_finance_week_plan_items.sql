-- 新增财务/行政周工作计划事项表

CREATE TABLE IF NOT EXISTS public.finance_week_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  area TEXT NOT NULL DEFAULT 'finance'
    CHECK (area IN ('finance', 'cashier', 'admin_hr', 'other')),
  source TEXT NOT NULL DEFAULT 'weekly_plan'
    CHECK (source IN ('weekly_plan', 'ad_hoc')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  owner_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_week_plan_items_date_range_check CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_finance_week_plan_items_week
  ON public.finance_week_plan_items (week_key, start_date, sort_order);

CREATE INDEX IF NOT EXISTS idx_finance_week_plan_items_owner
  ON public.finance_week_plan_items (owner_user_id, week_key);

DROP TRIGGER IF EXISTS finance_week_plan_items_updated_at ON public.finance_week_plan_items;
CREATE TRIGGER finance_week_plan_items_updated_at
  BEFORE UPDATE ON public.finance_week_plan_items
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.finance_week_plan_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_week_plan_items'
      AND policyname = 'finance_week_plan_items_select_access'
  ) THEN
    CREATE POLICY "finance_week_plan_items_select_access"
      ON public.finance_week_plan_items FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_week_plan_items'
      AND policyname = 'finance_week_plan_items_insert_access'
  ) THEN
    CREATE POLICY "finance_week_plan_items_insert_access"
      ON public.finance_week_plan_items FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access() AND created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_week_plan_items'
      AND policyname = 'finance_week_plan_items_update_access'
  ) THEN
    CREATE POLICY "finance_week_plan_items_update_access"
      ON public.finance_week_plan_items FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_week_plan_items'
      AND policyname = 'finance_week_plan_items_delete_access'
  ) THEN
    CREATE POLICY "finance_week_plan_items_delete_access"
      ON public.finance_week_plan_items FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;
