-- =============================================================
-- P0 Governance Migration
-- 涵盖：治理字段 / issue_events 表 / 状态机约束触发器 / 索引补充
-- 可重复执行（全部使用 IF NOT EXISTS / IF EXISTS 保护）
-- =============================================================

-- -------------------------------------------------------------
-- 1. public.issues 新增治理字段
-- -------------------------------------------------------------
ALTER TABLE public.issues
  ADD COLUMN IF NOT EXISTS category         TEXT,
  ADD COLUMN IF NOT EXISTS module           TEXT,
  ADD COLUMN IF NOT EXISTS source           TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS reviewer_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blocked_reason   TEXT,
  ADD COLUMN IF NOT EXISTS closed_reason    TEXT,
  ADD COLUMN IF NOT EXISTS reopen_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 老数据 source 显式回填为 manual
-- （PostgreSQL ADD COLUMN NOT NULL DEFAULT 已自动处理，此 UPDATE 仅作意图确认）
UPDATE public.issues SET source = 'manual' WHERE source IS NULL OR source = '';

-- -------------------------------------------------------------
-- 2. public.issue_updates 新增字段
-- update_type: comment | status_change | system_reminder | assignment | due_date_change | priority_change
-- -------------------------------------------------------------
ALTER TABLE public.issue_updates
  ADD COLUMN IF NOT EXISTS update_type         TEXT NOT NULL DEFAULT 'comment',
  ADD COLUMN IF NOT EXISTS is_system_generated BOOLEAN NOT NULL DEFAULT false;

-- -------------------------------------------------------------
-- 3. public.issue_events 事件日志表
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.issue_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id      UUID        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  actor_id      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  event_type    TEXT        NOT NULL,
  event_payload JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.issue_events ENABLE ROW LEVEL SECURITY;

-- SELECT 策略：只能看自己有权查看的 issue 对应的事件
-- 当前 issues 是 authenticated 全可见，此策略与 issues RLS 联动，未来收紧 issues 后自动生效
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_events'
      AND policyname = 'issue_events_select_authenticated'
  ) THEN
    CREATE POLICY "issue_events_select_authenticated"
      ON public.issue_events FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.issues i
          WHERE i.id = issue_events.issue_id
        )
      );
  END IF;
END $$;

-- INSERT 策略：登录用户可写（server action 使用用户 session）
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'issue_events'
      AND policyname = 'issue_events_insert_authenticated'
  ) THEN
    CREATE POLICY "issue_events_insert_authenticated"
      ON public.issue_events FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END $$;

-- service_role（Cron admin client）绕过 RLS，无需额外 policy

-- -------------------------------------------------------------
-- 4. 触发器：issue_updates 插入时自动刷新 last_activity_at
--    规则：仅人工更新（is_system_generated = false）才刷新
--    系统生成的催办 reminder 不应影响 stale 判定
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_issue_last_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- 跳过系统自动生成的更新，避免 stale 判定被催办通知误刷新
  IF NEW.is_system_generated = true THEN
    RETURN NEW;
  END IF;
  UPDATE public.issues
    SET last_activity_at = now()
  WHERE id = NEW.issue_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS issue_updates_touch_last_activity ON public.issue_updates;
CREATE TRIGGER issue_updates_touch_last_activity
  AFTER INSERT ON public.issue_updates
  FOR EACH ROW EXECUTE PROCEDURE public.touch_issue_last_activity();

-- 人工业务动作（assignee/reviewer/priority/due_date/status 变更）的 last_activity_at
-- 由应用层（updateIssue server action）在 update payload 中显式设置，不依赖触发器

-- -------------------------------------------------------------
-- 5. 补充缺失索引（已存在的用 IF NOT EXISTS 跳过）
-- -------------------------------------------------------------

-- issues 已有: idx_issues_assignee, idx_issues_status, idx_issues_creator, idx_issues_due_date
CREATE INDEX IF NOT EXISTS idx_issues_priority       ON public.issues (priority);
CREATE INDEX IF NOT EXISTS idx_issues_reviewer       ON public.issues (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_issues_last_activity  ON public.issues (last_activity_at DESC);

-- issue_updates 已有: idx_issue_updates_issue(issue_id), idx_issue_updates_created(created_at DESC)
-- 补充联合索引（覆盖高频查询 WHERE issue_id = X ORDER BY created_at DESC）
CREATE INDEX IF NOT EXISTS idx_issue_updates_issue_created
  ON public.issue_updates (issue_id, created_at DESC);

-- reminders 已有: idx_reminders_user(user_id, is_read), idx_reminders_created(created_at DESC)
-- 补充三列联合索引
CREATE INDEX IF NOT EXISTS idx_reminders_user_read_created
  ON public.reminders (user_id, is_read, created_at DESC);

-- issue_events
CREATE INDEX IF NOT EXISTS idx_issue_events_issue_created
  ON public.issue_events (issue_id, created_at DESC);
