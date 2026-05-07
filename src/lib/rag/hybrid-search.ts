type RpcError = { message: string };
type RpcResult<T> = { data: T | null; error: RpcError | null };
type RpcClient = {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<RpcResult<T>>;
};

type VectorRow = {
  chunk_id: string;
  article_id: string;
  article_title: string;
  category: string;
  module: string | null;
  project_name: string | null;
  chunk_index: number;
  chunk_content: string;
  similarity: number;
};

type FtsRow = {
  chunk_id: string;
  article_id: string;
  article_title: string;
  category: string;
  module: string | null;
  project_name: string | null;
  chunk_index: number;
  chunk_content: string;
  rank: number;
};

type FtsCandidate = FtsRow & {
  query_text: string;
};

export type HybridChunk = {
  chunk_id: string;
  article_id: string;
  article_title: string;
  category: string;
  module: string | null;
  project_name: string | null;
  chunk_index: number;
  chunk_content: string;
  /** RRF fused score. Higher is better. */
  score: number;
  /** Retrieval source: vector / fts / both. */
  source: "vector" | "fts" | "both";
  /** Raw vector similarity, when present. */
  vectorSimilarity?: number;
  /** Raw FTS rank, when present. */
  fts_rank?: number;
};

export type HybridSearchOptions = {
  matchCount?: number;
  onlyApproved?: boolean;
  filterProjectName?: string | null;
  filterCategory?: string | null;
  filterModule?: string | null;
  /** RRF constant. Larger values soften top-rank dominance. */
  rrfK?: number;
  /** Per-source candidate count. Defaults to matchCount * 3. */
  candidatesPerSource?: number;
  /** Optional dependency injection for scripts/tests. */
  adminClient?: RpcClient;
  createEmbedding?: (text: string) => Promise<number[] | null>;
  minSimilarity?: number;
};

async function getDefaultAdminClient(): Promise<RpcClient> {
  const { createAdminClient } = await import("../supabase/admin");
  return createAdminClient();
}

async function getDefaultAiTools(): Promise<{
  createEmbedding: (text: string) => Promise<number[] | null>;
  minSimilarity: number;
}> {
  const { createEmbedding, MIN_KNOWLEDGE_SIMILARITY } = await import("../ai");
  return {
    createEmbedding,
    minSimilarity: MIN_KNOWLEDGE_SIMILARITY,
  };
}

function buildFtsQueryTexts(query: string): string[] {
  const terms = new Set<string>();
  const addTerm = (term: string) => {
    const clean = term.trim();
    if (clean.length < 2) return;
    if (/^(核心|主要|整体|方式|功能|模块|设计|规则|玩法|信息|哪些|项目)$/.test(clean)) {
      return;
    }
    terms.add(clean);
  };

  for (const match of query.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)) {
    addTerm(match[0]);
  }

  for (const match of query.matchAll(/[\p{Script=Han}]{2,24}/gu)) {
    const run = match[0];
    const parts = run.split(
      /(?:是什么|有哪些|怎么|需要|展示|哪些|主要|核心|整体|方式|关键|信息|功能|模块|设计|规则|玩法|项目|的|和|与|是|了|吗)+/u,
    );

    for (const part of parts) {
      addTerm(part);
      const level = part.match(/第[一二三四五六七八九十0-9]+关/u)?.[0];
      if (!level) continue;
      addTerm(level);
      const [beforeLevel = "", afterLevel = ""] = part.split(level);
      addTerm(beforeLevel);
      addTerm(afterLevel);
    }

    if (run.length <= 12) addTerm(run);
  }

  return [...terms].slice(0, 8);
}

