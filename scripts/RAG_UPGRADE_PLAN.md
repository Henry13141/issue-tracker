# RAG 系统专业化升级 · Codex 执行手册

> 这是一份给 Codex（或任意有读写代码权限的 Agent）的**操作级**升级计划。
> 每一步都给出：**意图 / 文件路径 / 具体改动 / 验收命令 / 回滚动作**。
> 不要跳步。每完成一节，做一次 `git add -A && git commit -m "rag-upgrade: <section>"`，单元小、回退安全。

---

## 0 · 阅读须知（不要跳过）

### 0.1 项目背景
- 框架：**Next.js 16+（魔改版）**。`AGENTS.md` 明确：API/约定/文件结构与训练数据可能不同，**写代码前先读 `node_modules/next/dist/docs/` 对应章节**。
- 数据库：Supabase（pgvector 已启用）。Service role 客户端走 `src/lib/supabase/admin.ts`，前端走 `src/lib/supabase/server.ts`。
- AI：火山方舟 `doubao-embedding-vision-251215`（embedding）+ Moonshot `kimi-k2.6`（chat），见 `src/lib/ai.ts`。
- RAG 入口：`src/app/api/knowledge/ask/route.ts`、`src/actions/ai.ts` 中的 `chatWithAssistant`。
- 离线导入脚本：`scripts/embed-article.mjs`、`scripts/ingest-local-knowledge.mjs`。
- Migration 目录：`supabase/migrations/`，现有命名风格 `add_xxx.sql` / `pN_xxx.sql`，**不带时间戳**。新增按这个风格走。

### 0.2 已有改动（已 commit / pending）
- ✅ `MIN_KNOWLEDGE_SIMILARITY = 0.25` 常量统一在 `src/lib/ai.ts`
- ✅ `/api/knowledge/ask` 已加 citations 二次校验（Step 4.5）
- ✅ `ask` 和 `chatWithAssistant` 已统一用 `MIN_KNOWLEDGE_SIMILARITY`
- ⚠️ TODO：`project_name` 过滤 RPC 还没升级（`src/app/api/knowledge/ask/route.ts` 里有注释）

### 0.3 已知问题与必须先确认的事
**🔴 阻塞项 #1：embedding 维度声明不一致**
- `supabase/migrations/add_knowledge_base.sql` 第 133 行：`embedding vector(1536)`
- `supabase/migrations/add_knowledge_rag.sql` 第 22 行：`query_embedding vector(1536)`
- 但 `src/lib/ai.ts` 第 121 行 / `scripts/embed-article.mjs` 第 84 行：**截断到 1024**

**Codex 第一件要做的事**：在线上 Supabase 执行
```sql
SELECT atttypid::regtype, atttypmod 
FROM pg_attribute 
WHERE attrelid = 'public.knowledge_chunks'::regclass 
  AND attname = 'embedding';
```
- 如果实际是 `vector(1024)`：把两个 migration 文件的 `1536` 改成 `1024`，加一个补丁 migration `fix_knowledge_chunks_dim_doc.sql` 注释说明（不需要 alter，仅修文档）。
- 如果实际是 `vector(1536)`：**所有写入都在丢精度**，要么改库到 1024（DROP + RECREATE 列）+ 全量重建 embedding，要么把代码改成不截断。**先和用户确认**。

不解决这个之前，Phase 1.3 的 hybrid search 上线会更乱。

---

## Phase 0 · 摸底与基线（必做，半天）

### 0.1 数据现状 SQL
执行并把结果存到 `scripts/RAG_BASELINE_SNAPSHOT.md`：

```sql
-- 文章总量与状态分布
SELECT status, count(*) FROM knowledge_articles GROUP BY status;

-- 按 project_name 分布
SELECT coalesce(project_name, '(null)') AS project, count(*) 
FROM knowledge_articles 
WHERE status = 'approved' 
GROUP BY 1 ORDER BY 2 DESC;

-- 按 category / module 分布
SELECT category, count(*) FROM knowledge_articles GROUP BY category ORDER BY 2 DESC;
SELECT coalesce(module, '(null)') AS module, count(*) FROM knowledge_articles GROUP BY 1 ORDER BY 2 DESC;

-- chunks 总量与覆盖率
SELECT 
  (SELECT count(*) FROM knowledge_articles WHERE status = 'approved' AND is_ai_searchable = true) AS approved_searchable,
  (SELECT count(DISTINCT article_id) FROM knowledge_chunks WHERE embedding IS NOT NULL) AS articles_with_embedding,
  (SELECT count(*) FROM knowledge_chunks WHERE embedding IS NOT NULL) AS total_chunks,
  (SELECT round(avg(c)::numeric, 1) FROM (
     SELECT count(*) AS c FROM knowledge_chunks WHERE embedding IS NOT NULL GROUP BY article_id
   ) t) AS avg_chunks_per_article;

-- chunk 长度分布
SELECT 
  width_bucket(length(content), 0, 800, 8) AS bucket,
  count(*)
FROM knowledge_chunks
GROUP BY 1 ORDER BY 1;

-- 最近 30 天问答量与无依据率
SELECT 
  count(*) AS total_questions,
  count(*) FILTER (WHERE confidence IS NULL OR confidence = 'low') AS low_confidence,
  count(*) FILTER (WHERE cited_article_ids = '{}') AS no_citation
FROM knowledge_ai_answers
WHERE created_at > now() - interval '30 days';
```

