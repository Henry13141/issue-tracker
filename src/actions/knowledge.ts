"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { chatCompletion, createEmbedding, isAIConfigured } from "@/lib/ai";
import type {
  KnowledgeArticle,
  KnowledgeArticleWithRelations,
  KnowledgeCategory,
  KnowledgeIssueLinkWithRelations,
  KnowledgeRelationType,
  KnowledgeReviewRequest,
  KnowledgeStatus,
  KnowledgeVersion,
} from "@/types";

// ---------------------------------------------------------------------------
// 类型守卫
// ---------------------------------------------------------------------------
const VALID_STATUSES: KnowledgeStatus[] = ["draft", "reviewing", "approved", "deprecated", "archived"];
const ADMIN_ONLY_STATUSES: KnowledgeStatus[] = ["approved", "deprecated", "archived"];
const VALID_CATEGORIES: KnowledgeCategory[] = [
  "project_overview", "gameplay_rule", "numeric_system", "ui_spec",
  "technical_spec", "hardware_protocol", "decision_record", "test_acceptance",
  "troubleshooting", "operation_guide", "finance_ops", "ai_workflow",
];
const VALID_RELATION_TYPES: KnowledgeRelationType[] = [
  "reference", "spec_for", "acceptance_for", "implements", "blocks", "result_from",
];

function isValidStatus(v: unknown): v is KnowledgeStatus {
  return typeof v === "string" && VALID_STATUSES.includes(v as KnowledgeStatus);
}
function isValidCategory(v: unknown): v is KnowledgeCategory {
  return typeof v === "string" && VALID_CATEGORIES.includes(v as KnowledgeCategory);
}

// ---------------------------------------------------------------------------
// 列表筛选参数
// ---------------------------------------------------------------------------
export type KnowledgeFilters = {
  q?: string;
  category?: KnowledgeCategory | null;
  module?: string | null;
  status?: KnowledgeStatus | null;
  project_name?: string | null;
  page?: number;
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// 列表查询
// ---------------------------------------------------------------------------
export async function getKnowledgeArticles(filters: KnowledgeFilters = {}): Promise<{
  articles: KnowledgeArticleWithRelations[];
  total: number;
}> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { articles: [], total: 0 };

  const { q, category, module, status, project_name, page = 1, pageSize = 20 } = filters;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("knowledge_articles")
    .select(
      `*, 
       owner:users!knowledge_articles_owner_id_fkey(id, name, avatar_url),
       creator:users!knowledge_articles_created_by_fkey(id, name),
       approver:users!knowledge_articles_approved_by_fkey(id, name),
       linked_issue_count:knowledge_issue_links(count)`,
      { count: "exact" }
    )
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (q) {
    query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
  }
  if (category) query = query.eq("category", category);
  if (module) query = query.eq("module", module);
  if (status) query = query.eq("status", status);
  if (project_name) query = query.eq("project_name", project_name);

  const { data, error, count } = await query;
  if (error) {
    console.error("[knowledge] getKnowledgeArticles error:", error.message);
    return { articles: [], total: 0 };
  }

  const articles = (data ?? []).map((row) => {
    const r = row as KnowledgeArticleWithRelations & { linked_issue_count?: { count: number }[] };
    const countArr = r.linked_issue_count as { count: number }[] | undefined;
    return {
      ...r,
      linked_issue_count: countArr?.[0]?.count ?? 0,
    } as KnowledgeArticleWithRelations;
  });

  return { articles, total: count ?? 0 };
}

// ---------------------------------------------------------------------------
// 单条详情
// ---------------------------------------------------------------------------
export async function getKnowledgeArticle(id: string): Promise<KnowledgeArticleWithRelations | null> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("knowledge_articles")
    .select(
      `*,
       owner:users!knowledge_articles_owner_id_fkey(id, name, avatar_url),
       creator:users!knowledge_articles_created_by_fkey(id, name),
       approver:users!knowledge_articles_approved_by_fkey(id, name)`
    )
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as KnowledgeArticleWithRelations;
}

