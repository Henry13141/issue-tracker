-- Seedance：全站共享「任务 → 提交时提示词」快照（替代仅本机 localStorage）
-- 在 Supabase SQL Editor 执行本文件或并入迁移流程。

CREATE TABLE IF NOT EXISTS public.seedance_task_prompts (
  task_id     TEXT        PRIMARY KEY,
  prompt_text TEXT        NOT NULL DEFAULT '',
  created_by  UUID        REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seedance_task_prompts_created_at
  ON public.seedance_task_prompts (created_at DESC);

ALTER TABLE public.seedance_task_prompts ENABLE ROW LEVEL SECURITY;

-- 已登录成员可读全站记录（与 issues 全站可见策略一致）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'seedance_task_prompts'
      AND policyname = 'seedance_task_prompts_select_authenticated'
  ) THEN
    CREATE POLICY "seedance_task_prompts_select_authenticated"
      ON public.seedance_task_prompts FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- 仅服务端 service_role 写入（API 在鉴权后用 admin client upsert）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'seedance_task_prompts'
      AND policyname = 'seedance_task_prompts_all_service_role'
  ) THEN
    CREATE POLICY "seedance_task_prompts_all_service_role"
      ON public.seedance_task_prompts FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