### 0.2 列出当前 RPC 定义
```sql
SELECT pg_get_functiondef(oid) 
FROM pg_proc 
WHERE proname = 'match_knowledge_chunks';
```
确认实际线上和 `add_knowledge_rag.sql` 是否一致。

### 0.3 Baseline 评测
新建 `scripts/eval-rag-baseline.mjs`（Phase 3 的精简版）：
- 写死 5 个真实问题（用户提供 / 从 `knowledge_ai_answers` 高分历史挑）
- 对每题调一次 `/api/knowledge/ask`
- 输出表格：question / cited_article_ids / similarity_top1 / confidence / no_basis / answer_preview

跑一次存成 `scripts/RAG_BASELINE_SNAPSHOT.md` 附录。**这是后续所有改动的对比基准**。

---

## Phase 1 · 检索质量与项目隔离（最高优先级，2-3 天）

### 1.1 升级 `match_knowledge_chunks` RPC（带过滤）

> **Phase 0.4 已完成**：旧重载 `(vector, double precision, integer)` 已通过 `reconcile_match_knowledge_chunks_overloads.sql` 从线上 DROP 掉。当前线上只剩唯一签名 `(vector, integer, boolean)`。本节不需要再考虑命中错误重载的问题。

**新建 migration**：`supabase/migrations/upgrade_match_chunks_with_filters.sql`

```sql
-- 升级 match_knowledge_chunks：支持 project/category/module/article_ids 过滤
-- 注意：保留旧函数签名以保证向后兼容，新函数加 _v2 后缀
-- 验证稳定后再切换调用方，最后 drop 旧函数

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks_v2(
  query_embedding       vector,        -- 与线上保持一致：polymorphic vector，维度由 knowledge_chunks.embedding 列(1024) 强制
  match_count           int     DEFAULT 8,
  only_approved         boolean DEFAULT true,
  filter_project_name   text    DEFAULT NULL,
  filter_category       text    DEFAULT NULL,
  filter_module         text    DEFAULT NULL,
  filter_article_ids    uuid[]  DEFAULT NULL,
  min_similarity        float   DEFAULT 0.0
)
RETURNS TABLE (
  chunk_id      uuid,
  article_id    uuid,
  article_title text,
  category      text,
  module        text,
  project_name  text,
  chunk_index   int,
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
    AND (filter_project_name IS NULL OR ka.project_name = filter_project_name)
    AND (filter_category     IS NULL OR ka.category     = filter_category)
    AND (filter_module       IS NULL OR ka.module       = filter_module)
    AND (filter_article_ids  IS NULL OR ka.id = ANY(filter_article_ids))
    AND (1 - (kc.embedding <=> query_embedding)) >= min_similarity
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks_v2 TO authenticated, service_role;
```

**改动点**：
- 维度若实际是 1536 则保持，写明 Phase 0 已验证
- 多了 `module`、`project_name`、`chunk_index` 返回字段（给后续邻近 chunk 扩展用）
- `min_similarity` 下推到 SQL，减少 round-trip
- match_count 默认从 5 提到 8，给后续 rerank 留 headroom

**验证 SQL**（在 supabase 执行）：
```sql
-- 不传过滤，应等价于旧函数
SELECT count(*) FROM match_knowledge_chunks_v2('[0,0,0,...]'::vector(1024), 5, true);

-- 带 project 过滤，应只返回某 project 的 chunks
SELECT DISTINCT project_name FROM match_knowledge_chunks_v2(
  '[0,0,...]'::vector(1024), 50, true, 'GameParty'
);
```

### 1.2 应用层接入新 RPC

**改文件 1**：`src/app/api/knowledge/ask/route.ts`

```ts
// Step 2 替换为：
const { data: rawChunks, error: rpcErr } = await admin.rpc(
  "match_knowledge_chunks_v2",
  {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT * 3, // 召回 3 倍，留给后续 rerank/MMR
    only_approved: true,
    filter_project_name: projectName,
    min_similarity: MIN_KNOWLEDGE_SIMILARITY,
  }
);

// RawChunk 类型补字段
type RawChunk = {
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

// 删掉 Step 2 之后的相似度过滤（已下推），保留长度过滤
const chunks = ((rawChunks as RawChunk[]) ?? []).filter(
  (c) => c.chunk_content.trim().length >= 100
).slice(0, MATCH_COUNT); // 暂取前 N，rerank 在 Phase 1.4 加
```

