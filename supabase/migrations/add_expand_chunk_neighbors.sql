-- Phase 1.4: neighbor chunk expansion RPC.
--
-- Motivation:
--   Phase 1.3 baseline shows many recalled articles only contribute a single
--   isolated chunk (e.g. `1adba643(0.53×1)`). When the underlying article was
--   sliced into ~10 chunks and we only hit chunk_index=5, the LLM sees a
--   half-sentence context. Pulling chunk_index 4 and 6 from the same article
--   restores narrative continuity without changing what we cite.
--
-- Contract:
--   - primary_chunk_ids: hybrid/_v2 winners that already passed scoring +
--     citation policy. They MUST stay in the result so the caller can keep
--     citation accounting intact.
--   - window_size: how many chunks to pull on each side of every primary,
--     clamped to 0..3 inside the function. Defaults to 1 (±1).
--   - only_approved: same approval gate as match_knowledge_chunks_v2 to keep
--     RAG content policy uniform.
--   - is_primary boolean lets the application layer reuse the same row set
--     for both LLM prompt context and citation verification.
--
-- Filtering parity with match_knowledge_chunks_v2:
--   - is_ai_searchable = true
--   - status = 'approved' (when only_approved)
--   - length(content) >= 50 (matches RPC source of truth, see phase 1.3 fix).

DROP FUNCTION IF EXISTS public.expand_chunk_neighbors(uuid[], integer, boolean);

CREATE OR REPLACE FUNCTION public.expand_chunk_neighbors(
  primary_chunk_ids uuid[],
  window_size       integer DEFAULT 1,
  only_approved     boolean DEFAULT true
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
  is_primary    boolean
)
LANGUAGE sql STABLE
AS $function$
  WITH clamped AS (
    SELECT LEAST(GREATEST(COALESCE(window_size, 1), 0), 3) AS w
  ),
  primaries AS (
    SELECT kc.id, kc.article_id, kc.chunk_index
    FROM public.knowledge_chunks kc
    WHERE kc.id = ANY(primary_chunk_ids)
  ),
  expanded AS (
    SELECT DISTINCT kc.id AS chunk_id
    FROM public.knowledge_chunks kc
    JOIN primaries p ON p.article_id = kc.article_id
    CROSS JOIN clamped c
    WHERE kc.chunk_index BETWEEN p.chunk_index - c.w AND p.chunk_index + c.w
  )
  SELECT
    kc.id           AS chunk_id,
    kc.article_id,
    ka.title        AS article_title,
    ka.category,
    ka.module,
    ka.project_name,
    kc.chunk_index,
    kc.content      AS chunk_content,
    (kc.id = ANY(primary_chunk_ids)) AS is_primary
  FROM expanded e
  JOIN public.knowledge_chunks kc   ON kc.id = e.chunk_id
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND length(kc.content) >= 50
  ORDER BY kc.article_id, kc.chunk_index;
$function$;

GRANT EXECUTE ON FUNCTION public.expand_chunk_neighbors(uuid[], integer, boolean)
  TO authenticated, service_role;
