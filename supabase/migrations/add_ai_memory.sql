-- AI 组织记忆系统
-- 存储 AI 对团队成员、模块健康度、组织洞察的累积认知

-- ---------------------------------------------------------------------------
-- ai_memory: 每条记录是 AI 关于某个"主题"的一段结构化认知
-- ---------------------------------------------------------------------------
CREATE TABLE public.ai_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 记忆分类
  category      TEXT NOT NULL CHECK (category IN (
    'member_profile',   -- 成员画像
    'module_health',    -- 模块/项目健康度
    'org_insight',      -- 组织层面洞察
    'process_pattern'   -- 协作流程规律
  )),

  -- 记忆主体标识（对于 member_profile 是 user_id；对于 module_health 是模块名）
  subject_key   TEXT,
  subject_label TEXT,   -- 人类可读的主体名称（成员名、模块名等）

  -- AI 生成的认知内容（自然语言段落）
  content       TEXT NOT NULL,

  -- 支撑这条认知的数量化原始数据快照
  raw_metrics   JSONB DEFAULT '{}',

  -- 本条记忆覆盖的时间窗口
  period_start  DATE,
  period_end    DATE,

  -- 版本号（每次重新生成会递增）
  version       INT NOT NULL DEFAULT 1,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_memory_category       ON public.ai_memory (category);
CREATE INDEX idx_ai_memory_subject_key    ON public.ai_memory (subject_key);
CREATE INDEX idx_ai_memory_updated_at     ON public.ai_memory (updated_at DESC);
CREATE UNIQUE INDEX idx_ai_memory_unique_subject
  ON public.ai_memory (category, subject_key)
  WHERE subject_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ai_interaction_events: 记录用户在平台上的行为轨迹（轻量埋点）
-- ---------------------------------------------------------------------------
CREATE TABLE public.ai_interaction_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,   -- 'view_issue' | 'create_issue' | 'update_status' |
                                -- 'search' | 'navigate' | 'ai_chat' | 'export'
  target_type TEXT,            -- 'issue' | 'dashboard' | 'member' | 'report'
  target_id   TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_events_user_created   ON public.ai_interaction_events (user_id, created_at DESC);
CREATE INDEX idx_ai_events_event_type     ON public.ai_interaction_events (event_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- 触发器：自动维护 updated_at
-- ---------------------------------------------------------------------------
CREATE TRIGGER ai_memory_updated_at
  BEFORE UPDATE ON public.ai_memory
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_interaction_events ENABLE ROW LEVEL SECURITY;

-- ai_memory: 管理员可读写；普通成员只读（让 AI 助手可以回答非管理员的问题）
CREATE POLICY "ai_memory_select_authenticated"
  ON public.ai_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "ai_memory_insert_admin"
  ON public.ai_memory FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "ai_memory_update_admin"
  ON public.ai_memory FOR UPDATE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "ai_memory_delete_admin"
  ON public.ai_memory FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ai_interaction_events: 用户只能插入自己的事件；管理员可以读全部
CREATE POLICY "ai_events_insert_own"
  ON public.ai_interaction_events FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "ai_events_select_admin"
  ON public.ai_interaction_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