**改文件 2**：`src/actions/ai.ts` 里 `chatWithAssistant` 同样改用 `match_knowledge_chunks_v2`。
- `project_name` 来源：暂从用户最近活跃的 issue / dashboard 上下文推断；如无法识别就传 `null`（兼容当前行为）。
- `match_count: 6`，因为助手对话需要的不止知识库一种上下文。

**改文件 3**：删除 `src/app/api/knowledge/ask/route.ts` 里 Phase 0 留的 TODO 注释。

### 1.3 Hybrid Search（向量 + 全文）

**新建 migration**：`supabase/migrations/add_knowledge_chunks_fulltext.sql`

```sql
-- 给 knowledge_chunks 加全文检索能力
-- 用 simple 词典：中文不分词时退化为字符匹配，仍能命中精确词如 "PR-1234"、"GameMode"
-- 待团队评估后可换成 zhparser / pg_jieba

ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_tsv
  ON public.knowledge_chunks USING GIN (content_tsv);

-- 全文检索 RPC（独立于向量，便于 RRF 融合）
CREATE OR REPLACE FUNCTION public.search_knowledge_chunks_fts(
  query_text            text,
  match_count           int     DEFAULT 8,
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
  chunk_index   int,
  chunk_content text,
  rank          float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    kc.id            AS chunk_id,
    kc.article_id,
    ka.title         AS article_title,
    ka.category,
    ka.module,
    ka.project_name,
    kc.chunk_index,
    kc.content       AS chunk_content,
    ts_rank(kc.content_tsv, plainto_tsquery('simple', query_text)) AS rank
  FROM public.knowledge_chunks kc
  JOIN public.knowledge_articles ka ON ka.id = kc.article_id
  WHERE
    ka.is_ai_searchable = true
    AND (NOT only_approved OR ka.status = 'approved')
    AND kc.content_tsv @@ plainto_tsquery('simple', query_text)
    AND (filter_project_name IS NULL OR ka.project_name = filter_project_name)
    AND (filter_category     IS NULL OR ka.category     = filter_category)
    AND (filter_module       IS NULL OR ka.module       = filter_module)
  ORDER BY rank DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.search_knowledge_chunks_fts TO authenticated, service_role;
```

**新建文件**：`src/lib/rag/hybrid-search.ts`

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding, MIN_KNOWLEDGE_SIMILARITY } from "@/lib/ai";

export type HybridChunk = {
  chunk_id: string;
  article_id: string;
  article_title: string;
  category: string;
  module: string | null;
  project_name: string | null;
  chunk_index: number;
  chunk_content: string;
  /** 融合得分（RRF），越大越相关 */
  score: number;
  /** 来源：vector / fts / both */
  source: "vector" | "fts" | "both";
  /** 原始向量相似度，可选，便于调试 */
  vectorSimilarity?: number;
};

export type HybridSearchOptions = {
  matchCount?: number;
  onlyApproved?: boolean;
  filterProjectName?: string | null;
  filterCategory?: string | null;
  filterModule?: string | null;
  /** RRF 常数，默认 60。越小则越偏向头部排名 */
  rrfK?: number;
  /** 单路召回数量，默认 matchCount * 3 */
  candidatesPerSource?: number;
};

/**
 * Hybrid Search：向量召回 + 全文召回，RRF 融合排序
 * 返回融合后的 Top-N chunks，已带过滤
 */
