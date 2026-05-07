-- Reconcile match_knowledge_chunks: align repo migrations with live database state.
--
-- Background discovered during RAG upgrade Phase 0 baseline:
--   1. Live DB has TWO overloads of match_knowledge_chunks; repo only documented one.
--   2. The legacy overload (vector, double precision, integer) lacks the
--      `only_approved` filter and ignores `is_ai_searchable`. It can return chunks
--      from draft / archived / non-searchable articles. This is a real privacy
--      and quality leak. Workspace grep (2026-05-07) confirms NO application
--      code calls this overload (`match_threshold` does not appear anywhere
--      under src/ or scripts/, only in baseline notes).
--   3. The active overload's live body includes `AND length(kc.content) >= 50`,
--      which the repo migration did not record. We bring the migration text up
--      to match the live function so future fresh setups behave identically.
--
-- Actions:
--   - DROP the legacy unsafe overload.
--   - CREATE OR REPLACE the active overload using its live body verbatim
--     (no behavior change, documentation only).
--
-- Rollback:
--   If the legacy overload turns out to be needed (it should not be), recreate it
--   from the snapshot below:
--
--     CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
--       query_embedding vector,
--       match_threshold double precision DEFAULT 0.5,
--       match_count integer DEFAULT 5
--     ) RETURNS TABLE (id uuid, article_id uuid, chunk_index integer, content text, similarity double precision)
--       LANGUAGE sql STABLE
--     AS $$
--       SELECT kc.id, kc.article_id, kc.chunk_index, kc.content,
--              1 - (kc.embedding <=> query_embedding) AS similarity
--       FROM knowledge_chunks kc
--       WHERE 1 - (kc.embedding <=> query_embedding) > match_threshold
--       ORDER BY kc.embedding <=> query_embedding
--       LIMIT match_count;
--     $$;

-- 1. Drop the unsafe legacy overload (no callers, leaks unapproved content).
DROP FUNCTION IF EXISTS public.match_knowledge_chunks(vector, double precision, integer);

-- 2. Re-declare the active overload to match the live body exactly.
--    Parameter type stays as polymorphic `vector` (live state); incoming arrays
--    must be 1024-dimensional, enforced at the column level on knowledge_chunks.
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector,
  match_count     integer DEFAULT 5,
  only_approved   boolean DEFAULT true
)
RETURNS TABLE (
  chunk_id      uuid,
  article_id    uuid,
  article_title text,
  category      text,
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
    kc.content       AS chunk_content,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND kc.embedding IS NOT NULL
    AND length(kc.content) >= 50
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$function$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, integer, boolean)
  TO authenticated, service_role;
