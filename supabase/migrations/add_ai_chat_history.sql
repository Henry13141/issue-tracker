-- AI 对话持久化 + 对话洞察记忆
--
-- 目标：让 AI 助理"越用越懂团队"
--   1. ai_chat_messages  — 逐轮存下用户与助手的对话
--   2. conversation_insight — ai_memory 的新类别，从对话中提炼的团队知识

-- ---------------------------------------------------------------------------
-- 1. 对话消息表
-- ---------------------------------------------------------------------------
CREATE TABLE public.ai_chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_chat_messages_user_created
  ON public.ai_chat_messages (user_id, created_at DESC);

CREATE INDEX idx_ai_chat_messages_created
  ON public.ai_chat_messages (created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. 扩展 ai_memory 的 category 约束，增加 conversation_insight
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_memory
  DROP CONSTRAINT IF EXISTS ai_memory_category_check;

ALTER TABLE public.ai_memory
  ADD CONSTRAINT ai_memory_category_check
  CHECK (category IN (
    'member_profile',
    'module_health',
    'org_insight',
    'process_pattern',
    'conversation_insight'
  ));

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_chat_messages ENABLE ROW LEVEL SECURITY;

-- 用户只能读/写自己的消息；管理员可读全部
CREATE POLICY "chat_messages_select_own_or_admin"
  ON public.ai_chat_messages FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- 服务端用 admin client 写入，前端不直接 INSERT
-- 但若需要后备，允许用户插入自己的消息
CREATE POLICY "chat_messages_insert_own"
  ON public.ai_chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- 允许删除自己的消息（清空对话功能）
CREATE POLICY "chat_messages_delete_own"
  ON public.ai_chat_messages FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
