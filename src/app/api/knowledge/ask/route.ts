import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, createEmbedding, isAIConfigured, MIN_KNOWLEDGE_SIMILARITY } from "@/lib/ai";
import { hybridSearchChunks, isHybridEnabled } from "@/lib/rag/hybrid-search";
import type { KnowledgeAskResponse } from "@/types";

const MAX_QUESTION_LEN = 500;
const MATCH_COUNT = 12;
const MIN_CHUNK_CONTENT_LEN = 50;

export async function POST(req: NextRequest) {
  // ── 鉴权 ────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // ── AI 配置检查 ───────────────────────────────────────────────────────────
  if (!isAIConfigured()) {
    return NextResponse.json({ error: "AI 服务未配置" }, { status: 503 });
  }

  // ── 解析请求体 ────────────────────────────────────────────────────────────
  let body: { question?: string; project_name?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const question = (body.question ?? "").trim().slice(0, MAX_QUESTION_LEN);
  if (!question) {
    return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
  }
  const projectName = body.project_name?.trim() || null;

  type RawChunk = {
    chunk_id: string;
    article_id: string;
    article_title: string;
    module: string | null;
    project_name: string | null;
    chunk_index: number;
    chunk_content: string;
  };

  // ── Step 1/2：检索相关知识块（默认 hybrid，可用 RAG_HYBRID_ENABLED=false 回退）────
  const admin = createAdminClient();
  let rawChunks: RawChunk[] = [];

  if (isHybridEnabled()) {
    rawChunks = await hybridSearchChunks(question, {
      matchCount: MATCH_COUNT,
      onlyApproved: true,
      filterProjectName: projectName,
      minSimilarity: MIN_KNOWLEDGE_SIMILARITY,
      adminClient: admin,
      candidatesPerSource: MATCH_COUNT * 3,
    });
  } else {
    const queryEmbedding = await createEmbedding(question);
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "向量化失败，请稍后重试" },
        { status: 503 }
      );
    }

    const { data, error: rpcErr } = await admin.rpc(
      "match_knowledge_chunks_v2",
      {
        query_embedding: queryEmbedding,
        match_count: MATCH_COUNT,
        only_approved: true,
        filter_project_name: projectName,
        min_similarity: MIN_KNOWLEDGE_SIMILARITY,
      }
    );

    if (rpcErr) {
      console.error("[ask] match_knowledge_chunks_v2 error:", rpcErr.message);
      return NextResponse.json({ error: "检索失败，请稍后重试" }, { status: 503 });
    }

    rawChunks = (data as RawChunk[]) ?? [];
  }

  // similarity / project_name 已在 RPC 层过滤；客户端长度保护与 RPC 的 source of truth 保持一致。
  const chunks = rawChunks.filter(
    (c) => c.chunk_content.trim().length >= MIN_CHUNK_CONTENT_LEN
  );

  // ── Step 3：构造 RAG Prompt ───────────────────────────────────────────────
  const noBasis = chunks.length === 0;

  let contextSection = "";
  if (!noBasis) {
    contextSection = chunks
      .map(
        (c, i) =>
          `【知识片段 ${i + 1}】来源：《${c.article_title}》（ID: ${c.article_id}）\n${c.chunk_content}`
      )
      .join("\n\n---\n\n");
  }

  const systemPrompt = `你是项目知识库 AI 助手。请严格依据以下知识库片段回答用户问题。

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

  const result = await chatCompletion(systemPrompt, `用户问题：${question}`, {
    maxTokens: 2048,
    disableThinking: true,
  });

  if (!result) {
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 503 });
  }

  // ── Step 4：解析 LLM 返回的 JSON ─────────────────────────────────────────
  let parsed: {
    answer: string;
    citations: { id: string; title: string }[];
    confidence: string;
    no_basis: boolean;
    risk_notes: string | null;
    actionable: boolean;
  };
  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[ask] LLM JSON parse failed, raw:", result.slice(0, 300));
    return NextResponse.json({ error: "AI 返回格式异常，请稍后重试" }, { status: 503 });
  }

  // ── Step 4.5：citations 二次校验（过滤 LLM 幻觉引用）────────────────────
  // 只保留真实出现在检索结果中的 article_id，消除 LLM 伪造引用
  const retrievedArticleIds = new Set(chunks.map((c) => c.article_id));
  const verifiedCitations = (parsed.citations ?? []).filter((c) => retrievedArticleIds.has(c.id));
  const seenCitationIds = new Set<string>();
  const dedupedCitations = verifiedCitations.filter((c) =>
    seenCitationIds.has(c.id) ? false : (seenCitationIds.add(c.id), true)
  );

  // ── Step 5：持久化问答日志 ────────────────────────────────────────────────
  const citedArticleIds = dedupedCitations.map((c) => c.id).filter(Boolean);
  const citedChunkIds = chunks.map((c) => c.chunk_id);

  await admin.from("knowledge_ai_answers").insert({
    question,
    answer: parsed.answer,
    project_name: projectName,
    cited_article_ids: citedArticleIds,
    cited_chunk_ids: citedChunkIds,
    confidence: parsed.confidence ?? null,
    user_id: user.id,
  });

  // ── Step 6：返回结构化响应 ────────────────────────────────────────────────
  const response: KnowledgeAskResponse = {
    answer: parsed.answer,
    citations: dedupedCitations,
    confidence: (parsed.confidence as KnowledgeAskResponse["confidence"]) ?? "low",
    no_basis: parsed.no_basis ?? noBasis,
    risk_notes: parsed.risk_notes ?? null,
    actionable: parsed.actionable ?? false,
  };

  return NextResponse.json(response);
}
