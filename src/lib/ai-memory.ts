/**
 * AI 组织记忆系统
 *
 * 负责读写 ai_memory 表——AI 对团队成员、模块、组织的累积认知。
 * 所有写操作使用 admin client（绕过 RLS），读操作可使用普通 client。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type MemoryCategory =
  | "member_profile"
  | "module_health"
  | "org_insight"
  | "process_pattern";

export type AIMemoryEntry = {
  id: string;
  category: MemoryCategory;
  subject_key: string | null;
  subject_label: string | null;
  content: string;
  raw_metrics: Record<string, unknown>;
  period_start: string | null;
  period_end: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// 读操作（供 chat assistant 使用）
// ---------------------------------------------------------------------------

/** 读取所有记忆，按 updated_at 降序 */
export async function getAllMemories(): Promise<AIMemoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_memory")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[ai-memory] getAllMemories error:", error.message);
    return [];
  }
  return (data ?? []) as AIMemoryEntry[];
}

/** 读取指定分类的所有记忆 */
export async function getMemoriesByCategory(category: MemoryCategory): Promise<AIMemoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_memory")
    .select("*")
    .eq("category", category)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[ai-memory] getMemoriesByCategory error:", error.message);
    return [];
  }
  return (data ?? []) as AIMemoryEntry[];
}

/** 读取某个主体的记忆（如某个成员或模块） */
export async function getMemoryBySubject(
  category: MemoryCategory,
  subjectKey: string,
): Promise<AIMemoryEntry | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_memory")
    .select("*")
    .eq("category", category)
    .eq("subject_key", subjectKey)
    .maybeSingle();
  if (error) {
    console.error("[ai-memory] getMemoryBySubject error:", error.message);
    return null;
  }
  return data as AIMemoryEntry | null;
}

/**
 * 为 AI 聊天组装完整上下文字符串
 * 将所有记忆按分类组织成可读文本块
 */
export async function buildMemoryContext(): Promise<string> {
  const memories = await getAllMemories();
  if (memories.length === 0) return "";

  const byCategory: Record<string, AIMemoryEntry[]> = {};
  for (const m of memories) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    byCategory[m.category].push(m);
  }

  const CATEGORY_LABELS: Record<MemoryCategory, string> = {
    member_profile:  "【成员画像】",
    module_health:   "【模块健康度】",
    org_insight:     "【组织洞察】",
    process_pattern: "【协作流程规律】",
  };

  const lines: string[] = ["=== AI 积累的组织记忆 ===", ""];

  for (const cat of ["org_insight", "process_pattern", "module_health", "member_profile"] as MemoryCategory[]) {
    const entries = byCategory[cat];
    if (!entries || entries.length === 0) continue;
    lines.push(CATEGORY_LABELS[cat]);
    for (const m of entries) {
      const label = m.subject_label ? `${m.subject_label}` : "整体";
      const when = m.period_end ? `（覆盖至 ${m.period_end}）` : "";
      lines.push(`▸ ${label}${when}`);
      lines.push(m.content);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 写操作（供 ai-learning 使用，使用 admin client）
// ---------------------------------------------------------------------------

export type UpsertMemoryInput = {
  category: MemoryCategory;
  subject_key?: string | null;
  subject_label?: string | null;
  content: string;
  raw_metrics?: Record<string, unknown>;
  period_start?: string;
  period_end?: string;
};

/**
 * 插入或更新一条记忆。
 * 若 subject_key 相同则覆盖（version+1），否则新建。
 */
export async function upsertMemory(input: UpsertMemoryInput): Promise<void> {
  const supabase = createAdminClient();

  if (input.subject_key) {
    // 先查是否已有相同 subject_key 的记录
    const { data: existing } = await supabase
      .from("ai_memory")
      .select("id, version")
      .eq("category", input.category)
      .eq("subject_key", input.subject_key)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("ai_memory")
        .update({
          subject_label: input.subject_label ?? existing,
          content:       input.content,
          raw_metrics:   input.raw_metrics ?? {},
          period_start:  input.period_start ?? null,
          period_end:    input.period_end ?? null,
          version:       (existing as { version: number }).version + 1,
          updated_at:    new Date().toISOString(),
        })
        .eq("id", (existing as { id: string }).id);
      if (error) console.error("[ai-memory] update error:", error.message);
      return;
    }
  }

  const { error } = await supabase.from("ai_memory").insert({
    category:      input.category,
    subject_key:   input.subject_key ?? null,
    subject_label: input.subject_label ?? null,
    content:       input.content,
    raw_metrics:   input.raw_metrics ?? {},
    period_start:  input.period_start ?? null,
    period_end:    input.period_end ?? null,
    version:       1,
  });
  if (error) console.error("[ai-memory] insert error:", error.message);
}

/** 记录用户交互事件（轻量埋点） */
export async function logInteractionEvent(
  userId: string,
  eventType: string,
  opts?: {
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("ai_interaction_events").insert({
    user_id:     userId,
    event_type:  eventType,
    target_type: opts?.targetType ?? null,
    target_id:   opts?.targetId ?? null,
    metadata:    opts?.metadata ?? {},
  });
  if (error) console.error("[ai-memory] logInteraction error:", error.message);
}