async function fetchFtsCandidates(
  admin: RpcClient,
  queryTexts: string[],
  params: {
    candidatesPerSource: number;
    onlyApproved: boolean;
    filterProjectName: string | null;
    filterCategory: string | null;
    filterModule: string | null;
  },
): Promise<FtsRow[]> {
  const results = await Promise.all(
    queryTexts.map(async (queryText): Promise<FtsCandidate[]> => {
      const { data, error } = await admin.rpc<FtsRow[]>("search_knowledge_chunks_fts", {
        query_text: queryText,
        match_count: params.candidatesPerSource,
        only_approved: params.onlyApproved,
        filter_project_name: params.filterProjectName,
        filter_category: params.filterCategory,
        filter_module: params.filterModule,
      });
      if (error || !data) return [];
      return data.map((row) => ({
        ...row,
        query_text: queryText,
      }));
    }),
  );

  const byChunk = new Map<string, FtsCandidate>();
  for (const row of results.flat()) {
    const existing = byChunk.get(row.chunk_id);
    if (!existing || row.rank > existing.rank) {
      byChunk.set(row.chunk_id, row);
    }
  }

  return [...byChunk.values()]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, params.candidatesPerSource);
}

/**
 * Hybrid search: vector recall + full-text recall, fused by RRF.
 *
 * The function does not switch any user-facing route by itself. Callers decide
 * whether to enable it after comparing baseline quality.
 */
export async function hybridSearchChunks(
  query: string,
  opts: HybridSearchOptions = {},
): Promise<HybridChunk[]> {
  const {
    matchCount = 8,
    onlyApproved = true,
    filterProjectName = null,
    filterCategory = null,
    filterModule = null,
    rrfK = 60,
  } = opts;
  const candidatesPerSource = opts.candidatesPerSource ?? matchCount * 3;

  const [admin, aiTools] = await Promise.all([
    opts.adminClient ? Promise.resolve(opts.adminClient) : getDefaultAdminClient(),
    opts.createEmbedding
      ? Promise.resolve({
          createEmbedding: opts.createEmbedding,
          minSimilarity: opts.minSimilarity ?? 0.25,
        })
      : getDefaultAiTools(),
  ]);

  const [vectorRes, ftsRes] = await Promise.all([
    (async (): Promise<VectorRow[]> => {
      const embedding = await aiTools.createEmbedding(query);
      if (!embedding) return [];
      const { data, error } = await admin.rpc<VectorRow[]>("match_knowledge_chunks_v2", {
        query_embedding: embedding,
        match_count: candidatesPerSource,
        only_approved: onlyApproved,
        filter_project_name: filterProjectName,
        filter_category: filterCategory,
        filter_module: filterModule,
        min_similarity: aiTools.minSimilarity,
      });
      if (error || !data) return [];
      return data;
    })(),
    fetchFtsCandidates(admin, buildFtsQueryTexts(query), {
      candidatesPerSource,
      onlyApproved,
      filterProjectName,
      filterCategory,
      filterModule,
    }),
  ]);

  const scoreMap = new Map<string, HybridChunk>();

  vectorRes.forEach((row, index) => {
    const rrfScore = 1 / (rrfK + index + 1);
    scoreMap.set(row.chunk_id, {
      chunk_id: row.chunk_id,
      article_id: row.article_id,
      article_title: row.article_title,
      category: row.category,
      module: row.module,
      project_name: row.project_name,
      chunk_index: row.chunk_index,
      chunk_content: row.chunk_content,
      score: rrfScore,
      source: "vector",
      vectorSimilarity: row.similarity,
    });
  });

  ftsRes.forEach((row, index) => {
    const rrfScore = 1 / (rrfK + index + 1);
    const existing = scoreMap.get(row.chunk_id);
    if (existing) {
      existing.score += rrfScore;
      existing.source = "both";
      existing.fts_rank = row.rank;
      return;
    }

    scoreMap.set(row.chunk_id, {
      chunk_id: row.chunk_id,
      article_id: row.article_id,
      article_title: row.article_title,
      category: row.category,
      module: row.module,
      project_name: row.project_name,
      chunk_index: row.chunk_index,
      chunk_content: row.chunk_content,
      score: rrfScore,
      source: "fts",
      fts_rank: row.rank,
    });
  });

  return [...scoreMap.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, matchCount);
}
