CREATE TABLE IF NOT EXISTS public.wecom_robot_issue_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wecom_userid TEXT NOT NULL UNIQUE,
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wecom_robot_issue_drafts_user_updated
  ON public.wecom_robot_issue_drafts (wecom_userid, updated_at DESC);

DROP TRIGGER IF EXISTS wecom_robot_issue_drafts_updated_at ON public.wecom_robot_issue_drafts;
CREATE TRIGGER wecom_robot_issue_drafts_updated_at
  BEFORE UPDATE ON public.wecom_robot_issue_drafts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.wecom_robot_issue_drafts ENABLE ROW LEVEL SECURITY;