export async function hybridSearchChunks(
  query: string,
  opts: HybridSearchOptions = {}
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

  const admin = createAdminClient();

  // 并行：向量 + 全文
  const [vectorRes, ftsRes] = await Promise.all([
    (async () => {
      const embedding = await createEmbedding(query);
      if (!embedding) return [];
      const { data, error } = await admin.rpc("match_knowledge_chunks_v2", {
        query_embedding: embedding,
        match_count: candidatesPerSource,
        only_approved: onlyApproved,
        filter_project_name: filterProjectName,
        filter_category: filterCategory,
        filter_module: filterModule,
        min_similarity: MIN_KNOWLEDGE_SIMILARITY,
      });
      if (error || !data) return [];
      return data as Array<{
        chunk_id: string; article_id: string; article_title: string;
        category: string; module: string | null; project_name: string | null;
        chunk_index: number; chunk_content: string; similarity: number;
      }>;
    })(),
    (async () => {
      const { data, error } = await admin.rpc("search_knowledge_chunks_fts", {
        query_text: query,
        match_count: candidatesPerSource,
        only_approved: onlyApproved,
        filter_project_name: filterProjectName,
        filter_category: filterCategory,
        filter_module: filterModule,
      });
      if (error || !data) return [];
      return data as Array<{
        chunk_id: string; article_id: string; article_title: string;
        category: string; module: string | null; project_name: string | null;
        chunk_index: number; chunk_content: string; rank: number;
      }>;
    })(),
  ]);

  // RRF 融合
  const scoreMap = new Map<string, HybridChunk>();
  vectorRes.forEach((row, idx) => {
    const existing = scoreMap.get(row.chunk_id);
    const rrfScore = 1 / (rrfK + idx + 1);
    if (existing) {
      existing.score += rrfScore;
      existing.source = "both";
      existing.vectorSimilarity = row.similarity;
    } else {
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
    }
  });
  ftsRes.forEach((row, idx) => {
    const existing = scoreMap.get(row.chunk_id);
    const rrfScore = 1 / (rrfK + idx + 1);
    if (existing) {
      existing.score += rrfScore;
      existing.source = "both";
    } else {
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
      });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, matchCount);
}
```

### 1.4 邻近 chunk 扩展 + MMR

**新建文件**：`src/lib/rag/expand-and-dedupe.ts`

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { HybridChunk } from "./hybrid-search";

/**
 * 把召回的 chunk 扩展前后各 N 个邻居，提升上下文连贯性。
 * 实现策略：按 article_id 分组，取所有出现过的 chunk_index 的邻居 ±neighborSpan
 */
export async function expandWithNeighbors(
  chunks: HybridChunk[],
  neighborSpan = 1
): Promise<HybridChunk[]> {
  if (chunks.length === 0 || neighborSpan === 0) return chunks;

  const admin = createAdminClient();
  // 收集每篇文章需要的 chunk_index 范围
  const wanted = new Map<string, Set<number>>();
  for (const c of chunks) {
    const set = wanted.get(c.article_id) ?? new Set<number>();
    for (let i = -neighborSpan; i <= neighborSpan; i++) {
      const idx = c.chunk_index + i;
      if (idx >= 0) set.add(idx);
    }
    wanted.set(c.article_id, set);
  }

  // 查询补齐
  const articleIds = [...wanted.keys()];
  const { data, error } = await admin
    .from("knowledge_chunks")
    .select("id, article_id, chunk_index, content, knowledge_articles!inner(title, category, module, project_name)")
    .in("article_id", articleIds);
  if (error || !data) return chunks;

  // 已存在 set，避免重复
  const existing = new Set(chunks.map((c) => c.chunk_id));
  const expanded: HybridChunk[] = [...chunks];

  for (const row of data as any[]) {
    const articleSet = wanted.get(row.article_id);
    if (!articleSet?.has(row.chunk_index)) continue;
    if (existing.has(row.id)) continue;
    const meta = row.knowledge_articles;
    expanded.push({
      chunk_id: row.id,
      article_id: row.article_id,
      article_title: meta.title,
      category: meta.category,
      module: meta.module,
      project_name: meta.project_name,
      chunk_index: row.chunk_index,
      chunk_content: row.content,
      score: 0.0001, // 补齐的邻居 rank 最低
      source: "vector",
    });
  }

  // 按 article + chunk_index 排序，保证拼接时上下文有序
  expanded.sort((a, b) => {
    if (a.article_id !== b.article_id) return b.score - a.score;
    return a.chunk_index - b.chunk_index;
  });

  return expanded;
}

/**
 * MMR (Maximal Marginal Relevance) 去重：
 * 对内容相似度高于 threshold 的 chunk 只保留 score 最高的一条
 * 用 Jaccard 相似度（character-level）做粗略判重，无需额外向量
 */
export function mmrDedupe(chunks: HybridChunk[], threshold = 0.7): HybridChunk[] {
  if (chunks.length <= 1) return chunks;
  const sorted = [...chunks].sort((a, b) => b.score - a.score);
  const kept: HybridChunk[] = [];
  for (const cand of sorted) {
    const dup = kept.find((k) => jaccardChar(k.chunk_content, cand.chunk_content) >= threshold);
    if (!dup) kept.push(cand);
  }
  return kept;
}

function jaccardChar(a: string, b: string): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const ch of sa) if (sb.has(ch)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

**接入**：把 `/api/knowledge/ask` 和 `chatWithAssistant` 里的检索逻辑替换为：
```ts
import { hybridSearchChunks } from "@/lib/rag/hybrid-search";
import { expandWithNeighbors, mmrDedupe } from "@/lib/rag/expand-and-dedupe";

const candidates = await hybridSearchChunks(question, {
  matchCount: 12,
  filterProjectName: projectName,
});
const dedupedTop = mmrDedupe(candidates, 0.75).slice(0, 5);
const finalChunks = await expandWithNeighbors(dedupedTop, 1);
```

### 1.5 Phase 1 验收清单

```bash
# 1. Migration 跑通无报错
supabase db push  # 或手工在 dashboard 执行

# 2. 单元自检（写最小测试，放 scripts/test-rag-phase1.mjs）
node scripts/test-rag-phase1.mjs --question "拔河 GameMode 是怎么实现的" --project GameParty
# 预期输出：返回的所有 chunk 的 project_name 严格 == "GameParty"

# 3. Baseline 对比
node scripts/eval-rag-baseline.mjs > scripts/RAG_PHASE1_RESULT.md
# 与 RAG_BASELINE_SNAPSHOT.md 对比，hit rate / confidence 至少不退化

