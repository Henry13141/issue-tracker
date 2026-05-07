-- RAG 检索支持：向量索引 + 相似度搜索 RPC 函数
-- 依赖：add_knowledge_base.sql 已执行（knowledge_chunks 表已存在）

-- ---------------------------------------------------------------------------
-- 向量索引（IVFFlat，余弦距离，lists=50 适合小规模语料）
-- 注意：空表建索引 Postgres 会提示 lists 超过行数，属正常警告，不影响功能。
-- 待语料量超过 1000 条时可 DROP/RECREATE 索引以获得更好性能。
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

-- ---------------------------------------------------------------------------
-- match_knowledge_chunks：向量相似度搜索 RPC 函数
-- 参数：
--   query_embedding  用户问题的向量
--   match_count      返回块数上限（建议 5）
--   only_approved    是否仅搜索 approved 状态的文章（默认 true）
-- 返回：chunk_id, article_id, article_title, category, content, similarity
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding  vector(1536),
  match_count      int     DEFAULT 5,
  only_approved    boolean DEFAULT true
)
RETURNS TABLE (
  chunk_id      uuid,
  article_id    uuid,
  article_title text,
  category      text,
  chunk_content text,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kc.id            AS chunk_id,
    kc.article_id,
    ka.title         AS article_title,
    ka.category,
    kc.content       AS chunk_content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND kc.embedding IS NOT NULL
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- 授权给 authenticated 和 service_role 角色
GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks TO authenticated, service_role;
