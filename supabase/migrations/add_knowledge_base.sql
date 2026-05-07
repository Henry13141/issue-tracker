-- 项目知识库 / AI 项目大脑模块
-- 表创建顺序按外键依赖排列

-- ---------------------------------------------------------------------------
-- 扩展（pgvector，用于后续 RAG 检索，MVP 阶段建表不激活）
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- 1. knowledge_articles：知识主表
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_articles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  slug           TEXT,
  project_name   TEXT,
  category       TEXT NOT NULL CHECK (category IN (
    'project_overview', 'gameplay_rule', 'numeric_system', 'ui_spec',
    'technical_spec', 'hardware_protocol', 'decision_record',
    'test_acceptance', 'troubleshooting', 'operation_guide',
    'finance_ops', 'ai_workflow'
  )),
  module         TEXT,
  status         TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'reviewing', 'approved', 'deprecated', 'archived'
  )),
  version        TEXT NOT NULL DEFAULT 'v1.0',
  summary        TEXT,
  content        TEXT NOT NULL,
  owner_id       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  is_pinned      BOOLEAN NOT NULL DEFAULT false,
  is_ai_searchable BOOLEAN NOT NULL DEFAULT true,
  source_type    TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'ai_generated', 'issue_derived')),
  source_ref_id  UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_status      ON public.knowledge_articles (status);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_category    ON public.knowledge_articles (category);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_project     ON public.knowledge_articles (project_name);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_updated     ON public.knowledge_articles (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_pinned      ON public.knowledge_articles (is_pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_created_by  ON public.knowledge_articles (created_by);
CREATE INDEX IF NOT EXISTS idx_knowledge_articles_owner       ON public.knowledge_articles (owner_id);

CREATE TRIGGER knowledge_articles_updated_at
  BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. knowledge_versions：版本历史
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id  UUID NOT NULL REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  title       TEXT NOT NULL,
  summary     TEXT,
  content     TEXT NOT NULL,
  change_note TEXT,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_versions_article ON public.knowledge_versions (article_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. knowledge_issue_links：知识条目与 Issue 关联
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_issue_links (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    UUID NOT NULL REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  issue_id      UUID NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'reference' CHECK (relation_type IN (
    'reference', 'spec_for', 'acceptance_for', 'implements', 'blocks', 'result_from'
  )),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, issue_id)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_issue_links_article ON public.knowledge_issue_links (article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_issue_links_issue   ON public.knowledge_issue_links (issue_id);

-- ---------------------------------------------------------------------------
-- 4. knowledge_decisions：决策记录
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_decisions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  project_name TEXT,
  module       TEXT,
  background   TEXT,
  decision     TEXT NOT NULL,
  reason       TEXT,
  impact       TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'superseded')),
  article_id   UUID REFERENCES public.knowledge_articles(id) ON DELETE SET NULL,
  issue_id     UUID REFERENCES public.issues(id) ON DELETE SET NULL,
  decided_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at   TIMESTAMPTZ,
  created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_decisions_status  ON public.knowledge_decisions (status);
CREATE INDEX IF NOT EXISTS idx_knowledge_decisions_project ON public.knowledge_decisions (project_name);
CREATE INDEX IF NOT EXISTS idx_knowledge_decisions_updated ON public.knowledge_decisions (updated_at DESC);

CREATE TRIGGER knowledge_decisions_updated_at
  BEFORE UPDATE ON public.knowledge_decisions
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. knowledge_chunks：RAG 向量块（MVP 建表不激活）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   UUID NOT NULL REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  chunk_index  INT NOT NULL,
  content      TEXT NOT NULL,
  category     TEXT,
  module       TEXT,
  status       TEXT,
  version      TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}',
  embedding    vector(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_article ON public.knowledge_chunks (article_id, chunk_index);
-- 向量索引（MVP 建表，待 RAG 正式接入后再启用 ivfflat）
-- CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
--   ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ---------------------------------------------------------------------------
-- 6. knowledge_ai_answers：AI 问答日志
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_ai_answers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question          TEXT NOT NULL,
  answer            TEXT NOT NULL,
  project_name      TEXT,
  cited_article_ids UUID[] DEFAULT '{}',
  cited_chunk_ids   UUID[] DEFAULT '{}',
  confidence        TEXT,
  user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_ai_answers_user    ON public.knowledge_ai_answers (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_ai_answers_created ON public.knowledge_ai_answers (created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. knowledge_review_requests：审核申请
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.knowledge_review_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   UUID NOT NULL REFERENCES public.knowledge_articles(id) ON DELETE CASCADE,
  requester_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewer_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at  TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_review_requests_article ON public.knowledge_review_requests (article_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_review_requests_status  ON public.knowledge_review_requests (status, created_at DESC);

CREATE TRIGGER knowledge_review_requests_updated_at
  BEFORE UPDATE ON public.knowledge_review_requests
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.knowledge_articles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_issue_links   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_decisions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_chunks        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_ai_answers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_review_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- knowledge_articles RLS
-- SELECT：approved 知识全员可见；本人的 draft/reviewing 可见；admin 全可见
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_articles_select"
  ON public.knowledge_articles FOR SELECT
  TO authenticated
  USING (
    status = 'approved'
    OR created_by = auth.uid()
    OR owner_id = auth.uid()
    OR public.is_admin()
  );

-- INSERT：所有 authenticated 用户可创建，status 强制为 draft（由 Server Action 保证）
CREATE POLICY "knowledge_articles_insert"
  ON public.knowledge_articles FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE：本人可改自己的 draft/reviewing；admin 可改任意
-- WITH CHECK 限制：非 admin 不能将 status 改为 approved/deprecated/archived
CREATE POLICY "knowledge_articles_update_admin"
  ON public.knowledge_articles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "knowledge_articles_update_member"
  ON public.knowledge_articles FOR UPDATE
  TO authenticated
  USING (
    NOT public.is_admin()
    AND (created_by = auth.uid() OR owner_id = auth.uid())
  )
  WITH CHECK (
    NOT public.is_admin()
    AND (created_by = auth.uid() OR owner_id = auth.uid())
    AND status NOT IN ('approved', 'deprecated', 'archived')
  );

-- DELETE：仅 admin
CREATE POLICY "knowledge_articles_delete"
  ON public.knowledge_articles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- knowledge_versions RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_versions_select"
  ON public.knowledge_versions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "knowledge_versions_insert"
  ON public.knowledge_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() OR created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- knowledge_issue_links RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_issue_links_select"
  ON public.knowledge_issue_links FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "knowledge_issue_links_insert"
  ON public.knowledge_issue_links FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "knowledge_issue_links_delete"
  ON public.knowledge_issue_links FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());

-- ---------------------------------------------------------------------------
-- knowledge_decisions RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_decisions_select"
  ON public.knowledge_decisions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "knowledge_decisions_insert"
  ON public.knowledge_decisions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "knowledge_decisions_update"
  ON public.knowledge_decisions FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR public.is_admin())
  WITH CHECK (created_by = auth.uid() OR public.is_admin());

CREATE POLICY "knowledge_decisions_delete"
  ON public.knowledge_decisions FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ---------------------------------------------------------------------------
-- knowledge_chunks RLS（MVP 阶段写入仅 service_role，读对 authenticated 开放）
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_chunks_select"
  ON public.knowledge_chunks FOR SELECT
  TO authenticated
  USING (true);

-- INSERT/UPDATE 由 service_role 绕过 RLS 完成，anon/authenticated 不可直接写

-- ---------------------------------------------------------------------------
-- knowledge_ai_answers RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_ai_answers_select"
  ON public.knowledge_ai_answers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "knowledge_ai_answers_insert"
  ON public.knowledge_ai_answers FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- knowledge_review_requests RLS
-- ---------------------------------------------------------------------------
CREATE POLICY "knowledge_review_requests_select"
  ON public.knowledge_review_requests FOR SELECT
  TO authenticated
  USING (requester_id = auth.uid() OR public.is_admin());

CREATE POLICY "knowledge_review_requests_insert"
  ON public.knowledge_review_requests FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "knowledge_review_requests_update"
  ON public.knowledge_review_requests FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