# 4. Build & lint
npx tsc --noEmit
npx next build
```

**回滚**：
```sql
DROP FUNCTION IF EXISTS public.match_knowledge_chunks_v2;
DROP FUNCTION IF EXISTS public.search_knowledge_chunks_fts;
ALTER TABLE public.knowledge_chunks DROP COLUMN IF EXISTS content_tsv;
```
应用层 git revert 对应 commit。

---

## Phase 2 · 索引健康与可观测（2-3 天）

### 2.1 索引状态字段

**新建 migration**：`supabase/migrations/add_knowledge_index_health.sql`

```sql
-- 给 knowledge_articles 加索引状态追踪字段
ALTER TABLE public.knowledge_articles
  ADD COLUMN IF NOT EXISTS embedding_status      text NOT NULL DEFAULT 'pending'
    CHECK (embedding_status IN ('pending', 'processing', 'success', 'failed', 'stale', 'skipped')),
  ADD COLUMN IF NOT EXISTS embedding_error       text,
  ADD COLUMN IF NOT EXISTS embedding_updated_at  timestamptz,
  ADD COLUMN IF NOT EXISTS content_checksum      text,
  ADD COLUMN IF NOT EXISTS chunk_count           int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding_attempts    int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_knowledge_articles_embedding_status
  ON public.knowledge_articles (embedding_status) WHERE status = 'approved';

-- 自动检测 stale：内容/标题/摘要变化时把 embedding_status 标 stale
CREATE OR REPLACE FUNCTION public.knowledge_articles_mark_stale()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.content IS DISTINCT FROM OLD.content)
     OR (NEW.title   IS DISTINCT FROM OLD.title)
     OR (NEW.summary IS DISTINCT FROM OLD.summary) THEN
    NEW.embedding_status := 'stale';
    NEW.content_checksum := encode(digest(NEW.content, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS knowledge_articles_mark_stale_trg ON public.knowledge_articles;
CREATE TRIGGER knowledge_articles_mark_stale_trg
  BEFORE UPDATE ON public.knowledge_articles
  FOR EACH ROW EXECUTE FUNCTION public.knowledge_articles_mark_stale();

-- 初始化 checksum + 如果已有 chunks 则 mark success
UPDATE public.knowledge_articles ka
SET 
  content_checksum = encode(digest(ka.content, 'sha256'), 'hex'),
  embedding_status = CASE 
    WHEN EXISTS (SELECT 1 FROM public.knowledge_chunks WHERE article_id = ka.id AND embedding IS NOT NULL)
      THEN 'success' 
    ELSE 'pending' 
  END,
  chunk_count = (SELECT count(*) FROM public.knowledge_chunks WHERE article_id = ka.id AND embedding IS NOT NULL),
  embedding_updated_at = (SELECT max(created_at) FROM public.knowledge_chunks WHERE article_id = ka.id);

-- 健康度视图（管理面板用）
CREATE OR REPLACE VIEW public.knowledge_index_health AS
SELECT
  count(*) FILTER (WHERE status = 'approved' AND is_ai_searchable = true)              AS searchable_total,
  count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'success')         AS indexed,
  count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'pending')         AS pending,
  count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'stale')           AS stale,
  count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'failed')          AS failed,
  count(*) FILTER (WHERE status = 'approved' AND embedding_status = 'processing')      AS processing,
  (SELECT count(*) FROM public.knowledge_chunks WHERE embedding IS NOT NULL)           AS total_chunks
FROM public.knowledge_articles;

