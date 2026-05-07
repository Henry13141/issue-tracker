-- Phase 1.1: add filtered RAG vector search RPC.
--
-- Phase 0.4 already removed the unsafe legacy overload
-- match_knowledge_chunks(vector, double precision, integer), so this migration
-- only adds the new _v2 function. Callers will switch in Phase 1.2 after review.
--
-- Notes:
-- - query_embedding stays polymorphic `vector`, matching live DB state; the
--   1024-dimensional requirement is enforced by knowledge_chunks.embedding.
-- - match_count defaults to 8 because Phase 0.5 showed all baseline questions
--   hit the old 5-row cap before filtering.
-- - Returned project/module/chunk_index fields are needed by project isolation
--   and later neighbor expansion / MMR phases.

DROP FUNCTION IF EXISTS public.match_knowledge_chunks_v2(
  vector,
  integer,
  boolean,
  text,
  text,
  text,
  uuid[],
  double precision
);

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_v2(
  query_embedding       vector,
  match_count           integer          DEFAULT 8,
  only_approved         boolean          DEFAULT true,
  filter_project_name   text             DEFAULT NULL,
  filter_category       text             DEFAULT NULL,
  filter_module         text             DEFAULT NULL,
  filter_article_ids    uuid[]           DEFAULT NULL,
  min_similarity        double precision DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id      uuid,
  article_id    uuid,
  article_title text,
  category      text,
  module        text,
  project_name  text,
  chunk_index   integer,
  chunk_content text,
  similarity    double precision
)
LANGUAGE sql STABLE
AS $function$
  SELECT
    kc.id            AS chunk_id,
    kc.article_id,
    ka.title         AS article_title,
    ka.category,
    ka.module,
    ka.project_name,
    kc.chunk_index,
    kc.content       AS chunk_content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND kc.embedding IS NOT NULL
    AND length(kc.content) >= 50
    AND (filter_project_name IS NULL OR ka.project_name = filter_project_name)
    AND (filter_category     IS NULL OR ka.category     = filter_category)
    AND (filter_module       IS NULL OR ka.module       = filter_module)
    AND (filter_article_ids  IS NULL OR ka.id = ANY(filter_article_ids))
    AND (1 - (kc.embedding <=> query_embedding)) >= COALESCE(min_similarity, 0.0)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT LEAST(GREATEST(COALESCE(match_count, 8), 1), 200);
$function$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_v2(
  vector,
  integer,
  boolean,
  text,
  text,
  text,
  uuid[],
  double precision
) TO authenticated, service_role;
