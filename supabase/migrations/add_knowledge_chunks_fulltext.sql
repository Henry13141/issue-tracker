-- Phase 1.3: add full-text retrieval path for RAG hybrid search.
--
-- This migration only adds FTS infrastructure. Application traffic remains on
-- vector search until the hybrid TypeScript layer is reviewed and compared.
--
-- The `simple` dictionary keeps code / product terms such as GameParty,
-- GameMode, PR-1234, UE5, Arduino, and project-specific nouns searchable
-- without English stemming. Chinese quality can be revisited later with
-- zhparser / pg_jieba if needed.

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_content_tsv
  ON public.knowledge_chunks USING GIN (content_tsv);

DROP FUNCTION IF EXISTS public.search_knowledge_chunks_fts(
  text,
  integer,
  boolean,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.search_knowledge_chunks_fts(
  query_text            text,
  match_count           integer DEFAULT 8,
  only_approved         boolean DEFAULT true,
  filter_project_name   text    DEFAULT NULL,
  filter_category       text    DEFAULT NULL,
  filter_module         text    DEFAULT NULL
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
  rank          double precision
)
LANGUAGE sql STABLE
AS $function$
  WITH search_query AS (
    SELECT plainto_tsquery('simple', btrim(query_text)) AS tsq
    WHERE btrim(COALESCE(query_text, '')) <> ''
  )
  SELECT
    kc.id            AS chunk_id,
    kc.article_id,
    ka.title         AS article_title,
    ka.category,
    ka.module,
    ka.project_name,
    kc.chunk_index,
    kc.content       AS chunk_content,
    ts_rank(kc.content_tsv, search_query.tsq)::double precision AS rank
  FROM search_query
  JOIN public.knowledge_chunks kc ON kc.content_tsv @@ search_query.tsq
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND length(kc.content) >= 50
    AND (filter_project_name IS NULL OR ka.project_name = filter_project_name)
    AND (filter_category     IS NULL OR ka.category     = filter_category)
    AND (filter_module       IS NULL OR ka.module       = filter_module)
  ORDER BY ts_rank(kc.content_tsv, search_query.tsq) DESC, kc.chunk_index ASC
  LIMIT LEAST(GREATEST(COALESCE(match_count, 8), 1), 200);
$function$;

GRANT EXECUTE ON FUNCTION public.search_knowledge_chunks_fts(
  text,
  integer,
  boolean,
  text,
  text,
  text
) TO authenticated, service_role;