GRANT SELECT ON public.knowledge_index_health TO authenticated, service_role;
```

需要 `pgcrypto` 扩展，前置：
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### 2.2 抽离 embedding pipeline 到共享模块

**新建文件**：`src/lib/rag/embedding-pipeline.ts`

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import { createEmbedding } from "@/lib/ai";
import { createHash } from "node:crypto";

const MAX_CHUNK_LEN = 600;

export type EmbedResult = {
  articleId: string;
  status: "success" | "failed" | "skipped";
  chunkCount: number;
  error?: string;
};

export function splitIntoChunks(text: string, maxLen = MAX_CHUNK_LEN): string[] {
  const sections = text.split(/(?=^#{2,3} )/m).filter(Boolean);
  const result: string[] = [];
  for (const section of sections) {
    if (section.length <= maxLen) { result.push(section); continue; }
    const paragraphs = section.split(/\n{2,}/);
    let current = "";
    for (const para of paragraphs) {
      if ((current + "\n\n" + para).length > maxLen && current) {
        result.push(current.trim());
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current.trim()) result.push(current.trim());
  }
  return result.flatMap((chunk) => {
    if (chunk.length <= maxLen) return [chunk];
    const parts: string[] = [];
    for (let i = 0; i < chunk.length; i += maxLen) parts.push(chunk.slice(i, i + maxLen));
    return parts;
  });
}

/**
 * 对单篇文章重建 embedding。幂等：同 checksum 不会重复处理。
 * - 写 embedding_status: processing -> success/failed
 * - 失败时把 error 记到 embedding_error
 */
export async function rebuildArticleEmbedding(articleId: string): Promise<EmbedResult> {
  const admin = createAdminClient();

  const { data: article, error: fetchErr } = await admin
    .from("knowledge_articles")
    .select("id, title, summary, content, category, module, status, version, content_checksum, embedding_status")
    .eq("id", articleId)
    .single();

  if (fetchErr || !article) {
    return { articleId, status: "failed", chunkCount: 0, error: fetchErr?.message ?? "article not found" };
  }

  const fullText = [article.summary ? `摘要：${article.summary}` : "", article.content].filter(Boolean).join("\n\n");
  const newChecksum = createHash("sha256").update(fullText).digest("hex");

  // 幂等：如果 success 且 checksum 没变则跳过
  if (article.embedding_status === "success" && article.content_checksum === newChecksum) {
    return { articleId, status: "skipped", chunkCount: 0 };
  }

  // 标记处理中
  await admin.from("knowledge_articles").update({
    embedding_status: "processing",
    embedding_attempts: (await admin.from("knowledge_articles").select("embedding_attempts").eq("id", articleId).single()).data?.embedding_attempts ?? 0 + 1,
  }).eq("id", articleId);

  try {
    const chunks = splitIntoChunks(fullText).filter((c) => c.trim());
    if (chunks.length === 0) throw new Error("文章内容为空");

    // 清旧 chunks
    await admin.from("knowledge_chunks").delete().eq("article_id", articleId);

    // 顺序生成 embedding（避免并发限速；如需提速可改为 p-limit 并发 3）
    let success = 0;
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i].trim();
      const embedding = await createEmbedding(text);
      if (!embedding) throw new Error(`chunk ${i} embedding 失败`);
      const { error: insertErr } = await admin.from("knowledge_chunks").insert({
        article_id: articleId,
        chunk_index: i,
        content: text,
        category: article.category,
        module: article.module ?? null,
        status: article.status,
        version: article.version,
        metadata: { title: article.title, chunk_index: i, total_chunks: chunks.length },
        embedding,
      });
      if (insertErr) throw new Error(`chunk ${i} insert 失败: ${insertErr.message}`);
      success++;
    }

    await admin.from("knowledge_articles").update({
      embedding_status: "success",
      embedding_error: null,
      embedding_updated_at: new Date().toISOString(),
      content_checksum: newChecksum,
      chunk_count: success,
    }).eq("id", articleId);

    return { articleId, status: "success", chunkCount: success };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await admin.from("knowledge_articles").update({
      embedding_status: "failed",
      embedding_error: error.slice(0, 500),
      embedding_updated_at: new Date().toISOString(),
    }).eq("id", articleId);
    return { articleId, status: "failed", chunkCount: 0, error };
  }
}

/** 批量处理 stale + pending + 已 fail < N 次的文章 */
export async function processIndexQueue(opts?: { limit?: number; maxAttempts?: number }) {
  const limit = opts?.limit ?? 5;
  const maxAttempts = opts?.maxAttempts ?? 3;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("knowledge_articles")
    .select("id")
    .eq("status", "approved")
    .eq("is_ai_searchable", true)
    .in("embedding_status", ["pending", "stale", "failed"])
    .lt("embedding_attempts", maxAttempts)
    .order("embedding_updated_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error || !data) return { processed: 0, results: [] as EmbedResult[] };

  const results: EmbedResult[] = [];
  for (const row of data) {
    results.push(await rebuildArticleEmbedding(row.id));
  }
  return { processed: results.length, results };
}
```

把 `scripts/embed-article.mjs` 改写为薄包装，调用同一段逻辑（保证 CLI / Server / Cron 三路一致）。

### 2.3 Cron 接口

**新建路由**：`src/app/api/cron/rebuild-embeddings/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { processIndexQueue } from "@/lib/rag/embedding-pipeline";

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(req: NextRequest) {
  // 简易鉴权：CRON_SECRET 走 header 或 query
  const provided = req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? "5");
  const result = await processIndexQueue({ limit });
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) { return POST(req); }
```

**Supabase pg_cron**（在 dashboard SQL 里执行一次）：

```sql
-- 需要 pg_cron 扩展（Supabase pro 默认开启）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 每 5 分钟跑一次，使用 net.http_post（Supabase 提供）
SELECT cron.schedule(
  'rag-rebuild-embeddings',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://YOUR_VERCEL_DOMAIN/api/cron/rebuild-embeddings?limit=10',
      headers := jsonb_build_object('x-cron-secret', 'YOUR_CRON_SECRET')
    );
  $$
);
```

**回滚**：`SELECT cron.unschedule('rag-rebuild-embeddings');`

### 2.4 健康面板

**新建页面**：`src/app/(main)/admin/knowledge-health/page.tsx`

最小可用版包含：
- 顶部 4 张统计卡：总可索引 / 已索引 / 待处理 / 失败
- 覆盖率进度条（indexed / searchable_total）
- 失败列表表格（title / category / project / 失败原因 / 重试按钮 / 最后更新时间）
- Stale 列表表格
- 「立即处理 5 条」按钮（调用 `processIndexQueue`）

