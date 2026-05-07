/**
 * Phase 1.4: neighbor chunk expansion.
 *
 * Why:
 *   Hybrid recall returns the highest-scoring chunks regardless of context
 *   continuity. When an article was sliced into ~10 chunks and we only hit
 *   chunk_index=5, the LLM sees a half-sentence. Pulling chunk_index 4 and 6
 *   from the same article restores narrative continuity without changing
 *   citation semantics.
 *
 * Contract:
 *   - Input: an array of "primary" chunks (typically the hybridSearchChunks()
 *     output). Their order is preserved as the citation source-of-truth.
 *   - Output: an expanded array where every primary still appears exactly
 *     once and additional neighbor chunks (is_primary=false) are inserted
 *     between them, sorted by (article_id, chunk_index). Callers can use
 *     this directly as the LLM context, while keeping primary chunks for
 *     citation accounting (`is_primary` flag).
 *   - On any failure (RPC error, missing client, empty input), the function
 *     falls back to returning the primary chunks unchanged with is_primary=true,
 *     so the caller never has to special-case errors.
 *
 * Feature flag:
 *   - RAG_NEIGHBOR_EXPAND_ENABLED defaults to "true". Set to "false" to
 *     disable expansion globally without code changes.
 */

type RpcError = { message: string };
type RpcResult<T> = { data: T | null; error: RpcError | null };
type RpcClient = {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult<T>>;
};

export type ExpandableChunk = {
  chunk_id: string;
  article_id: string;
  article_title: string;
  category: string;
  module: string | null;
  project_name: string | null;
  chunk_index: number;
  chunk_content: string;
};

export type ExpandedChunk = ExpandableChunk & {
  is_primary: boolean;
};

export type ExpandNeighborsOptions = {
  windowSize?: number;
  onlyApproved?: boolean;
  adminClient?: RpcClient;
};

export function isNeighborExpandEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.RAG_NEIGHBOR_EXPAND_ENABLED !== "false";
}

async function getDefaultAdminClient(): Promise<RpcClient> {
  const { createAdminClient } = await import("../supabase/admin");
  return createAdminClient();
}

/**
 * Wraps every primary chunk as `is_primary: true`. Used as a graceful
 * fallback when the RPC fails or expansion is disabled.
 */
function asPrimaryOnly(chunks: ExpandableChunk[]): ExpandedChunk[] {
  return chunks.map((c) => ({ ...c, is_primary: true }));
}

export async function expandWithNeighbors(
  primary: ExpandableChunk[],
  opts: ExpandNeighborsOptions = {},
): Promise<ExpandedChunk[]> {
  const windowSize = opts.windowSize ?? 1;

  if (windowSize <= 0 || primary.length === 0) {
    return asPrimaryOnly(primary);
  }

  const admin = opts.adminClient ?? (await getDefaultAdminClient());
  const primaryIds = primary.map((c) => c.chunk_id);

  type RpcRow = ExpandableChunk & { is_primary: boolean };

  const { data, error } = await admin.rpc<RpcRow[]>("expand_chunk_neighbors", {
    primary_chunk_ids: primaryIds,
    window_size: windowSize,
    only_approved: opts.onlyApproved ?? true,
  });

  if (error || !data) {
    if (error) {
      console.error("[neighbor-expansion] expand_chunk_neighbors error:", error.message);
    }
    return asPrimaryOnly(primary);
  }

  // Defensive: every primary chunk MUST appear in the RPC output. If an
  // approval/length filter changed and dropped one, fall back to the original
  // primary set to avoid silently losing citation sources.
  const seen = new Set(data.map((row) => row.chunk_id));
  const allPrimariesPresent = primaryIds.every((id) => seen.has(id));
  if (!allPrimariesPresent) {
    console.warn(
      "[neighbor-expansion] primary chunk dropped by RPC; falling back to primary-only",
    );
    return asPrimaryOnly(primary);
  }

  // Final ordering: by article_id (stable across runs) then chunk_index (so
  // each article's neighbors appear contiguously around their primary).
  const sorted = [...data].sort((a, b) => {
    if (a.article_id !== b.article_id) {
      return a.article_id.localeCompare(b.article_id);
    }
    return a.chunk_index - b.chunk_index;
  });

  return sorted;
}
