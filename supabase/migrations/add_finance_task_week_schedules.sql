-- 财务待办周过程层：记录某个待办在每一周中的排期、工时与隐藏状态

CREATE TABLE IF NOT EXISTS public.finance_task_week_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_instance_id UUID NOT NULL REFERENCES public.finance_task_instances(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  planned_hours NUMERIC(6, 1),
  actual_hours NUMERIC(6, 1),
  arrangement_notes TEXT,
  lane INTEGER NOT NULL DEFAULT 0,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT finance_task_week_schedules_date_range_check CHECK (start_date <= end_date),
  CONSTRAINT finance_task_week_schedules_hours_check CHECK (
    (planned_hours IS NULL OR planned_hours >= 0)
    AND (actual_hours IS NULL OR actual_hours >= 0)
  ),
  CONSTRAINT finance_task_week_schedules_lane_check CHECK (lane >= 0),
  CONSTRAINT finance_task_week_schedules_unique_week UNIQUE (task_instance_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_finance_task_week_schedules_week
  ON public.finance_task_week_schedules (week_key, is_hidden, lane);

CREATE INDEX IF NOT EXISTS idx_finance_task_week_schedules_task
  ON public.finance_task_week_schedules (task_instance_id, updated_at DESC);

DROP TRIGGER IF EXISTS finance_task_week_schedules_updated_at ON public.finance_task_week_schedules;
CREATE TRIGGER finance_task_week_schedules_updated_at
  BEFORE UPDATE ON public.finance_task_week_schedules
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.finance_task_week_schedules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_week_schedules'
      AND policyname = 'finance_task_week_schedules_select_access'
  ) THEN
    CREATE POLICY "finance_task_week_schedules_select_access"
      ON public.finance_task_week_schedules FOR SELECT
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_week_schedules'
      AND policyname = 'finance_task_week_schedules_insert_access'
  ) THEN
    CREATE POLICY "finance_task_week_schedules_insert_access"
      ON public.finance_task_week_schedules FOR INSERT
      TO authenticated
      WITH CHECK (public.has_finance_ops_access() AND created_by = auth.uid());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_week_schedules'
      AND policyname = 'finance_task_week_schedules_update_access'
  ) THEN
    CREATE POLICY "finance_task_week_schedules_update_access"
      ON public.finance_task_week_schedules FOR UPDATE
      TO authenticated
      USING (public.has_finance_ops_access())
      WITH CHECK (public.has_finance_ops_access());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'finance_task_week_schedules'
      AND policyname = 'finance_task_week_schedules_delete_access'
  ) THEN
    CREATE POLICY "finance_task_week_schedules_delete_access"
      ON public.finance_task_week_schedules FOR DELETE
      TO authenticated
      USING (public.has_finance_ops_access());
  END IF;
END $$;