数据查询用 server component，`SELECT * FROM knowledge_index_health` + `SELECT id, title, project_name, embedding_error, embedding_updated_at FROM knowledge_articles WHERE embedding_status = 'failed' ORDER BY embedding_updated_at DESC LIMIT 50`。

权限：仅 admin 可访问，沿用 `getCurrentUser().role === 'admin'` 判断（看 `src/app/(main)` 下其他 admin 页面例子）。

### 2.5 Phase 2 验收

```bash
# 1. Migration 应用
supabase db push

# 2. 现有 approved 文章应被标 success（或对应正确状态）
psql -c "SELECT embedding_status, count(*) FROM knowledge_articles WHERE status = 'approved' GROUP BY 1;"

# 3. 改一篇文章正文 → 状态变 stale
psql -c "UPDATE knowledge_articles SET content = content || ' test' WHERE id = '<某id>';"
psql -c "SELECT embedding_status FROM knowledge_articles WHERE id = '<某id>';"
# 预期：stale

# 4. 调 cron 接口手动触发
curl -X POST -H "x-cron-secret: $CRON_SECRET" "$VERCEL_URL/api/cron/rebuild-embeddings?limit=3"
# 预期：返回 processed >= 1，刚才那篇变回 success

# 5. 访问 /admin/knowledge-health，看到数据
```

---

## Phase 3 · 评测体系（3-4 天）

### 3.1 Golden Questions 表

**新建 migration**：`supabase/migrations/add_knowledge_eval.sql`

```sql
CREATE TABLE IF NOT EXISTS public.knowledge_eval_questions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question              text NOT NULL,
  expected_article_ids  uuid[] NOT NULL DEFAULT '{}',
  expected_keywords     text[] NOT NULL DEFAULT '{}',
  must_have_no_basis    boolean NOT NULL DEFAULT false,
  project_scope         text,
  category              text,
  difficulty            text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  notes                 text,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_eval_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_eval_questions_admin"
  ON public.knowledge_eval_questions FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE TABLE IF NOT EXISTS public.knowledge_eval_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label       text,
  prompt_version  text,
  total           int NOT NULL,
  passed          int NOT NULL,
  hit_rate_at_5   numeric(5,2),
  mrr             numeric(5,4),
  citation_precision numeric(5,2),
  faithfulness    numeric(5,2),
  no_basis_acc    numeric(5,2),
  details         jsonb NOT NULL,
  created_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.knowledge_eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_eval_runs_admin"
  ON public.knowledge_eval_runs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
```

### 3.2 评测脚本

**新建文件**：`scripts/eval-rag.mjs`

核心流程伪代码：
```
1. 拉所有 is_active = true 的 questions
2. 对每题：
   a. POST /api/knowledge/ask（或直接调底层函数，更快更稳）
   b. 记录 retrieved_chunks / answer / citations / no_basis / confidence
   c. 计算每题指标：
      - hit_rate_at_5: expected_article_ids 与 retrieved 前 5 的交集 > 0 ? 1 : 0
      - mrr: expected 在 retrieved 中第一个出现位置的倒数
      - citation_precision: citations 中在 expected 内的比例
      - keyword_coverage: answer 包含多少 expected_keywords
      - no_basis_acc: must_have_no_basis 标志匹配
3. 汇总；可选：用 LLM-as-judge 评 faithfulness（answer vs retrieved 是否一致）
4. 写入 knowledge_eval_runs
5. 输出 markdown 报告到 stdout，CI 可解析 exit code（pass < 阈值时 exit 1）
```

调用方式：
```bash
node scripts/eval-rag.mjs --label "phase1-baseline" --threshold 0.8
```

### 3.3 用户反馈

**Migration patch**：
```sql
ALTER TABLE public.knowledge_ai_answers
  ADD COLUMN IF NOT EXISTS user_feedback text 
    CHECK (user_feedback IN ('up', 'down', NULL)),
  ADD COLUMN IF NOT EXISTS feedback_note text,
  ADD COLUMN IF NOT EXISTS feedback_at   timestamptz;
```

**新增 API**：`src/app/api/knowledge/ask/[id]/feedback/route.ts`
- POST 接收 `{ feedback: "up"|"down", note?: string }`
- 鉴权：`user_id = current user`
- 更新 `knowledge_ai_answers`

前端：在回答展示组件下方加两个按钮（已点过的 disable）。

### 3.4 Phase 3 验收

```bash
# 录入题目（admin 在 supabase studio 里手插，或写一个 admin 录入页）
# 跑评测
node scripts/eval-rag.mjs --label "phase3-acceptance" 

# 改一行 prompt 后再跑
node scripts/eval-rag.mjs --label "after-prompt-tweak"

# 在 knowledge_eval_runs 里看到两条记录，可对比
```

---

## Phase 4 · 运维与权限收口（1-2 天）

### 4.1 Rate limit