// ---------------------------------------------------------------------------
// 创建知识条目（status 强制为 draft）
// ---------------------------------------------------------------------------
export type CreateKnowledgeArticleInput = {
  title: string;
  project_name?: string;
  category: KnowledgeCategory;
  module?: string;
  version?: string;
  summary?: string;
  content: string;
  owner_id?: string;
  is_pinned?: boolean;
  is_ai_searchable?: boolean;
};

export async function createKnowledgeArticle(
  input: CreateKnowledgeArticleInput
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  if (!input.title?.trim()) return { error: "标题不能为空" };
  if (!input.content?.trim()) return { error: "正文不能为空" };
  if (!isValidCategory(input.category)) return { error: "分类无效" };

  const { data, error } = await supabase
    .from("knowledge_articles")
    .insert({
      title: input.title.trim(),
      project_name: input.project_name || null,
      category: input.category,
      module: input.module || null,
      version: input.version || "v1.0",
      summary: input.summary || null,
      content: input.content.trim(),
      owner_id: input.owner_id || user.id,
      created_by: user.id,
      updated_by: user.id,
      status: "draft",
      is_pinned: input.is_pinned ?? false,
      is_ai_searchable: input.is_ai_searchable ?? true,
      source_type: "manual",
    })
    .select("id")
    .single();

  if (error) {
    console.error("[knowledge] createKnowledgeArticle error:", error.message);
    return { error: error.message };
  }

  revalidatePath("/knowledge");
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// 更新知识条目（approved 状态修改时先存版本）
// ---------------------------------------------------------------------------
export type UpdateKnowledgeArticleInput = Partial<CreateKnowledgeArticleInput> & {
  change_note?: string;
};

export async function updateKnowledgeArticle(
  id: string,
  input: UpdateKnowledgeArticleInput
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  // 读取当前文章（验证权限 + 存版本用）
  const { data: current, error: fetchErr } = await supabase
    .from("knowledge_articles")
    .select("id, title, summary, content, version, status, created_by, owner_id")
    .eq("id", id)
    .single();

  if (fetchErr || !current) return { error: "知识条目不存在" };

  const isAdmin = user.role === "admin";
  const isOwner = current.created_by === user.id || current.owner_id === user.id;
  if (!isAdmin && !isOwner) return { error: "无权限编辑" };

  // approved 状态修改时先存版本历史
  if (current.status === "approved") {
    await supabase.from("knowledge_versions").insert({
      article_id: id,
      version: current.version,
      title: current.title,
      summary: current.summary,
      content: current.content,
      change_note: input.change_note || "内容更新",
      created_by: user.id,
    });
  }

  const updatePayload: Record<string, unknown> = { updated_by: user.id };
  if (input.title !== undefined) updatePayload.title = input.title.trim();
  if (input.project_name !== undefined) updatePayload.project_name = input.project_name || null;
  if (input.category !== undefined) {
    if (!isValidCategory(input.category)) return { error: "分类无效" };
    updatePayload.category = input.category;
  }
  if (input.module !== undefined) updatePayload.module = input.module || null;
  if (input.version !== undefined) updatePayload.version = input.version;
  if (input.summary !== undefined) updatePayload.summary = input.summary || null;
  if (input.content !== undefined) updatePayload.content = input.content.trim();
  if (input.owner_id !== undefined) updatePayload.owner_id = input.owner_id || null;
  if (input.is_pinned !== undefined) updatePayload.is_pinned = input.is_pinned;
  if (input.is_ai_searchable !== undefined) updatePayload.is_ai_searchable = input.is_ai_searchable;

  const { error } = await supabase
    .from("knowledge_articles")
    .update(updatePayload)
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 更新状态（admin only）
// ---------------------------------------------------------------------------
export async function updateKnowledgeStatus(
  id: string,
  status: KnowledgeStatus
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role !== "admin") return { error: "仅管理员可操作" };
  if (!isValidStatus(status)) return { error: "状态值无效" };

  const updatePayload: Record<string, unknown> = {
    status,
    updated_by: user.id,
  };
  if (status === "approved") {
    updatePayload.approved_by = user.id;
    updatePayload.approved_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from("knowledge_articles")
    .update(updatePayload)
    .eq("id", id);

  if (error) return { error: error.message };

  // approved 时异步触发向量化（非阻塞，失败不影响状态更新结果）
  if (status === "approved") {
    embedKnowledgeArticle(id).catch((e) =>
      console.error("[knowledge] embedKnowledgeArticle failed:", e)
    );
  }

  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 提交审核
// ---------------------------------------------------------------------------
export async function submitForReview(
  articleId: string,
  reviewNote?: string
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  // 将文章状态改为 reviewing
  const { error: statusErr } = await supabase
    .from("knowledge_articles")
    .update({ status: "reviewing", updated_by: user.id })
    .eq("id", articleId)
    .in("status", ["draft"]);

  if (statusErr) return { error: statusErr.message };

  const { error } = await supabase.from("knowledge_review_requests").insert({
    article_id: articleId,
    requester_id: user.id,
    status: "pending",
    review_note: reviewNote || null,
  });

  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${articleId}`);
  revalidatePath("/knowledge/reviews");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 处理审核申请（admin）
// ---------------------------------------------------------------------------
export async function handleReviewRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reviewNote?: string
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  if (user.role !== "admin") return { error: "仅管理员可操作" };

  const { data: req, error: fetchErr } = await supabase
    .from("knowledge_review_requests")
    .select("id, article_id")
    .eq("id", requestId)
    .eq("status", "pending")
    .single();

  if (fetchErr || !req) return { error: "审核请求不存在或已处理" };

  const { error: reqErr } = await supabase
    .from("knowledge_review_requests")
    .update({ status: decision, reviewer_id: user.id, review_note: reviewNote || null, reviewed_at: new Date().toISOString() })
    .eq("id", requestId);

  if (reqErr) return { error: reqErr.message };

  if (decision === "approved") {
    await updateKnowledgeStatus(req.article_id as string, "approved");
  } else {
    // 拒绝则退回 draft
    await supabase
      .from("knowledge_articles")
      .update({ status: "draft", updated_by: user.id })
      .eq("id", req.article_id);
  }

  revalidatePath("/knowledge/reviews");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 版本历史
// ---------------------------------------------------------------------------
export async function getKnowledgeVersions(articleId: string): Promise<KnowledgeVersion[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("knowledge_versions")
    .select(`*, creator:users!knowledge_versions_created_by_fkey(id, name)`)
    .eq("article_id", articleId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as KnowledgeVersion[];
}

// ---------------------------------------------------------------------------
// 知识条目关联的 Issue 列表
// ---------------------------------------------------------------------------
export async function getArticleIssueLinks(articleId: string): Promise<KnowledgeIssueLinkWithRelations[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("knowledge_issue_links")
    .select(`*, issue:issues!knowledge_issue_links_issue_id_fkey(id, title, status, priority)`)
    .eq("article_id", articleId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as KnowledgeIssueLinkWithRelations[];
}

// ---------------------------------------------------------------------------
// Issue 关联的知识列表（供 Issue 详情页使用）
// ---------------------------------------------------------------------------
export async function getIssueKnowledgeLinks(issueId: string): Promise<KnowledgeIssueLinkWithRelations[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("knowledge_issue_links")
    .select(`*, article:knowledge_articles!knowledge_issue_links_article_id_fkey(id, title, status, category)`)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as KnowledgeIssueLinkWithRelations[];
}

// ---------------------------------------------------------------------------
// 添加关联
// ---------------------------------------------------------------------------
export async function addKnowledgeIssueLink(
  articleId: string,
  issueId: string,
  relationType: KnowledgeRelationType = "reference"
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  if (!VALID_RELATION_TYPES.includes(relationType)) return { error: "关联类型无效" };

  const { error } = await supabase.from("knowledge_issue_links").insert({
    article_id: articleId,
    issue_id: issueId,
    relation_type: relationType,
    created_by: user.id,
  });

  if (error) {
    if (error.code === "23505") return { error: "已存在该关联" };
    return { error: error.message };
  }

  revalidatePath(`/knowledge/${articleId}`);
  revalidatePath(`/issues/${issueId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 移除关联
// ---------------------------------------------------------------------------
export async function removeKnowledgeIssueLink(
  linkId: string
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const { error } = await supabase
    .from("knowledge_issue_links")
    .delete()
    .eq("id", linkId);

  if (error) return { error: error.message };

  revalidatePath("/knowledge");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 审核列表（admin）
// ---------------------------------------------------------------------------
export async function getReviewRequests(): Promise<KnowledgeReviewRequest[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return [];

  const { data, error } = await supabase
    .from("knowledge_review_requests")
    .select(
      `*,
       article:knowledge_articles!knowledge_review_requests_article_id_fkey(id, title, status, category),
       requester:users!knowledge_review_requests_requester_id_fkey(id, name),
       reviewer:users!knowledge_review_requests_reviewer_id_fkey(id, name)`
    )
    .order("created_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as KnowledgeReviewRequest[];
}

// ---------------------------------------------------------------------------
// 从已关闭 Issue 生成知识草稿（AI）
// ---------------------------------------------------------------------------
export async function generateKnowledgeDraftFromIssue(
  issueId: string
): Promise<{ id: string } | { error: string }> {
  if (!isAIConfigured()) return { error: "AI 未配置" };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const [issueRes, updatesRes] = await Promise.all([
    supabase
      .from("issues")
      .select("id, title, description, status, priority, category, module, resolved_at, closed_at")
      .eq("id", issueId)
      .single(),
    supabase
      .from("issue_updates")
      .select("content, created_at, user:users!issue_updates_user_id_fkey(name)")
      .eq("issue_id", issueId)
      .eq("is_system_generated", false)
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  if (issueRes.error || !issueRes.data) return { error: "Issue 不存在" };
  const issue = issueRes.data;

  const rawUpdates = (updatesRes.data ?? []) as unknown as {
    content: string;
    created_at: string;
    user: { name: string } | { name: string }[] | null;
  }[];
  const updates = rawUpdates.map((r) => ({
    content: r.content,
    userName: Array.isArray(r.user) ? r.user[0]?.name ?? "未知" : r.user?.name ?? "未知",
  }));

  const contextLines = [
    `Issue 标题：${issue.title}`,
    `描述：${issue.description || "无"}`,
    `状态：${issue.status}`,
    `优先级：${issue.priority}`,
    `分类：${issue.category || "未设置"}`,
    `模块：${issue.module || "未设置"}`,
  ];

  if (updates.length > 0) {
    contextLines.push("", "处理过程（最近 15 条进展）：");
    updates.forEach((u) => contextLines.push(`- ${u.userName}：${u.content}`));
  }

  const systemPrompt = `你是项目知识库助手。请根据以下已关闭 Issue 的信息，生成一篇结构化的知识条目草稿。

要求：
1. 用简体中文
2. 返回严格的 JSON，格式如下：
{
  "title": "知识条目标题（简洁准确）",
  "summary": "一句话摘要（50字以内）",
  "category": "troubleshooting",
  "content": "完整 Markdown 正文，包含：## 问题背景 ## 根本原因 ## 解决方案 ## 预防建议"
}
3. category 只能是：project_overview, gameplay_rule, numeric_system, ui_spec, technical_spec, hardware_protocol, decision_record, test_acceptance, troubleshooting, operation_guide, finance_ops, ai_workflow
4. 不要返回 JSON 以外的任何文字`;

  const result = await chatCompletion(systemPrompt, contextLines.join("\n"), {
    maxTokens: 2048,
    disableThinking: true,
  });

  if (!result) return { error: "AI 生成失败" };

  let parsed: { title: string; summary: string; category: string; content: string };
  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return { error: "AI 返回格式解析失败" };
  }

  if (!isValidCategory(parsed.category)) {
    parsed.category = "troubleshooting";
  }

  const { data, error } = await supabase
    .from("knowledge_articles")
    .insert({
      title: parsed.title,
      summary: parsed.summary,
      category: parsed.category as KnowledgeCategory,
      module: issue.module || null,
      content: parsed.content,
      status: "draft",
      source_type: "issue_derived",
      source_ref_id: issueId,
      created_by: user.id,
      updated_by: user.id,
      owner_id: user.id,
      is_ai_searchable: true,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // 自动创建与 Issue 的 result_from 关联
  await supabase.from("knowledge_issue_links").insert({
    article_id: data.id,
    issue_id: issueId,
    relation_type: "result_from",
    created_by: user.id,
  });

  revalidatePath("/knowledge");
  revalidatePath(`/issues/${issueId}`);
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// 辅助：获取所有项目名称（用于筛选）
// ---------------------------------------------------------------------------
export async function getKnowledgeProjectNames(): Promise<string[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data } = await supabase
    .from("knowledge_articles")
    .select("project_name")
    .not("project_name", "is", null)
    .order("project_name");

  const names = new Set<string>();
  (data ?? []).forEach((row: { project_name: string | null }) => {
    if (row.project_name) names.add(row.project_name);
  });
  return Array.from(names);
}

// ---------------------------------------------------------------------------
// 辅助：获取所有模块名称（用于筛选）
// ---------------------------------------------------------------------------
export async function getKnowledgeModules(): Promise<string[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data } = await supabase
    .from("knowledge_articles")
    .select("module")
    .not("module", "is", null)
    .order("module");

  const names = new Set<string>();
  (data ?? []).forEach((row: { module: string | null }) => {
    if (row.module) names.add(row.module);
  });
  return Array.from(names);
}

// ---------------------------------------------------------------------------
// 知识文章向量化入库（RAG embedding 准备）
// 读取文章正文，按标题/段落分块，逐块生成 embedding，upsert 到 knowledge_chunks。
// 使用 service_role client 绕过 knowledge_chunks 的 RLS（INSERT 策略仅限 service_role）。
// ---------------------------------------------------------------------------
export async function embedKnowledgeArticle(
  articleId: string
): Promise<{ ok: true; chunks: number } | { error: string }> {
  if (!isAIConfigured()) return { error: "AI 未配置" };

  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const { data: article, error: fetchErr } = await supabase
    .from("knowledge_articles")
    .select("id, title, summary, content, category, module, status, version")
    .eq("id", articleId)
    .single();

  if (fetchErr || !article) return { error: "知识条目不存在" };

  // 分块：以 Markdown 标题（##）或空行分隔，每块上限 600 字
  const chunks = splitIntoChunks(
    [article.summary ? `摘要：${article.summary}` : "", article.content]
      .filter(Boolean)
      .join("\n\n"),
    600
  );

  if (chunks.length === 0) return { error: "文章内容为空，无法向量化" };

  const admin = createAdminClient();

  // 先清除该文章旧有的 chunks，再重新写入（保证幂等）
  await admin.from("knowledge_chunks").delete().eq("article_id", articleId);

  let successCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].trim();
    if (!chunkText) continue;

    const embedding = await createEmbedding(chunkText);
    if (!embedding) {
      console.warn(`[embed] article=${articleId} chunk=${i} embedding failed, skipping`);
      continue;
    }

    const { error: insertErr } = await admin.from("knowledge_chunks").insert({
      article_id: articleId,
      chunk_index: i,
      content: chunkText,
      category: article.category,
      module: article.module ?? null,
      status: article.status,
      version: article.version,
      metadata: { title: article.title, chunk_index: i, total_chunks: chunks.length },
      embedding,
    });

    if (insertErr) {
      console.error(`[embed] article=${articleId} chunk=${i} insert error:`, insertErr.message);
    } else {
      successCount++;
    }
  }

  return { ok: true, chunks: successCount };
}

/**
 * 将长文本按 Markdown 标题（##/###）和空行分块。
 * 每块不超过 maxLen 字符；若单段超长则按 maxLen 截断。
 */
function splitIntoChunks(text: string, maxLen: number): string[] {
  // 先按 Markdown 二级/三级标题拆分
  const sections = text.split(/(?=^#{2,3} )/m).filter(Boolean);
  const result: string[] = [];

  for (const section of sections) {
    if (section.length <= maxLen) {
      result.push(section);
      continue;
    }
    // 段落太长时再按连续空行拆
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

  // 兜底：对超长块强制截断
  return result.flatMap((chunk) => {
    if (chunk.length <= maxLen) return [chunk];
    const parts: string[] = [];
    for (let i = 0; i < chunk.length; i += maxLen) {
      parts.push(chunk.slice(i, i + maxLen));
    }
    return parts;
  });
}

// 让非 admin 知道哪些 status 变更是被允许的 — 移至组件内内联定义，避免从 "use server" 导出非异步值
