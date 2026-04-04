-- 企业微信机器人多轮记忆

CREATE TABLE IF NOT EXISTS public.wecom_robot_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wecom_userid TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wecom_robot_messages_user_created
  ON public.wecom_robot_messages (wecom_userid, created_at DESC);

ALTER TABLE public.wecom_robot_messages ENABLE ROW LEVEL SECURITY;
