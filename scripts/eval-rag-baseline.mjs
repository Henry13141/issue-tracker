import fs from "node:fs";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/haoyi/issue-tracker";
const SNAPSHOT_PATH = `${REPO}/scripts/RAG_BASELINE_SNAPSHOT.md`;
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
const ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";
const MIN_KNOWLEDGE_SIMILARITY = 0.25;
const MATCH_COUNT = 12;
const MIN_CHUNK_CONTENT_LEN = 50;
const USE_HYBRID = process.env.USE_HYBRID === "1";
const USE_NEIGHBOR_EXPAND = process.env.USE_NEIGHBOR_EXPAND === "1";
const NEIGHBOR_WINDOW_SIZE = Number(process.env.NEIGHBOR_WINDOW_SIZE || 1);
const SEARCH_MODE = `${USE_HYBRID ? "hybrid" : "vector"}${USE_NEIGHBOR_EXPAND ? "+nbr" : ""}`;

const QUESTIONS = [
  {
    project_name: "问题追踪系统",
    question: "问题追踪系统的核心功能和知识库模块是怎么设计的？",
  },
  {
    project_name: "GameParty",
    question: "GameParty 项目的整体架构和部署方式是什么？",
  },
  {
    project_name: "欢乐客栈",
    question: "欢乐客栈第一关前堂对掌的核心玩法是什么？",
  },
  {
    project_name: "欢乐客栈",
    question: "金币与声望系统的主要规则有哪些？",
  },
  {
    project_name: "欢乐客栈",
    question: "战报与结算 UI 需要展示哪些关键信息？",
  },
];

function loadEnv() {
  const envText = fs.readFileSync(`${REPO}/.env.local`, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2]
      .replace(/^["']|["']$/g, "")
      .replace(/\\n/g, "")
      .trim();
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function createEmbedding(text) {
  const res = await fetch(ARK_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${requireEnv("ARK_API_KEY")}`,
    },
    body: JSON.stringify({
      model: ARK_EMBEDDING_MODEL,
      input: [{ type: "text", text: text.slice(0, 4000) }],
      dimensions: 1024,
      encoding_format: "float",
    }),
  });

  if (!res.ok) {
    throw new Error(`Ark embedding ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const embedding = json?.data?.embedding;
  if (!embedding) throw new Error("Ark embedding returned empty data");
  return embedding.length > 1024 ? embedding.slice(0, 1024) : embedding;
}

async function chatCompletion(systemPrompt, userContent) {
  const client = new OpenAI({
    apiKey: requireEnv("MOONSHOT_API_KEY"),
    baseURL: "https://api.moonshot.cn/v1",
  });

  const res = await client.chat.completions.create({
    model: "kimi-k2.6",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 2048,
    thinking: { type: "disabled" },
  });

  const content = res.choices[0]?.message?.content?.trim();
  if (!content) throw new Error("Moonshot returned empty completion");
  return content;
}

function parseJsonCompletion(result) {
  const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  return JSON.parse(cleaned);
}

function buildSystemPrompt(chunks, noBasis) {
  const contextSection = noBasis
    ? ""
    : chunks
        .map(
          (chunk, index) =>
            `【知识片段 ${index + 1}${chunk.is_primary === false ? "·上下文" : ""}】来源：《${chunk.article_title}》（ID: ${chunk.article_id}）\n${chunk.chunk_content}`,
        )
        .join("\n\n---\n\n");

  return `你是项目知识库 AI 助手。请严格依据以下知识库片段回答用户问题。

规则：
1. 只能基于下方「知识片段」作答，不得凭空推测或使用知识库外的信息。
2. 如知识库中没有可靠依据，必须将 no_basis 设为 true，answer 字段填写「抱歉，知识库中没有找到关于这个问题的可靠依据。」
3. 回答用简体中文，语言简洁专业。
4. 必须严格按照以下 JSON 格式返回，不要输出 JSON 以外的任何内容：
{
  "answer": "正文回答（Markdown 格式，可用列表/加粗/代码块）",
  "citations": [{"id": "article_id", "title": "文章标题"}],
  "confidence": "high" | "medium" | "low",
  "no_basis": false,
  "risk_notes": "使用该知识时的风险提示（无则填 null）",
  "actionable": true | false
}
5. citations 只列出实际引用到的文章，不要伪造。
6. confidence 判断标准：知识片段与问题高度匹配为 high；部分匹配为 medium；仅边缘相关为 low。

${noBasis ? "（知识库中未检索到相关内容，请直接返回 no_basis: true）" : `知识库片段：\n\n${contextSection}`}`;
}

function previewAnswer(answer) {
  return String(answer || "")
    .replace(/\s+/g, " ")
    .slice(0, 90);
}

function mdCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, "<br>");
}

function mdTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
  ].join("\n");
}