**新建 migration**：`supabase/migrations/add_knowledge_ask_quota.sql`
- 用 `knowledge_ai_answers` 现成的 `created_at + user_id` 索引
- 在 `/api/knowledge/ask` 入口前加：
  ```ts
  const { count } = await admin
    .from("knowledge_ai_answers")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) >= 30) {
    return NextResponse.json({ error: "提问过于频繁，请稍候" }, { status: 429 });
  }
  ```

### 4.2 失败告警

利用已有的 `wecom_robot_messages` 表（看 `src/app/api/wecom/`）：
- 在 `processIndexQueue` 失败 ≥ 3 次时调企微机器人推送
- 在 `eval-rag.mjs` 跑出 hit_rate 跌破阈值时也推送

### 4.3 RLS-aware retrieval（前置改造，不立刻启用）

给 `knowledge_articles` 加 `visibility` 字段（`public` / `team` / `private`），先全量回填 `public`，下次有真实需求再启用 SECURITY INVOKER 的 RPC 变体。先建字段不动 RLS，避免破坏现有访问。

### 4.4 Prompt 版本化

新建 `prompts/knowledge-ask.v1.md`（纯 markdown，便于 diff / review）。  
路由侧：
```ts
import askPromptV1 from "@/prompts/knowledge-ask.v1.md?raw";
const PROMPT_VERSION = "v1";
```
（Next.js 16 的 import 用法以 `node_modules/next/dist/docs/` 为准；若不支持 raw import 则 fs.readFileSync 在启动时读一次）。  
把 `PROMPT_VERSION` 写到 `knowledge_ai_answers.prompt_version`（先建字段）。

---

## 全局执行顺序与产物清单

```
Phase 0  → RAG_BASELINE_SNAPSHOT.md（含 SQL 结果 + 5 题基线评测）
Phase 1  → upgrade_match_chunks_with_filters.sql
         → add_knowledge_chunks_fulltext.sql
         → src/lib/rag/hybrid-search.ts
         → src/lib/rag/expand-and-dedupe.ts
         → /api/knowledge/ask + chatWithAssistant 改造
         → RAG_PHASE1_RESULT.md
Phase 2  → add_knowledge_index_health.sql
         → src/lib/rag/embedding-pipeline.ts
         → /api/cron/rebuild-embeddings/route.ts
         → /admin/knowledge-health/page.tsx
         → pg_cron schedule
Phase 3  → add_knowledge_eval.sql
         → scripts/eval-rag.mjs
         → /api/knowledge/ask/[id]/feedback/route.ts
         → knowledge_ai_answers 反馈字段
Phase 4  → rate limit 注入 ask 路由
         → 企微告警接入
         → visibility 字段 + prompt 版本化
```

---

## 给 Codex 的硬性约束

1. **AGENTS.md 第一条**：写代码前先读 `node_modules/next/dist/docs/` 中相关章节，确认 API 签名。
2. 所有 SQL migration 先在 Supabase **dashboard 预演**，确认无报错才落库 commit。
3. 不要修改 `.cursor` / `.codex` / `~/.openclaw` 任何全局配置。
4. 不要 `git push` —— 阶段完成 commit 后让用户 review。
5. 每个 Phase 完成后：
   - `npx tsc --noEmit` 必须通过
   - `npx next build` 必须通过
   - 在用户的 Obsidian 库 `LLM-Wiki/raw/local/issues/` 写一份阶段总结：`<日期>-rag-phase-<N>-完成纪要.md`
6. 涉及 RPC 变更：**新函数加 `_v2` 后缀，旧函数保留 7 天后再 drop**（避免热更新时引用断裂）。
7. 任何对现有用户体验有可见影响的改动，配开关（环境变量 `RAG_HYBRID_ENABLED=true` 这种），灰度推进。
8. **维度问题（Phase 0.3）必须先解决**，否则任何写入 chunks 的改动都可能炸。

---

## 完成定义（"专业完整健全" 验收）

| 维度 | 现状 | 目标 |
|------|------|------|
| 检索召回 | 纯向量 Top-5 | Hybrid + RRF + MMR + 邻居扩展 |
| 项目隔离 | ❌ 跨项目混 | RPC 级别强过滤 |
| 引用真实性 | ✅ 已校验 | 保持 |
| Embedding 健康 | 🚫 无追踪 | status / checksum / 自动重试 / 面板 |
| 评测体系 | 🚫 无 | golden set + CI 阈值 + 历史快照 |
| 告警 | 🚫 仅 console | 企微推送 + 健康面板红点 |
| 权限 | service role 全开 | visibility 预备 + RLS-aware 路径 |
| Prompt 治理 | 硬编码 | 文件化 + 版本号入库 |
| Rate limit | ❌ | 30/min · 500/day |

跑通这 9 项，才能说"专业完整健全"。

---

> 写完一切，发一句话给用户：「RAG 升级 Phase X 已完成，现状：xxx；阻塞/已知问题：xxx；下一步建议：xxx。」  
> 不要默默完成不汇报。
