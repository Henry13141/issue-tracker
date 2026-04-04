-- =============================================================
-- 交接返工闭环：issue_handovers + issue_participants
-- 可重复执行（全部使用 IF NOT EXISTS / IF EXISTS 保护）
-- =============================================================

-- -------------------------------------------------------------
-- 1. issue_handovers — 交接/退回历史链路
-- kind: handover（交接） | return（返工退回）
-- status: active（当前有效） | returned（已被退回） | completed（已关闭/已解决）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issue_handovers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id       UUID        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  from_user_id   UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  to_user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind           TEXT        NOT NULL DEFAULT 'handover',  -- handover | return
  note           TEXT,
  attachment_names TEXT[],
  status         TEXT        NOT NULL DEFAULT 'active',    -- active | returned | completed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handovers_issue ON public.issue_handovers (issue_id);
CREATE INDEX IF NOT EXISTS idx_handovers_from  ON public.issue_handovers (from_user_id);
CREATE INDEX IF NOT EXISTS idx_handovers_to    ON public.issue_handovers (to_user_id);

ALTER TABLE public.issue_handovers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_handovers'
      AND policyname = 'handovers_select_authenticated'
  ) THEN
    CREATE POLICY "handovers_select_authenticated"
      ON public.issue_handovers FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_handovers'
      AND policyname = 'handovers_insert_authenticated'
  ) THEN
    CREATE POLICY "handovers_insert_authenticated"
      ON public.issue_handovers FOR INSERT
      TO authenticated
      WITH CHECK (from_user_id = auth.uid() OR public.is_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_handovers'
      AND policyname = 'handovers_update_authenticated'
  ) THEN
    CREATE POLICY "handovers_update_authenticated"
      ON public.issue_handovers FOR UPDATE
      TO authenticated
      USING (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- 2. issue_participants — 参与者/跟进关系
-- role: creator | assignee | reviewer | handover_from | watcher
-- active: 仍在跟进中（用于过滤"我跟进的"）
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issue_participants (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   UUID        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL,  -- creator | assignee | reviewer | handover_from | watcher
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issue_id, user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_participants_issue ON public.issue_participants (issue_id);
CREATE INDEX IF NOT EXISTS idx_participants_user  ON public.issue_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_participants_active ON public.issue_participants (user_id, active) WHERE active = true;

ALTER TABLE public.issue_participants ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_participants'
      AND policyname = 'participants_select_authenticated'
  ) THEN
    CREATE POLICY "participants_select_authenticated"
      ON public.issue_participants FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_participants'
      AND policyname = 'participants_insert_authenticated'
  ) THEN
    CREATE POLICY "participants_insert_authenticated"
      ON public.issue_participants FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_participants'
      AND policyname = 'participants_update_authenticated'
  ) THEN
    CREATE POLICY "participants_update_authenticated"
      ON public.issue_participants FOR UPDATE
      TO authenticated
      USING (true);
  END IF;
END $$;

-- -------------------------------------------------------------
-- 3. 回填历史数据：把现有 creator / assignee / reviewer 写入 participants
-- 使用 ON CONFLICT 保证幂等
-- -------------------------------------------------------------
INSERT INTO public.issue_participants (issue_id, user_id, role, active)
SELECT id, creator_id, 'creator', true
FROM public.issues
WHERE creator_id IS NOT NULL
ON CONFLICT (issue_id, user_id, role) DO NOTHING;

INSERT INTO public.issue_participants (issue_id, user_id, role, active)
SELECT id, assignee_id, 'assignee', true
FROM public.issues
WHERE assignee_id IS NOT NULL
ON CONFLICT (issue_id, user_id, role) DO NOTHING;

INSERT INTO public.issue_participants (issue_id, user_id, role, active)
SELECT id, reviewer_id, 'reviewer', true
FROM public.issues
WHERE reviewer_id IS NOT NULL
ON CONFLICT (issue_id, user_id, role) DO NOTHING;