let hybridSearchChunksPromise;
let neighborExpansionPromise;

function silenceModuleWarnings() {
  const original = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const code =
      typeof args[0] === "object" && args[0] !== null ? args[0].code : args[1];
    const message = typeof warning === "string" ? warning : warning?.message;
    if (code === "MODULE_TYPELESS_PACKAGE_JSON" || message?.includes("Module type of file")) {
      return;
    }
    original.call(process, warning, ...args);
  };
  return () => {
    process.emitWarning = original;
  };
}

async function getHybridSearchChunks() {
  if (!hybridSearchChunksPromise) {
    const restore = silenceModuleWarnings();
    hybridSearchChunksPromise = import(
      pathToFileURL(`${REPO}/src/lib/rag/hybrid-search.ts`).href
    )
      .then((mod) => mod.hybridSearchChunks)
      .finally(restore);
  }
  return hybridSearchChunksPromise;
}

async function getExpandWithNeighbors() {
  if (!neighborExpansionPromise) {
    const restore = silenceModuleWarnings();
    neighborExpansionPromise = import(
      pathToFileURL(`${REPO}/src/lib/rag/neighbor-expansion.ts`).href
    )
      .then((mod) => mod.expandWithNeighbors)
      .finally(restore);
  }
  return neighborExpansionPromise;
}

function displayScore(chunk) {
  return Number(
    chunk.vectorSimilarity ?? chunk.similarity ?? chunk.fts_rank ?? chunk.rank ?? chunk.score ?? 0,
  );
}

function sourceLabel(source) {
  if (source === "both") return "both";
  if (source === "fts") return "fts";
  return "vec";
}

function mergeSource(a, b) {
  if (!a) return b || "vector";
  if (!b || a === b) return a;
  return "both";
}

/** 把召回的 chunks 按 article 聚合：返回 [{id, top_similarity, chunk_count, source}]，按分数降序 */
function aggregateRetrievedArticles(chunks) {
  const byArticle = new Map();
  for (const chunk of chunks) {
    const existing = byArticle.get(chunk.article_id);
    const score = displayScore(chunk);
    const source = chunk.source || "vector";
    if (!existing) {
      byArticle.set(chunk.article_id, {
        id: chunk.article_id,
        title: chunk.article_title,
        top_similarity: score,
        chunk_count: 1,
        source,
      });
    } else {
      existing.top_similarity = Math.max(existing.top_similarity, score);
      existing.chunk_count += 1;
      existing.source = mergeSource(existing.source, source);
    }
  }
  return [...byArticle.values()].sort((a, b) => b.top_similarity - a.top_similarity);
}

