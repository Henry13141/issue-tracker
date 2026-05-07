"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { KnowledgeDecision, KnowledgeDecisionStatus, KnowledgeDecisionWithRelations } from "@/types";

const VALID_DECISION_STATUSES: KnowledgeDecisionStatus[] = ["draft", "confirmed", "superseded"];

export type KnowledgeDecisionFilters = {
  q?: string;
  status?: KnowledgeDecisionStatus | null;
  project_name?: string | null;
  module?: string | null;
  page?: number;
  pageSize?: number;
};

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------
export async function getKnowledgeDecisions(filters: KnowledgeDecisionFilters = {}): Promise<{
  decisions: KnowledgeDecisionWithRelations[];
  total: number;
}> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { decisions: [], total: 0 };

  const { q, status, project_name, module, page = 1, pageSize = 20 } = filters;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("knowledge_decisions")
    .select(
      `*,
       article:knowledge_articles!knowledge_decisions_article_id_fkey(id, title),
       issue:issues!knowledge_decisions_issue_id_fkey(id, title),
       decider:users!knowledge_decisions_decided_by_fkey(id, name),
       creator:users!knowledge_decisions_created_by_fkey(id, name)`,
      { count: "exact" }
    )
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (q) query = query.ilike("title", `%${q}%`);
  if (status) query = query.eq("status", status);
  if (project_name) query = query.eq("project_name", project_name);
  if (module) query = query.eq("module", module);

  const { data, error, count } = await query;
  if (error) {
    console.error("[knowledge-decisions] getKnowledgeDecisions error:", error.message);
    return { decisions: [], total: 0 };
  }

  return {
    decisions: (data ?? []) as KnowledgeDecisionWithRelations[],
    total: count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 单条详情
// ---------------------------------------------------------------------------
export async function getKnowledgeDecision(id: string): Promise<KnowledgeDecisionWithRelations | null> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("knowledge_decisions")
    .select(
      `*,
       article:knowledge_articles!knowledge_decisions_article_id_fkey(id, title),
       issue:issues!knowledge_decisions_issue_id_fkey(id, title),
       decider:users!knowledge_decisions_decided_by_fkey(id, name),
       creator:users!knowledge_decisions_created_by_fkey(id, name)`
    )
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as KnowledgeDecisionWithRelations;
}

// ---------------------------------------------------------------------------
// 创建
// ---------------------------------------------------------------------------
export type CreateKnowledgeDecisionInput = {
  title: string;
  project_name?: string;
  module?: string;
  background?: string;
  decision: string;
  reason?: string;
  impact?: string;
  article_id?: string;
  issue_id?: string;
  decided_by?: string;
  decided_at?: string;
};

export async function createKnowledgeDecision(
  input: CreateKnowledgeDecisionInput
): Promise<{ id: string } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  if (!input.title?.trim()) return { error: "决策标题不能为空" };
  if (!input.decision?.trim()) return { error: "决策内容不能为空" };

  const { data, error } = await supabase
    .from("knowledge_decisions")
    .insert({
      title: input.title.trim(),
      project_name: input.project_name || null,
      module: input.module || null,
      background: input.background || null,
      decision: input.decision.trim(),
      reason: input.reason || null,
      impact: input.impact || null,
      status: "draft",
      article_id: input.article_id || null,
      issue_id: input.issue_id || null,
      decided_by: input.decided_by || null,
      decided_at: input.decided_at || null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  revalidatePath("/knowledge/decisions");
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// 更新
// ---------------------------------------------------------------------------
export type UpdateKnowledgeDecisionInput = Partial<CreateKnowledgeDecisionInput> & {
  status?: KnowledgeDecisionStatus;
};

export async function updateKnowledgeDecision(
  id: string,
  input: UpdateKnowledgeDecisionInput
): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const { data: current, error: fetchErr } = await supabase
    .from("knowledge_decisions")
    .select("id, created_by")
    .eq("id", id)
    .single();

  if (fetchErr || !current) return { error: "决策记录不存在" };

  const isAdmin = user.role === "admin";
  const isOwner = (current as KnowledgeDecision).created_by === user.id;
  if (!isAdmin && !isOwner) return { error: "无权限编辑" };

  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.project_name !== undefined) payload.project_name = input.project_name || null;
  if (input.module !== undefined) payload.module = input.module || null;
  if (input.background !== undefined) payload.background = input.background || null;
  if (input.decision !== undefined) payload.decision = input.decision.trim();
  if (input.reason !== undefined) payload.reason = input.reason || null;
  if (input.impact !== undefined) payload.impact = input.impact || null;
  if (input.article_id !== undefined) payload.article_id = input.article_id || null;
  if (input.issue_id !== undefined) payload.issue_id = input.issue_id || null;
  if (input.decided_by !== undefined) payload.decided_by = input.decided_by || null;
  if (input.decided_at !== undefined) payload.decided_at = input.decided_at || null;
  if (input.status !== undefined && VALID_DECISION_STATUSES.includes(input.status)) {
    payload.status = input.status;
  }

  const { error } = await supabase.from("knowledge_decisions").update(payload).eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/knowledge/decisions");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 查询与某知识条目关联的决策（供知识详情页使用）
// ---------------------------------------------------------------------------
export async function getDecisionsByArticle(articleId: string): Promise<KnowledgeDecisionWithRelations[]> {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("knowledge_decisions")
    .select(
      `*,
       issue:issues!knowledge_decisions_issue_id_fkey(id, title),
       decider:users!knowledge_decisions_decided_by_fkey(id, name),
       creator:users!knowledge_decisions_created_by_fkey(id, name)`
    )
    .eq("article_id", articleId)
    .order("updated_at", { ascending: false });

  if (error) return [];
  return (data ?? []) as KnowledgeDecisionWithRelations[];
}
