/**
 * AI 组织学习引擎
 *
 * 每日运行一次，分析平台上的全量数据，更新 ai_memory 表。
 * 学习内容：
 *   1. 组织整体洞察（org_insight）
 *   2. 协作流程规律（process_pattern）
 *   3. 各模块健康度（module_health）
 *   4. 每个成员的画像（member_profile）
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { chatCompletion, isAIConfigured } from "@/lib/ai";
import { upsertMemory } from "@/lib/ai-memory";
import { collectLongTermData } from "@/lib/longterm-queries";
import { loadConversationsForLearning, pruneOldMessages } from "@/lib/ai-chat-history";

// ---------------------------------------------------------------------------
// 辅助工具
// ---------------------------------------------------------------------------

function chinaToday(): string {
  return new Date().toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).replace(/\//g, "-");
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// 数据采集
// ---------------------------------------------------------------------------

async function collectMemberRawData(userId: string, days = 30) {
  const supabase = createAdminClient();
  const since = daysAgo(days);

  const [updatesRes, closedRes, createdRes, handoversSentRes, handoversRecvRes, commentsRes, openIssuesRes] =
    await Promise.all([
      supabase.from("issue_updates").select("id, created_at, issue_id").eq("user_id", userId)
        .eq("is_system_generated", false).gte("created_at", since),
      supabase.from("issues").select("id, resolved_at, closed_at, module, category, created_at")
        .eq("assignee_id", userId).or(`resolved_at.gte.${since},closed_at.gte.${since}`)
        .in("status", ["resolved", "closed"]),
      supabase.from("issues").select("id, created_at, module, category")
        .eq("creator_id", userId).gte("created_at", since),
      supabase.from("issue_handovers" as string).select("id, created_at").eq("from_user_id", userId)
        .gte("created_at", since),
      supabase.from("issue_handovers" as string).select("id, created_at").eq("to_user_id", userId)
        .gte("created_at", since),
      supabase.from("issue_update_comments" as string).select("id, created_at").eq("user_id", userId)
        .gte("created_at", since),
      supabase.from("issues").select("id, status, priority, module, category, due_date, last_activity_at")
        .eq("assignee_id", userId).not("status", "in", "(resolved,closed)"),
    ]);

  // 计算活跃天数
  const activeDays = new Set(
    (updatesRes.data ?? []).map((u) => (u.created_at as string).slice(0, 10))
  ).size;

  // 过期问题数
  const today = chinaToday();
  const overdueCount = (openIssuesRes.data ?? []).filter(
    (i) => i.due_date && i.due_date < today
  ).length;

  // 最常涉及的模块
  const moduleCounts: Record<string, number> = {};
  for (const i of [...(closedRes.data ?? []), ...(openIssuesRes.data ?? [])]) {
    if (i.module) moduleCounts[i.module] = (moduleCounts[i.module] ?? 0) + 1;
  }
  const topModules = Object.entries(moduleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([m]) => m);

  return {
    updates30:        (updatesRes.data ?? []).length,
    activeDays30:     activeDays,
    closed30:         (closedRes.data ?? []).length,
    created30:        (createdRes.data ?? []).length,
    handoversSent30:  (handoversSentRes.data ?? []).length,
    handoversRecv30:  (handoversRecvRes.data ?? []).length,
    comments30:       (commentsRes.data ?? []).length,
    currentOpen:      (openIssuesRes.data ?? []).length,
    overdueCount,
    topModules,
  };
}

// ---------------------------------------------------------------------------
// 生成成员画像
// ---------------------------------------------------------------------------

async function learnMemberProfile(
  userId: string,
  userName: string,
): Promise<void> {
  const metrics = await collectMemberRawData(userId);
  const today = chinaToday();

  const dataText = [
    `成员：${userName}`,
    `数据周期：过去30天（截至 ${today}）`,
    "",
    `进展更新条数：${metrics.updates30}`,
    `活跃天数：${metrics.activeDays30}/30 天`,
    `关闭/解决的工单：${metrics.closed30} 个`,
    `新建的工单：${metrics.created30} 个`,
    `交接发出：${metrics.handoversSent30} 次`,
    `交接接收：${metrics.handoversRecv30} 次`,
    `评论：${metrics.comments30} 条`,
    `当前在办工单：${metrics.currentOpen} 个`,
    `当前逾期工单：${metrics.overdueCount} 个`,
    `最常涉及的模块：${metrics.topModules.length > 0 ? metrics.topModules.join("、") : "暂无数据"}`,
  ].join("\n");

  const systemPrompt = [
    "你是一个组织效能分析师，根据团队成员的工作数据，生成一段简洁客观的成员工作画像。",
    "",
    "要求：",
    "- 3-5 句话，纯文本，不要 Markdown 格式",
    "- 覆盖：工作活跃度、产出特点、当前工作状态、值得关注的信号（如高逾期/低活跃）",
    "- 语气客观中立，用数据说话",
    "- 不要以「成员」「该成员」开头，直接用名字",
    "- 只输出画像段落，不要任何其他内容",
  ].join("\n");

  const content = await chatCompletion(systemPrompt, dataText, {
    maxTokens: 512,
    disableThinking: true,
  });

  if (!content) return;

  await upsertMemory({
    category:      "member_profile",
    subject_key:   userId,
    subject_label: userName,
    content,
    raw_metrics:   metrics as unknown as Record<string, unknown>,
    period_start:  daysAgo(30),
    period_end:    today,
  });
}

// ---------------------------------------------------------------------------
// 生成模块健康度
// ---------------------------------------------------------------------------

async function learnModuleHealth(moduleName: string): Promise<void> {
  const supabase = createAdminClient();
  const since = daysAgo(30);
  const today = chinaToday();

  const [openRes, closedRes] = await Promise.all([
    supabase.from("issues").select("id, status, priority, due_date, last_activity_at")
      .eq("module", moduleName).not("status", "in", "(resolved,closed)"),
    supabase.from("issues").select("id, created_at, resolved_at, closed_at")
      .eq("module", moduleName).or(`resolved_at.gte.${since},closed_at.gte.${since}`),
  ]);

  const open = openRes.data ?? [];
  const closed30 = closedRes.data ?? [];

  const overdueCount = open.filter((i) => i.due_date && i.due_date < today).length;
  const blockedCount = open.filter((i) => i.status === "blocked").length;
  const urgentCount  = open.filter((i) => i.priority === "urgent").length;
  const staleCount   = open.filter((i) => {
    const ts = i.last_activity_at ?? null;
    if (!ts) return false;
    return new Date(ts).getTime() < new Date(daysAgo(3)).getTime();
  }).length;

  // 平均解决时长
  const durations: number[] = [];
  for (const i of closed30) {
    const closeTs = i.resolved_at ?? i.closed_at;
    if (closeTs && i.created_at) {
      const days = (new Date(closeTs).getTime() - new Date(i.created_at).getTime()) / 86400000;
      if (days >= 0) durations.push(days);
    }
  }
  const avgDays = durations.length > 0
    ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length)
    : null;

  const metrics = {
    openCount: open.length,
    closedLast30: closed30.length,
    overdueCount,
    blockedCount,
    urgentCount,
    staleCount,
    avgResolutionDays: avgDays,
  };

  const dataText = [
    `模块：${moduleName}`,
    `数据周期：过去30天（截至 ${today}）`,
    "",
    `当前在办工单：${metrics.openCount} 个`,
    `近30天关闭：${metrics.closedLast30} 个`,
    `当前逾期：${metrics.overdueCount} 个`,
    `当前阻塞：${metrics.blockedCount} 个`,
    `当前紧急：${metrics.urgentCount} 个`,
    `超3天无更新：${metrics.staleCount} 个`,
    avgDays !== null ? `平均解决时长：${avgDays} 天` : `平均解决时长：数据不足`,
  ].join("\n");

  const systemPrompt = [
    "你是一个项目健康度分析师，根据模块的工单数据，生成一段简洁客观的模块健康度评估。",
    "",
    "要求：",
    "- 3-4 句话，纯文本，不要 Markdown 格式",
    "- 覆盖：当前在办规模、风险信号（逾期/阻塞/停滞）、近30天吞吐量、整体健康评级（健康/需关注/高风险）",
    "- 语气客观，突出最需关注的1-2个问题",
    "- 直接输出评估段落，不要任何其他内容",
  ].join("\n");

  const content = await chatCompletion(systemPrompt, dataText, {
    maxTokens: 400,
    disableThinking: true,
  });

  if (!content) return;

  await upsertMemory({
    category:      "module_health",
    subject_key:   moduleName,
    subject_label: moduleName,
    content,
    raw_metrics:   metrics as unknown as Record<string, unknown>,
    period_start:  daysAgo(30),
    period_end:    today,
  });
}

// ---------------------------------------------------------------------------
// 生成组织整体洞察
// ---------------------------------------------------------------------------

async function learnOrgInsight(): Promise<void> {
  const data = await collectLongTermData();
  const today = chinaToday();

  const { trend30, lifecycle, members, statusFlow, handovers, modules } = data;

  const totalNew    = trend30.reduce((s, d) => s + d.newIssues, 0);
  const totalClosed = trend30.reduce((s, d) => s + d.closedIssues, 0);
  const net = totalNew - totalClosed;

  const activeMembers = members.filter((m) => m.updates30 > 0);
  const topContributor = activeMembers.sort((a, b) => b.updates30 - a.updates30)[0];

  const dataText = [
    `组织整体数据（过去30天，截至 ${today}）`,
    "",
    `工单吞吐：新建 ${totalNew} | 关闭 ${totalClosed} | 净积累 ${net > 0 ? "+" : ""}${net}`,
    `解决效率：平均 ${lifecycle.avgResolutionDays ?? "N/A"} 天，中位 ${lifecycle.medianResolutionDays ?? "N/A"} 天`,
    `返修率：${lifecycle.reworkRate ?? 0}%，阻塞率相关工单：${lifecycle.everBlockedCount} 个`,
    `交接总次数：${handovers.total}，退回次数：${handovers.returnCount}（退回率 ${handovers.returnRate ?? 0}%）`,
    `活跃成员：${activeMembers.length}/${members.length}`,
    topContributor ? `贡献最多：${topContributor.name}（更新 ${topContributor.updates30} 条，活跃 ${topContributor.activeDays30} 天）` : "",
    `最大模块（在办最多）：${modules[0]?.module ?? "N/A"}（${modules[0]?.openCount ?? 0} 个）`,
    `状态流转最频繁：${statusFlow[0] ? `${statusFlow[0].from} → ${statusFlow[0].to}（${statusFlow[0].count} 次）` : "暂无"}`,
  ].filter(Boolean).join("\n");

  const systemPrompt = [
    "你是一名高级组织效能顾问，根据游戏研发团队的工单协作数据，生成组织整体健康度洞察。",
    "",
    "要求：",
    "- 5-7 句话，纯文本，不要 Markdown 格式",
    "- 覆盖：整体运转状态定性、最突出的正向成就、最需要关注的系统性问题、协作健康度信号",
    "- 语言专业有洞察力，必须引用数字",
    "- 直接输出洞察段落，不要任何其他内容",
  ].join("\n");

  const content = await chatCompletion(systemPrompt, dataText, {
    maxTokens: 800,
    disableThinking: true,
  });

  if (!content) return;

  await upsertMemory({
    category:      "org_insight",
    subject_key:   "overall",
    subject_label: "团队整体",
    content,
    raw_metrics:   { totalNew, totalClosed, net, activeMembers: activeMembers.length, totalMembers: members.length },
    period_start:  daysAgo(30),
    period_end:    today,
  });
}

// ---------------------------------------------------------------------------
// 生成协作流程规律
// ---------------------------------------------------------------------------

async function learnProcessPattern(): Promise<void> {
  const supabase = createAdminClient();
  const since = daysAgo(30);
  const today = chinaToday();

  // 分析每周工作节奏（按星期几统计）
  const { data: updatesByDay } = await supabase
    .from("issue_updates")
    .select("created_at")
    .eq("is_system_generated", false)
    .gte("created_at", since);

  const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun=0
  for (const u of updatesByDay ?? []) {
    const dow = new Date(u.created_at).getDay();
    dayOfWeekCounts[dow]++;
  }
  const DOW_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const weekdayPattern = dayOfWeekCounts
    .map((cnt, i) => `${DOW_LABELS[i]}: ${cnt}`)
    .join("，");

  // 分析状态流转
  const { data: events } = await supabase
    .from("issue_events")
    .select("payload")
    .eq("event_type", "status_changed")
    .gte("created_at", since)
    .limit(500);

  const flowMap: Record<string, number> = {};
  for (const e of events ?? []) {
    const p = e.payload as { from?: string; to?: string } | null;
    if (p?.from && p?.to) {
      const key = `${p.from}→${p.to}`;
      flowMap[key] = (flowMap[key] ?? 0) + 1;
    }
  }
  const topFlows = Object.entries(flowMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, v]) => `${k}(${v}次)`);

  // 分析平均响应时间（从 todo 到 in_progress）
  const dataText = [
    `协作流程数据（过去30天，截至 ${today}）`,
    "",
    `每周工作节奏（按进展更新条数）：${weekdayPattern}`,
    `最频繁的状态流转：${topFlows.join("，") || "暂无"}`,
  ].join("\n");

  const systemPrompt = [
    "你是一名工作流程分析师，根据团队工作数据，识别协作模式和工作节奏。",
    "",
    "要求：",
    "- 3-5 句话，纯文本，不要 Markdown 格式",
    "- 识别：工作节奏规律（哪天最活跃/最低迷）、状态流转中的典型路径、值得注意的流程信号",
    "- 基于数据推断，语言精准有洞察力",
    "- 直接输出分析段落，不要任何其他内容",
  ].join("\n");

  const content = await chatCompletion(systemPrompt, dataText, {
    maxTokens: 600,
    disableThinking: true,
  });

  if (!content) return;

  await upsertMemory({
    category:      "process_pattern",
    subject_key:   "workflow",
    subject_label: "协作工作流",
    content,
    raw_metrics:   { weekdayPattern: dayOfWeekCounts, topFlows },
    period_start:  daysAgo(30),
    period_end:    today,
  });
}

// ---------------------------------------------------------------------------
// 从对话中提炼洞察
// ---------------------------------------------------------------------------

/**
 * 分析近 7 天内每个用户与 AI 的对话，提炼出：
 *   - 管理者反复关注的话题（说明优先级）
 *   - 对话中主动提及的团队成员信号（补充成员画像之外的软性信息）
 *   - 表达出的决策或行动意图
 * 结果写入 ai_memory.conversation_insight，subject_key = user_id。
 */
