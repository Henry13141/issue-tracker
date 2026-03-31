"use server";

import { chatCompletion, isAIConfigured } from "@/lib/ai";
import { ISSUE_CATEGORIES, ISSUE_MODULES, isIssueCategory, isIssueModule } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { IssuePriority } from "@/types";

const VALID_PRIORITIES: IssuePriority[] = ["low", "medium", "high", "urgent"];
function isIssuePriority(v: unknown): v is IssuePriority {
  return typeof v === "string" && VALID_PRIORITIES.includes(v as IssuePriority);
}

// ---------------------------------------------------------------------------
// 智能分类 + 模块推荐
// ---------------------------------------------------------------------------

export async function suggestCategoryAndModule(
  title: string,
): Promise<{ category: string | null; module: string | null } | null> {
  if (!title.trim() || !isAIConfigured()) return null;

  const systemPrompt = [
    "你是一个 UE 游戏项目的工单分类助手。",
    "根据用户提供的问题标题，推荐最合适的「分类」和「模块」。",
    "",
    `可选分类：${ISSUE_CATEGORIES.join("、")}`,
    `可选模块：${ISSUE_MODULES.join("、")}`,
    "",
    "严格按以下 JSON 格式返回，不要返回其他内容：",
    '{"category": "分类名", "module": "模块名"}',
  ].join("\n");

  const result = await chatCompletion(systemPrompt, title, { maxTokens: 128 });
  if (!result) return null;

  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as { category?: string; module?: string };
    return {
      category: parsed.category && isIssueCategory(parsed.category) ? parsed.category : null,
      module: parsed.module && isIssueModule(parsed.module) ? parsed.module : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 交接说明自动生成
// ---------------------------------------------------------------------------

export async function generateHandoverDraft(issueId: string): Promise<string | null> {
  if (!isAIConfigured()) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();

  const [issueRes, updatesRes] = await Promise.all([
    supabase
      .from("issues")
      .select("title, description, status, priority, category, module, due_date, created_at")
      .eq("id", issueId)
      .single(),
    supabase
      .from("issue_updates")
      .select("content, created_at, user:users!issue_updates_user_id_fkey(name)")
      .eq("issue_id", issueId)
      .eq("is_system_generated", false)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (issueRes.error || !issueRes.data) return null;

  const issue = issueRes.data;
  const rawRows = (updatesRes.data ?? []) as unknown as {
    content: string;
    created_at: string;
    user: { name: string } | { name: string }[] | null;
  }[];
  const updates = rawRows.map((r) => ({
    content: r.content,
    created_at: r.created_at,
    userName: Array.isArray(r.user) ? r.user[0]?.name : r.user?.name,
  }));

  const contextLines = [
    `标题：${issue.title}`,
    `描述：${issue.description || "无"}`,
    `状态：${issue.status}`,
    `优先级：${issue.priority}`,
    `分类：${issue.category || "未设置"}`,
    `模块：${issue.module || "未设置"}`,
    `截止日期：${issue.due_date || "未设置"}`,
    `创建时间：${issue.created_at}`,
  ];

  if (updates.length > 0) {
    contextLines.push("", "最近进展（从新到旧）：");
    for (const u of updates) {
      const who = u.userName ?? "未知";
      const when = u.created_at.slice(0, 10);
      contextLines.push(`- [${when} ${who}] ${u.content}`);
    }
  }

  const systemPrompt = [
    "你是一个项目管理交接助手。根据以下问题信息，生成一份简洁的交接说明。",
    "交接说明需要包含：",
    "1. 当前进度（1-2 句话概括）",
    "2. 已知阻塞或风险（如有）",
    "3. 下一步建议（接手人应优先做什么）",
    "",
    "用纯文本格式，不要用 Markdown 标题，总长度控制在 200 字以内。",
    "直接输出交接内容，不要加任何前缀说明。",
  ].join("\n");

  return chatCompletion(systemPrompt, contextLines.join("\n"), { maxTokens: 512 });
}

// ---------------------------------------------------------------------------
// 问题描述：根据标题 + 已有草稿扩写
// ---------------------------------------------------------------------------

export async function generateDescriptionDraft(
  title: string,
  hint: string,
): Promise<string | null> {
  if (!isAIConfigured()) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const t = title.trim();
  const h = hint.trim();
  if (!t && !h) return null;

  const systemPrompt = [
    "你是游戏项目（UE）问题单的质量助手。",
    "用户会提供问题标题和描述框里已写的内容（可能不完整）。",
    "请基于已有文字，整理并扩写为更清晰的问题描述，可包含：背景与现象、期望目标、需要同步的范围（如文案/UI）。",
    "使用简洁的中文段落，可直接粘贴进工单描述。不要使用 Markdown 标题（不要用 #）。",
    "直接输出描述正文，不要加「好的」「以下是」等前缀。",
  ].join("");

  const userContent = [
    t ? `标题：${t}` : "标题：（未填）",
    "",
    h ? `描述框内已有内容：\n${h}` : "描述框内暂无内容，请主要依据标题补全描述。",
  ].join("\n");

  return chatCompletion(systemPrompt, userContent, { maxTokens: 1024 });
}

// ---------------------------------------------------------------------------
// 智能优先级 + 建议截止天数
// ---------------------------------------------------------------------------

export async function suggestPriority(
  title: string,
  description: string,
): Promise<{
  priority: IssuePriority;
  reason: string;
  suggestedDueDays: number | null;
} | null> {
  if (!isAIConfigured()) return null;

  const user = await getCurrentUser();
  if (!user) return null;

  const t = title.trim();
  const d = description.trim();
  if (!t && !d) return null;

  const systemPrompt = [
    "你是 UE 游戏项目的问题优先级助手。根据标题和描述，判断优先级并给出简短理由。",
    "",
    "优先级含义：",
    "- urgent：阻塞核心流程、线上事故、必须当天处理",
    "- high：明显影响玩家体验或阻塞他人工作",
    "- medium：一般问题，可排期处理",
    "- low：优化项、文案细化、非阻塞",
    "",
    "同时给出建议的 dueDays（正整数），表示建议截止日期为今天起第几天。",
    "规则：urgent 通常 1；high 通常 3；medium 通常 7；low 时 dueDays 必须为 null。",
    "",
    "严格只输出一行 JSON，不要 markdown：",
    '{"priority":"low|medium|high|urgent","reason":"一句话理由","dueDays":数字或null}',
  ].join("\n");

  const userContent = [
    t ? `标题：${t}` : "标题：（空）",
    "",
    d ? `描述：\n${d}` : "描述：（空）",
  ].join("\n");

  const result = await chatCompletion(systemPrompt, userContent, { maxTokens: 256 });
  if (!result) return null;

  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as {
      priority?: unknown;
      reason?: unknown;
      dueDays?: unknown;
    };
    if (!isIssuePriority(parsed.priority)) return null;

    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 200)
        : "已根据内容给出建议";

    let suggestedDueDays: number | null = null;
    if (typeof parsed.dueDays === "number" && Number.isFinite(parsed.dueDays) && parsed.dueDays >= 1 && parsed.dueDays <= 365) {
      suggestedDueDays = Math.round(parsed.dueDays);
    } else if (parsed.priority !== "low") {
      suggestedDueDays = parsed.priority === "urgent" ? 1 : parsed.priority === "high" ? 3 : 7;
    }

    if (parsed.priority === "low") {
      suggestedDueDays = null;
    }

    return { priority: parsed.priority, reason, suggestedDueDays };
  } catch {
    return null;
  }
}