async function askDirect(supabase, item) {
  let rawChunkList;
  if (USE_HYBRID) {
    const hybridSearchChunks = await getHybridSearchChunks();
    rawChunkList = await hybridSearchChunks(item.question, {
      matchCount: MATCH_COUNT,
      onlyApproved: true,
      filterProjectName: item.project_name,
      minSimilarity: MIN_KNOWLEDGE_SIMILARITY,
      candidatesPerSource: MATCH_COUNT * 3,
      adminClient: supabase,
      createEmbedding,
      rrfK: 60,
    });
  } else {
    const queryEmbedding = await createEmbedding(item.question);
    const { data: rawChunks, error } = await supabase.rpc("match_knowledge_chunks_v2", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      only_approved: true,
      filter_project_name: item.project_name,
      min_similarity: MIN_KNOWLEDGE_SIMILARITY,
    });

    if (error) throw new Error(`match_knowledge_chunks_v2 failed: ${error.message}`);
    rawChunkList = (rawChunks || []).map((chunk) => ({
      ...chunk,
      source: "vector",
      vectorSimilarity: chunk.similarity,
      score: chunk.similarity,
    }));
  }

  const primaryChunks = rawChunkList.filter(
    (chunk) => String(chunk.chunk_content || "").trim().length >= MIN_CHUNK_CONTENT_LEN,
  );

  // 召回元信息：过滤前/后 chunk 数 + 按文章聚合（含 top similarity 与 chunk 数）
  const retrievedChunkCountRaw = rawChunkList.length;
  const retrievedChunkCountFiltered = primaryChunks.length;
  const retrievedArticles = aggregateRetrievedArticles(rawChunkList);
  const retrievedArticlesFiltered = aggregateRetrievedArticles(primaryChunks);

  // 邻居扩展（仅当 USE_NEIGHBOR_EXPAND=1 且有命中），promptChunks 是 LLM 实际看到的素材
  let promptChunks = primaryChunks.map((c) => ({ ...c, is_primary: true }));
  let neighborChunkCount = 0;
  if (USE_NEIGHBOR_EXPAND && primaryChunks.length > 0) {
    const expandWithNeighbors = await getExpandWithNeighbors();
    const expanded = await expandWithNeighbors(primaryChunks, {
      windowSize: NEIGHBOR_WINDOW_SIZE,
      onlyApproved: true,
      adminClient: supabase,
    });
    promptChunks = expanded;
    neighborChunkCount = expanded.filter((c) => !c.is_primary).length;
  }

  const noBasis = primaryChunks.length === 0;
  const systemPrompt = buildSystemPrompt(promptChunks, noBasis);
  const completion = await chatCompletion(systemPrompt, `用户问题：${item.question}`);
  const promptChunkLabel = USE_NEIGHBOR_EXPAND
    ? `${retrievedChunkCountFiltered}+${neighborChunkCount}`
    : `${retrievedChunkCountFiltered}`;

  let parsed;
  try {
    parsed = parseJsonCompletion(completion);
  } catch (error) {
    return {
      question: item.question,
      project_name: item.project_name,
      cited_article_ids: [],
      similarity_top1: rawChunkList?.[0] ? displayScore(rawChunkList[0]) : null,
      retrieved_chunks: `${retrievedChunkCountRaw}→${retrievedChunkCountFiltered}`,
      prompt_chunks: promptChunkLabel,
      neighbor_chunk_count: neighborChunkCount,
      retrieved_articles: retrievedArticles,
      retrieved_articles_filtered: retrievedArticlesFiltered,
      both_chunk_ratio: calculateBothChunkRatio(primaryChunks),
      confidence: "parse_error",
      no_basis: true,
      answer_preview: `parse_error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const retrievedArticleIdsSet = new Set(primaryChunks.map((chunk) => chunk.article_id));
  const verifiedCitations = (parsed.citations || []).filter((citation) =>
    retrievedArticleIdsSet.has(citation.id),
  );
  const seenCitationIds = new Set();
  const dedupedCitations = verifiedCitations.filter((citation) =>
    seenCitationIds.has(citation.id) ? false : (seenCitationIds.add(citation.id), true),
  );

  return {
    question: item.question,
    project_name: item.project_name,
    cited_article_ids: dedupedCitations.map((citation) => citation.id),
    similarity_top1: rawChunkList?.[0] ? displayScore(rawChunkList[0]) : null,
    retrieved_chunks: `${retrievedChunkCountRaw}→${retrievedChunkCountFiltered}`,
    prompt_chunks: promptChunkLabel,
    neighbor_chunk_count: neighborChunkCount,
    retrieved_articles: retrievedArticles,
    retrieved_articles_filtered: retrievedArticlesFiltered,
    both_chunk_ratio: calculateBothChunkRatio(primaryChunks),
    confidence: parsed.confidence || "low",
    no_basis: Boolean(parsed.no_basis ?? noBasis),
    answer_preview: previewAnswer(parsed.answer),
  };
}

/** UUID 缩写：取前 8 位，方便表格阅读 */
function shortId(id) {
  return String(id || "").slice(0, 8);
}

/** 把召回文章列表渲染为紧凑字符串：a1b2c3d4(0.66×3) e5f6g7h8(0.55×2) */
function formatArticles(articles) {
  if (!articles?.length) return "—";
  return articles
    .slice(0, 6)
    .map(
      (a) =>
        `${shortId(a.id)}(${a.top_similarity.toFixed(2)}×${a.chunk_count}, ${sourceLabel(
          a.source,
        )})`,
    )
    .join(" ") + (articles.length > 6 ? ` …+${articles.length - 6}` : "");
}

/** 短 ID 列表 */
function formatCitedIds(ids) {
  if (!ids?.length) return "—";
  return ids.map(shortId).join(", ");
}

function calculateBothChunkRatio(chunks) {
  if (!chunks.length) return 0;
  return chunks.filter((chunk) => chunk.source === "both").length / chunks.length;
}

function summarizeResults(results) {
  const total = results.length;
  const noBasisCount = results.filter((r) => r.no_basis).length;
  const highConf = results.filter((r) => r.confidence === "high").length;
  const avgRetrievedRaw =
    results.reduce((sum, r) => sum + Number(String(r.retrieved_chunks).split("→")[0] || 0), 0) /
    Math.max(total, 1);
  const avgRetrievedFiltered =
    results.reduce((sum, r) => sum + Number(String(r.retrieved_chunks).split("→")[1] || 0), 0) /
    Math.max(total, 1);
  const avgArticlesFiltered =
    results.reduce((sum, r) => sum + (r.retrieved_articles_filtered?.length || 0), 0) /
    Math.max(total, 1);
  const avgCited =
    results.reduce((sum, r) => sum + (r.cited_article_ids?.length || 0), 0) /
    Math.max(total, 1);
  const filteredChunkTotal = results.reduce(
    (sum, r) => sum + Number(String(r.retrieved_chunks).split("→")[1] || 0),
    0,
  );
  const bothChunkTotal = results.reduce(
    (sum, r) =>
      sum + Math.round((r.both_chunk_ratio || 0) * Number(String(r.retrieved_chunks).split("→")[1] || 0)),
    0,
  );
  const avgNeighborChunks =
    results.reduce((sum, r) => sum + (r.neighbor_chunk_count || 0), 0) / Math.max(total, 1);

  return {
    total,
    noBasisCount,
    highConf,
    avgRetrievedRaw,
    avgRetrievedFiltered,
    avgArticlesFiltered,
    avgCited,
    filteredChunkTotal,
    bothChunkTotal,
    bothChunkRatio: filteredChunkTotal > 0 ? bothChunkTotal / filteredChunkTotal : 0,
    avgNeighborChunks,
  };
}

function loadVectorComparison(results) {
  if (!USE_HYBRID || !fs.existsSync("/tmp/rag-baseline-vector.json")) return null;
  const vector = JSON.parse(fs.readFileSync("/tmp/rag-baseline-vector.json", "utf8"));
  const deltas = results.map((result, index) => {
    const vectorCount = vector.results?.[index]?.retrieved_article_count_filtered ?? 0;
    const hybridCount = result.retrieved_articles_filtered?.length || 0;
    return hybridCount - vectorCount;
  });
  return {
    totalDelta: deltas.reduce((sum, delta) => sum + delta, 0),
    avgDelta: deltas.reduce((sum, delta) => sum + delta, 0) / Math.max(deltas.length, 1),
    moreCount: deltas.filter((delta) => delta > 0).length,
    fewerCount: deltas.filter((delta) => delta < 0).length,
  };
}

function formatVectorComparison(comparison) {
  if (!USE_HYBRID) return "—（vector-only）";
  if (!comparison) return "—（缺少 /tmp/rag-baseline-vector.json）";
  const totalPrefix = comparison.totalDelta > 0 ? "+" : "";
  const avgPrefix = comparison.avgDelta > 0 ? "+" : "";
  return `总计 ${totalPrefix}${comparison.totalDelta}，均值 ${avgPrefix}${comparison.avgDelta.toFixed(
    1,
  )}，更多 ${comparison.moreCount}/${QUESTIONS.length}，减少 ${comparison.fewerCount}/${
    QUESTIONS.length
  }`;
}

function renderResults(results, summary, collectedAt, vectorComparison) {
  return `## Phase 0.3 Baseline 评测

采集时间：${collectedAt}
采集方式：CLI 复刻 \`/api/knowledge/ask\` 的检索、LLM 生成和 citation 校验流程；检索模式：${SEARCH_MODE}；未写入 \`knowledge_ai_answers\`，避免 baseline 评测污染线上问答统计。

### 汇总指标（Phase 1 改动后用于横向对比）

| 指标 | 数值 |
| --- | --- |
| 题目总数 | ${summary.total} |
| 命中（no_basis = false）| ${summary.total - summary.noBasisCount} / ${summary.total} |
| LLM 自评 high | ${summary.highConf} / ${summary.total} |
| 平均召回 chunk 数（过滤前→后）| ${summary.avgRetrievedRaw.toFixed(1)} → ${summary.avgRetrievedFiltered.toFixed(1)} |
| 平均召回文章数（过滤后） | ${summary.avgArticlesFiltered.toFixed(1)} |
| 平均引用文章数 | ${summary.avgCited.toFixed(1)} |
| Hybrid source=both chunk 占比 | ${(summary.bothChunkRatio * 100).toFixed(1)}% |
| Hybrid 比 Vector-only 多召回 distinct articles | ${formatVectorComparison(vectorComparison)} |${
  USE_NEIGHBOR_EXPAND
    ? `\n| 邻居扩展平均补充 chunk 数（window=${NEIGHBOR_WINDOW_SIZE}） | ${summary.avgNeighborChunks.toFixed(1)} |`
    : ""
}

> 字段说明：\`retrieved_articles\` 表示按 article_id 聚合后的召回结果，格式 \`<short_id>(<top_score>×<chunk_count>, <source>)\`；source 中 \`both\` 代表向量与 FTS 两路都命中，是更强的相关性信号。\`retrieved_chunks\` 显示 \`过滤前→过滤后\` 的 chunk 总数（过滤条件：SQL 相似度 ≥ ${MIN_KNOWLEDGE_SIMILARITY} 且客户端 chunk 长度 ≥ ${MIN_CHUNK_CONTENT_LEN}）。\`prompt_chunks\` 列在邻居扩展开启时显示 \`<primary>+<neighbors>\`，表示 LLM 实际看到的素材数；citation 校验仍只用 primary，不受邻居影响。

### 逐题详情

${mdTable(
  [
    "question",
    "project_name",
    "retrieved_chunks",
    "prompt_chunks",
    "retrieved_articles_filtered",
    "cited_article_ids",
    "similarity_top1",
    "confidence",
    "no_basis",
    "answer_preview",
  ],
  results.map((result) => [
    result.question,
    result.project_name,
    result.retrieved_chunks ?? "",
    result.prompt_chunks ?? "",
    formatArticles(result.retrieved_articles_filtered),
    formatCitedIds(result.cited_article_ids),
    result.similarity_top1 == null ? "" : Number(result.similarity_top1).toFixed(4),
    result.confidence,
    result.no_basis ? "true" : "false",
    result.answer_preview,
  ]),
)}
`;
}

function writeBaselineJson(results, summary, collectedAt, vectorComparison) {
  fs.writeFileSync(
    `/tmp/rag-baseline-${SEARCH_MODE}.json`,
    JSON.stringify(
      {
        mode: SEARCH_MODE,
        collected_at: collectedAt,
        summary,
        vector_comparison: vectorComparison,
        results: results.map((result) => ({
          question: result.question,
          project_name: result.project_name,
          retrieved_chunks: result.retrieved_chunks,
          prompt_chunks: result.prompt_chunks ?? null,
          neighbor_chunk_count: result.neighbor_chunk_count ?? 0,
          retrieved_article_count_filtered: result.retrieved_articles_filtered?.length || 0,
          retrieved_articles_filtered: result.retrieved_articles_filtered,
          cited_article_count: result.cited_article_ids?.length || 0,
          confidence: result.confidence,
          no_basis: result.no_basis,
          both_chunk_ratio: result.both_chunk_ratio || 0,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function upsertSnapshotSection(section) {
  const marker = "## Phase 0.3 Baseline 评测";
  const cleanSection = section.trimEnd();
  const current = fs.existsSync(SNAPSHOT_PATH)
    ? fs.readFileSync(SNAPSHOT_PATH, "utf8")
    : "# RAG Baseline Snapshot\n";
  const index = current.indexOf(marker);
  const next = index >= 0
    ? `${current.slice(0, index).trimEnd()}\n\n${cleanSection}\n`
    : `${current.trimEnd()}\n\n${cleanSection}\n`;
  fs.writeFileSync(SNAPSHOT_PATH, next, "utf8");
}

loadEnv();

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const results = [];
for (const item of QUESTIONS) {
  try {
    results.push(await askDirect(supabase, item));
  } catch (error) {
    results.push({
      question: item.question,
      project_name: item.project_name,
      cited_article_ids: [],
      similarity_top1: null,
      confidence: "eval_error",
      no_basis: true,
      answer_preview: error instanceof Error ? error.message : String(error),
    });
  }
}

const collectedAt = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "full",
  timeStyle: "medium",
  timeZone: "Asia/Shanghai",
}).format(new Date());
const summary = summarizeResults(results);
const vectorComparison = loadVectorComparison(results);
const rendered = renderResults(results, summary, collectedAt, vectorComparison);

writeBaselineJson(results, summary, collectedAt, vectorComparison);
if (!USE_HYBRID) {
  upsertSnapshotSection(rendered);
}
console.log(rendered);