async function learnFromConversations(
  userMap: Map<string, string>,  // userId → userName
): Promise<number> {
  const conversationsByUser = await loadConversationsForLearning();
  if (conversationsByUser.size === 0) return 0;

  const today = chinaToday();
  let count = 0;

  for (const [userId, turns] of conversationsByUser) {
    if (turns.length < 2) continue; // 太少的对话不值得分析

    const userName = userMap.get(userId) ?? "（未知用户）";

    const turnText = turns
      .slice(-20) // 最多分析最近 20 轮，避免 token 超限
      .map((t, i) => `[第${i + 1}轮]\n用户: ${t.user}\nAI: ${t.assistant}`)
      .join("\n\n");

    const systemPrompt = [
      "你是一名组织行为分析师，正在分析一位管理者与 AI 助手的对话记录。",
      "",
      "任务：从对话中提炼出对团队认知有价值的洞察，包括：",
      "1. 管理者反复关注或反复询问的话题（揭示其优先级和担忧）",
      "2. 对话中提及的团队成员的软性信号（如情绪、状态、评价等）",
      "3. 管理者表达的决策、方向或行动意图",
      "4. 管理者对 AI 助理的偏好（喜欢什么样的回答风格、关注什么维度）",
      "",
      "要求：",
      "- 4-6 句话，纯文本，不要 Markdown 格式",
      "- 每句聚焦一个具体洞察，要有具体信息，不要泛泛而谈",
      "- 如果没有有价值的洞察，输出「本周对话未发现显著规律」",
      "- 直接输出洞察段落",
    ].join("\n");

    const content = await chatCompletion(systemPrompt, turnText, {
      maxTokens: 600,
      disableThinking: true,
    });

    if (!content || content.includes("未发现显著规律")) continue;

    await upsertMemory({
      category:      "conversation_insight",
      subject_key:   userId,
      subject_label: `${userName} 的对话洞察`,
      content,
      raw_metrics:   { turnCount: turns.length },
      period_start:  daysAgo(7),
      period_end:    today,
    });

    count++;
  }

  return count;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export type LearningResult = {
  org_insight:          boolean;
  process_pattern:      boolean;
  module_health:        number;   // 更新的模块数
  member_profiles:      number;   // 更新的成员数
  conversation_insights: number;  // 从对话中提炼的洞察数
  errors:               string[];
};

/**
 * 执行一次完整的组织学习。
 * 建议每天在 cron job 中调用一次。
 */
export async function runOrganizationLearning(): Promise<LearningResult> {
  const result: LearningResult = {
    org_insight:           false,
    process_pattern:       false,
    module_health:         0,
    member_profiles:       0,
    conversation_insights: 0,
    errors:                [],
  };

  if (!isAIConfigured()) {
    result.errors.push("AI not configured (MOONSHOT_API_KEY missing)");
    return result;
  }

  const supabase = createAdminClient();

  // ── 1. 组织整体洞察 ──────────────────────────────────────────────────
  try {
    await learnOrgInsight();
    result.org_insight = true;
  } catch (e) {
    result.errors.push(`org_insight: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 2. 协作流程规律 ──────────────────────────────────────────────────
  try {
    await learnProcessPattern();
    result.process_pattern = true;
  } catch (e) {
    result.errors.push(`process_pattern: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 3. 各模块健康度 ──────────────────────────────────────────────────
  const { data: moduleRows } = await supabase
    .from("issues")
    .select("module")
    .not("status", "in", "(resolved,closed)")
    .not("module", "is", null);

  const modules = [...new Set((moduleRows ?? []).map((r) => r.module as string))];
  for (const mod of modules) {
    try {
      await learnModuleHealth(mod);
      result.module_health++;
    } catch (e) {
      result.errors.push(`module(${mod}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 4. 成员画像 ──────────────────────────────────────────────────────
  const { data: users } = await supabase
    .from("users")
    .select("id, name")
    .neq("role", "finance");  // 跳过纯财务成员

  const userMap = new Map<string, string>();
  for (const user of users ?? []) {
    userMap.set(user.id as string, user.name as string);
    try {
      await learnMemberProfile(user.id as string, user.name as string);
      result.member_profiles++;
    } catch (e) {
      result.errors.push(`member(${user.name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── 5. 从对话中提炼洞察 ──────────────────────────────────────────────
  try {
    result.conversation_insights = await learnFromConversations(userMap);
  } catch (e) {
    result.errors.push(`conversation_insights: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ── 6. 清理 90 天前的旧消息 ──────────────────────────────────────────
  try {
    await pruneOldMessages();
  } catch (e) {
    result.errors.push(`pruneOldMessages: ${e instanceof Error ? e.message : String(e)}`);
  }

  return result;
}
