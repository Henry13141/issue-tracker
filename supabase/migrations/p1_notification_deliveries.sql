-- =============================================================
-- P1 Notification Deliveries Migration
-- 通知投递日志表：支持可审计、可查看、可失败追踪、可重试
-- =============================================================

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel             TEXT        NOT NULL,              -- wecom_app | wecom_bot
  target_user_id      UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  target_wecom_userid TEXT,
  issue_id            UUID        REFERENCES public.issues(id) ON DELETE SET NULL,
  reminder_id         UUID        REFERENCES public.reminders(id) ON DELETE SET NULL,
  trigger_source      TEXT        NOT NULL,              -- cron_morning | cron_admin | cron_daily | issue_event | manual_test
  title               TEXT,
  content             TEXT        NOT NULL,
  provider_message_id TEXT,
  provider_response   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT        NOT NULL DEFAULT 'pending', -- pending | success | failed
  error_code          TEXT,
  error_message       TEXT,
  attempt_count       INTEGER     NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at             TIMESTAMPTZ
);

-- -------------------------------------------------------------
-- 索引
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_nd_status_created
  ON public.notification_deliveries (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nd_target_user
  ON public.notification_deliveries (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nd_issue
  ON public.notification_deliveries (issue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nd_reminder
  ON public.notification_deliveries (reminder_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_nd_trigger_source
  ON public.notification_deliveries (trigger_source, created_at DESC);

-- -------------------------------------------------------------
-- RLS
-- admin 通过 is_admin() 函数校验；service_role（Cron/notification-service）绕过 RLS
-- 普通用户无法直接读写通知日志（防止泄漏内部操作记录）
-- -------------------------------------------------------------
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'notification_deliveries'
      AND policyname = 'nd_select_admin'
  ) THEN
    CREATE POLICY "nd_select_admin"
      ON public.notification_deliveries FOR SELECT
      TO authenticated
      USING (public.is_admin());
  END IF;
END $$;

-- INSERT/UPDATE/DELETE 只允许 service_role（admin client 绕过 RLS，无需显式 policy）
