import fs from "node:fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/haoyi/issue-tracker";
const SNAPSHOT_PATH = `${REPO}/scripts/RAG_BASELINE_SNAPSHOT.md`;
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
const ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";
const MIN_KNOWLEDGE_SIMILARITY = 0.25;
const MATCH_COUNT = 12;

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
            `【知识片段 ${index + 1}】来源：《${chunk.article_title}》（ID: ${chunk.article_id}）\n${chunk.chunk_content}`,
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

/** 把召回的 chunks 按 article 聚合：返回 [{id, top_similarity, chunk_count}]，按相似度降序 */
function aggregateRetrievedArticles(chunks) {
  const byArticle = new Map();
  for (const chunk of chunks) {
    const existing = byArticle.get(chunk.article_id);
    if (!existing) {
      byArticle.set(chunk.article_id, {
        id: chunk.article_id,
        title: chunk.article_title,
        top_similarity: chunk.similarity,
        chunk_count: 1,
      });
    } else {
      existing.top_similarity = Math.max(existing.top_similarity, chunk.similarity);
      existing.chunk_count += 1;
    }
  }
  return [...byArticle.values()].sort((a, b) => b.top_similarity - a.top_similarity);
}

async function askDirect(supabase, item) {
  const queryEmbedding = await createEmbedding(item.question);
  const { data: rawChunks, error } = await supabase.rpc("match_knowledge_chunks_v2", {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT,
    only_approved: true,
    filter_project_name: item.project_name,
    min_similarity: MIN_KNOWLEDGE_SIMILARITY,
  });

  if (error) throw new Error(`match_knowledge_chunks_v2 failed: ${error.message}`);

  const rawChunkList = rawChunks || [];
  const chunks = rawChunkList.filter(
    (chunk) => String(chunk.chunk_content || "").trim().length >= 100,
  );

  // 召回元信息：过滤前/后 chunk 数 + 按文章聚合（含 top similarity 与 chunk 数）
  const retrievedChunkCountRaw = rawChunkList.length;
  const retrievedChunkCountFiltered = chunks.length;
  const retrievedArticles = aggregateRetrievedArticles(rawChunkList);
  const retrievedArticlesFiltered = aggregateRetrievedArticles(chunks);

  const noBasis = chunks.length === 0;
  const systemPrompt = buildSystemPrompt(chunks, noBasis);
  const completion = await chatCompletion(systemPrompt, `用户问题：${item.question}`);
  let parsed;
  try {
    parsed = parseJsonCompletion(completion);
  } catch (error) {
    return {
      question: item.question,
      project_name: item.project_name,
      cited_article_ids: [],
      similarity_top1: rawChunks?.[0]?.similarity ?? null,
      retrieved_chunks: `${retrievedChunkCountRaw}→${retrievedChunkCountFiltered}`,
      retrieved_articles: retrievedArticles,
      retrieved_articles_filtered: retrievedArticlesFiltered,
      confidence: "parse_error",
      no_basis: true,
      answer_preview: `parse_error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const retrievedArticleIdsSet = new Set(chunks.map((chunk) => chunk.article_id));
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
    similarity_top1: rawChunks?.[0]?.similarity ?? null,
    retrieved_chunks: `${retrievedChunkCountRaw}→${retrievedChunkCountFiltered}`,
    retrieved_articles: retrievedArticles,
    retrieved_articles_filtered: retrievedArticlesFiltered,
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
    .map((a) => `${shortId(a.id)}(${a.top_similarity.toFixed(2)}×${a.chunk_count})`)
    .join(" ") + (articles.length > 6 ? ` …+${articles.length - 6}` : "");
}

/** 短 ID 列表 */
function formatCitedIds(ids) {
  if (!ids?.length) return "—";
  return ids.map(shortId).join(", ");
}

function renderResults(results) {
  const collectedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date());

  // 计算汇总指标，供后续 Phase 1 横向对比
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

  return `## Phase 0.3 Baseline 评测

采集时间：${collectedAt}
采集方式：CLI 复刻 \`/api/knowledge/ask\` 的检索、LLM 生成和 citation 校验流程；未写入 \`knowledge_ai_answers\`，避免 baseline 评测污染线上问答统计。

### 汇总指标（Phase 1 改动后用于横向对比）

| 指标 | 数值 |
| --- | --- |
| 题目总数 | ${total} |
| 命中（no_basis = false）| ${total - noBasisCount} / ${total} |
| LLM 自评 high | ${highConf} / ${total} |
| 平均召回 chunk 数（过滤前→后）| ${avgRetrievedRaw.toFixed(1)} → ${avgRetrievedFiltered.toFixed(1)} |
| 平均召回文章数（过滤后） | ${avgArticlesFiltered.toFixed(1)} |
| 平均引用文章数 | ${avgCited.toFixed(1)} |

> 字段说明：\`retrieved_articles\` 表示按 article_id 聚合后的召回结果，格式 \`<short_id>(<top_similarity>×<chunk_count>)\`；\`retrieved_chunks\` 显示 \`过滤前→过滤后\` 的 chunk 总数（过滤条件：similarity ≥ ${MIN_KNOWLEDGE_SIMILARITY} 且 chunk 长度 ≥ 100）。

### 逐题详情

${mdTable(
  [
    "question",
    "project_name",
    "retrieved_chunks",
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

upsertSnapshotSection(renderResults(results));
console.table(results);
