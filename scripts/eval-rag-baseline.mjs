import fs from "node:fs";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const REPO = "/Users/haoyi/issue-tracker";
const SNAPSHOT_PATH = `${REPO}/scripts/RAG_BASELINE_SNAPSHOT.md`;
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
const ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";
const MIN_KNOWLEDGE_SIMILARITY = 0.25;
const MATCH_COUNT = 5;

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

async function askDirect(supabase, item) {
  const queryEmbedding = await createEmbedding(item.question);
  const { data: rawChunks, error } = await supabase.rpc("match_knowledge_chunks", {
    query_embedding: queryEmbedding,
    match_count: MATCH_COUNT,
    only_approved: true,
  });

  if (error) throw new Error(`match_knowledge_chunks failed: ${error.message}`);

  const chunks = (rawChunks || []).filter(
    (chunk) =>
      chunk.similarity >= MIN_KNOWLEDGE_SIMILARITY &&
      String(chunk.chunk_content || "").trim().length >= 100,
  );
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
      confidence: "parse_error",
      no_basis: true,
      answer_preview: `parse_error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  const retrievedArticleIds = new Set(chunks.map((chunk) => chunk.article_id));
  const verifiedCitations = (parsed.citations || []).filter((citation) =>
    retrievedArticleIds.has(citation.id),
  );

  return {
    question: item.question,
    project_name: item.project_name,
    cited_article_ids: verifiedCitations.map((citation) => citation.id),
    similarity_top1: rawChunks?.[0]?.similarity ?? null,
    confidence: parsed.confidence || "low",
    no_basis: Boolean(parsed.no_basis ?? noBasis),
    answer_preview: previewAnswer(parsed.answer),
  };
}

function renderResults(results) {
  const collectedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date());

  return `## Phase 0.3 Baseline 评测

采集时间：${collectedAt}
采集方式：CLI 复刻 \`/api/knowledge/ask\` 的检索、LLM 生成和 citation 校验流程；未写入 \`knowledge_ai_answers\`，避免 baseline 评测污染线上问答统计。

${mdTable(
  [
    "question",
    "project_name",
    "cited_article_ids",
    "similarity_top1",
    "confidence",
    "no_basis",
    "answer_preview",
  ],
  results.map((result) => [
    result.question,
    result.project_name,
    result.cited_article_ids.join(", "),
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
