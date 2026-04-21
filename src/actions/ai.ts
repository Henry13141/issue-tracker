"use server";

import { chatCompletion, chatCompletionFromMessages, isAIConfigured } from "@/lib/ai";
import type { AIChatMessage } from "@/lib/ai";
import { ISSUE_CATEGORIES, ISSUE_MODULES, isIssueCategory, isIssueModule, ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { IssuePriority } from "@/types";
import {
  getOverviewStats,
  getPositiveStats,
  getHighRiskIssues,
  getMemberWorkload,
  getModuleCategoryStats,
  get7DayTrend,
} from "@/lib/dashboard-queries";
import { collectLongTermData } from "@/lib/longterm-queries";
import type { LongTermData } from "@/lib/longterm-queries";
import { buildMemoryContext, logInteractionEvent } from "@/lib/ai-memory";

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

  const result = await chatCompletion(systemPrompt, title, {
    maxTokens: 128,
    disableThinking: true,
  });
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

  const result = await chatCompletion(systemPrompt, userContent, {
    maxTokens: 256,
    disableThinking: true,
  });
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

// ---------------------------------------------------------------------------
// AI 工作情况分析报告
// ---------------------------------------------------------------------------

export type WorkInsightReport = {
  summary: string;
  riskAnalysis: string;
  memberInsights: string;
  trendInsights: string;
  actionItems: string;
  generatedAt: string;
};

export async function generateWorkInsightReport(): Promise<WorkInsightReport | null> {
  if (!isAIConfigured()) return null;

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;

  const [overview, positive, riskIssues, memberWorkload, moduleStats, trend] = await Promise.all([
    getOverviewStats(),
    getPositiveStats(),
    getHighRiskIssues(15),
    getMemberWorkload(),
    getModuleCategoryStats(),
    get7DayTrend(),
  ]);

  const todayStr = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });

  const lines: string[] = [];

  lines.push(`=== 工作情况数据快照（${todayStr}）===`);
  lines.push("");

  lines.push("【今日推进成果】");
  lines.push(`- 今日进展更新条数：${positive.todayProgressUpdates}`);
  lines.push(`- 今日完成/关闭问题：${positive.todayClosedResolved}`);
  lines.push(`- 今日新录入问题：${positive.todayNewIssues}`);
  lines.push(`- 近7天完成问题：${positive.weekClosedResolved}`);
  lines.push(`- 近7天活跃贡献成员：${positive.activeContributors}`);
  lines.push(`- 今日交接次数：${positive.todayHandovers}`);
  lines.push("");

  lines.push("【当前待关注事项】");
  lines.push(`- 已过截止日期（未关闭）：${overview.overdueCount} 个`);
  lines.push(`- 遇到阻塞：${overview.blockedCount} 个`);
  lines.push(`- 紧急优先级（未关闭）：${overview.urgentCount} 个`);
  lines.push(`- 活跃问题今日尚未更新：${overview.noUpdateToday} 个`);
  lines.push(`- 超3天无进展（stale）：${overview.stale3DaysCount} 个`);
  lines.push("");

  lines.push("【高风险问题列表（Top 10）】");
  if (riskIssues.length === 0) {
    lines.push("- 当前无高风险问题");
  } else {
    riskIssues.slice(0, 10).forEach((issue, i) => {
      const tags = issue.riskTags.map((t) => ({ urgent: "紧急", overdue: "逾期", stale: "停滞", blocked: "阻塞" }[t] ?? t)).join("、");
      const status = ISSUE_STATUS_LABELS[issue.status] ?? issue.status;
      const priority = ISSUE_PRIORITY_LABELS[issue.priority] ?? issue.priority;
      const activity = issue.daysSinceActivity >= 999 ? "从未更新" : `${issue.daysSinceActivity}天前有动态`;
      lines.push(`${i + 1}. 【${tags}】${issue.title}`);
      lines.push(`   状态：${status} | 优先级：${priority} | 负责人：${issue.assigneeName ?? "未分配"} | ${activity}${issue.dueDate ? ` | 截止：${issue.dueDate}` : ""}`);
    });
  }
  lines.push("");

  lines.push("【成员工作负载（在办工单 > 0）】");
  if (memberWorkload.length === 0) {
    lines.push("- 暂无数据");
  } else {
    memberWorkload.forEach((m) => {
      const parts = [`在办 ${m.total}`];
      if (m.overdue > 0) parts.push(`逾期 ${m.overdue}`);
      if (m.blocked > 0) parts.push(`阻塞 ${m.blocked}`);
      if (m.stale > 0) parts.push(`停滞 ${m.stale}`);
      if (m.urgent > 0) parts.push(`紧急 ${m.urgent}`);
      parts.push(`7天推进 ${m.updates7Days} 条`);
      lines.push(`- ${m.name}：${parts.join(" | ")}`);
    });
  }
  lines.push("");

  lines.push("【模块分布（前5）】");
  moduleStats.modules.slice(0, 5).forEach((m) => {
    lines.push(`- ${m.label}：在办 ${m.total}${m.overdue > 0 ? `，逾期 ${m.overdue}` : ""}${m.blocked > 0 ? `，阻塞 ${m.blocked}` : ""}${m.urgent > 0 ? `，紧急 ${m.urgent}` : ""}`);
  });
  lines.push("");

  lines.push("【近7天每日趋势】");
  trend.forEach((d) => {
    lines.push(`- ${d.dateStr}：新录入 ${d.newIssues} | 完成 ${d.closedIssues} | 提醒 ${d.reminders} | 通知失败 ${d.notifFailed}`);
  });

  const dataContext = lines.join("\n");

  const systemPrompt = [
    "你是一名专业的项目管理顾问，正在分析一个游戏项目团队的工单系统数据。",
    "根据提供的数据快照，生成一份简洁有价值的工作情况分析报告。",
    "",
    "严格按以下 JSON 格式输出，不要输出任何其他内容：",
    "{",
    '  "summary": "整体工作状态的1-2句总结，包含最关键的正面信息和最需关注的风险点",',
    '  "riskAnalysis": "高风险问题的分析，重点关注逾期、阻塞、停滞问题，以及可能的原因或模式，2-4句",',
    '  "memberInsights": "成员工作负载分析，指出负担较重或需要关注的成员，以及协作健康度评估，2-3句",',
    '  "trendInsights": "基于7天趋势的洞察，分析工作节奏、效率变化、是否有积压趋势，2-3句",',
    '  "actionItems": "基于以上分析给出2-4条具体可执行的今日行动建议，每条以「•」开头，聚焦最高优先级事项"',
    "}",
    "",
    "要求：",
    "- 使用简体中文，语言专业直接",
    "- 数据引用要具体（使用数字）",
    "- 行动建议要具体到人或模块，而不是泛泛而谈",
    "- 不要使用 Markdown 格式（不要 **加粗** 或 # 标题）",
  ].join("\n");

  const result = await chatCompletion(systemPrompt, dataContext, {
    maxTokens: 2048,
    disableThinking: true,
  });

  if (!result) return null;

  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<WorkInsightReport>;

    if (!parsed.summary || !parsed.actionItems) return null;

    return {
      summary: parsed.summary ?? "",
      riskAnalysis: parsed.riskAnalysis ?? "",
      memberInsights: parsed.memberInsights ?? "",
      trendInsights: parsed.trendInsights ?? "",
      actionItems: parsed.actionItems ?? "",
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI 长期工作情况报告（30天纵向深度分析）
// ---------------------------------------------------------------------------

export type LongTermSection = {
  title: string;
  content: string;
};

export type LongTermReport = {
  executiveSummary: string;
  projectHealth: string;
  bottlenecks: string;
  teamEffectiveness: string;
  trendTrajectory: string;
  recommendations: string;
  dataContext: string;  // 原始数据摘要，供展示
  generatedAt: string;
};

/** 将长期数据格式化为 AI 可读的文本上下文 */
function formatLongTermContext(data: LongTermData): string {
  const { trend30, lifecycle, members, statusFlow, handovers, modules, notifHealth } = data;
  const lines: string[] = [];

  const now = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
  lines.push(`=== 30天纵向数据快照（截至 ${now}）===`);
  lines.push("");

  // 30天趋势摘要
  const totalNew    = trend30.reduce((s, d) => s + d.newIssues, 0);
  const totalClosed = trend30.reduce((s, d) => s + d.closedIssues, 0);
  const netAccumulation = totalNew - totalClosed;
  const recentWeek  = trend30.slice(-7);
  const recentNew   = recentWeek.reduce((s, d) => s + d.newIssues, 0);
  const recentClosed = recentWeek.reduce((s, d) => s + d.closedIssues, 0);

  lines.push("【30天工单吞吐量】");
  lines.push(`- 总新建：${totalNew} 个`);
  lines.push(`- 总关闭/解决：${totalClosed} 个`);
  lines.push(`- 净积累（新建-关闭）：${netAccumulation > 0 ? "+" : ""}${netAccumulation} 个`);
  lines.push(`- 最近7天：新建 ${recentNew} | 关闭 ${recentClosed}`);
  lines.push("");

  // 30天趋势（每周汇总）
  const weeks = [
    trend30.slice(0, 7),
    trend30.slice(7, 14),
    trend30.slice(14, 21),
    trend30.slice(21, 28),
    trend30.slice(28),
  ];
  lines.push("【按周趋势（周1=最早）】");
  weeks.forEach((w, i) => {
    if (w.length === 0) return;
    const wNew    = w.reduce((s, d) => s + d.newIssues, 0);
    const wClosed = w.reduce((s, d) => s + d.closedIssues, 0);
    lines.push(`- 第${i + 1}周（${w[0].dateStr}～${w[w.length-1].dateStr}）：新建 ${wNew} | 关闭 ${wClosed}`);
  });
  lines.push("");

  // 工单生命周期
  lines.push("【工单生命周期统计（过去30天关闭）】");
  lines.push(`- 已关闭数量：${lifecycle.closedCount} 个`);
  if (lifecycle.avgResolutionDays !== null) lines.push(`- 平均解决时长：${lifecycle.avgResolutionDays} 天`);
  if (lifecycle.medianResolutionDays !== null) lines.push(`- 中位解决时长：${lifecycle.medianResolutionDays} 天`);
  lines.push(`- 解决时长分布：${lifecycle.resolutionBuckets.filter(b => b.count > 0).map(b => `${b.label} ${b.count}个`).join("，")}`);
  lines.push(`- 曾经历返修（pending_rework）工单：${lifecycle.reworkCount} 个${lifecycle.reworkRate !== null ? `（返修率 ${lifecycle.reworkRate}%）` : ""}`);
  lines.push(`- 曾被阻塞的工单：${lifecycle.everBlockedCount} 个`);
  lines.push("");

  // 当前存量年龄
  lines.push("【当前未关闭工单年龄分布】");
  lifecycle.openAgeBuckets.forEach(b => {
    if (b.count > 0) lines.push(`- ${b.label}：${b.count} 个`);
  });
  lines.push("");

  // 成员30天效能
  lines.push("【成员30天效能（仅列出有参与的成员）】");
  members.forEach(m => {
    const parts = [];
    if (m.updates30 > 0)         parts.push(`进展更新 ${m.updates30} 条`);
    if (m.closed30 > 0)          parts.push(`关闭 ${m.closed30} 个`);
    if (m.created30 > 0)         parts.push(`新建 ${m.created30} 个`);
    if (m.handoversSent30 > 0)   parts.push(`交接发出 ${m.handoversSent30} 次`);
    if (m.handoversReceived30 > 0) parts.push(`交接接收 ${m.handoversReceived30} 次`);
    if (m.comments30 > 0)        parts.push(`评论 ${m.comments30} 条`);
    lines.push(`- ${m.name}（当前在办 ${m.currentOpen}）：${parts.join(" | ")} | 活跃天数 ${m.activeDays30}/30`);
  });
  lines.push("");

  // 状态流转
  if (statusFlow.length > 0) {
    const STATUS_ZH: Record<string, string> = {
      todo: "待处理", in_progress: "处理中", blocked: "卡住",
      pending_review: "待验证", pending_rework: "待返修",
      resolved: "已解决", closed: "已关闭",
    };
    lines.push("【30天状态流转（Top 12，次数最多）】");
    statusFlow.slice(0, 12).forEach(r => {
      lines.push(`- ${STATUS_ZH[r.from] ?? r.from} → ${STATUS_ZH[r.to] ?? r.to}：${r.count} 次`);
    });
    lines.push("");
  }

  // 交接行为
  lines.push("【30天交接行为】");
  lines.push(`- 交接总次数：${handovers.total}`);
  lines.push(`- 退回次数：${handovers.returnCount}${handovers.returnRate !== null ? `（退回率 ${handovers.returnRate}%）` : ""}`);
  if (handovers.topPairs.length > 0) {
    lines.push(`- 最活跃交接路径：${handovers.topPairs.slice(0, 3).map(p => `${p.fromName}→${p.toName}(${p.count}次)`).join("，")}`);
  }
  lines.push("");

  // 模块健康
  if (modules.length > 0) {
    lines.push("【各模块健康度（按在办数量排序）】");
    modules.forEach(m => {
      const parts = [`在办 ${m.openCount}`];
      if (m.closedLast30 > 0) parts.push(`近30天关闭 ${m.closedLast30}`);
      if (m.avgResolutionDays !== null) parts.push(`均解决时长 ${m.avgResolutionDays}天`);
      if (m.overdueRate !== null && m.overdueRate > 0) parts.push(`逾期率 ${m.overdueRate}%`);
      lines.push(`- ${m.module}：${parts.join(" | ")}`);
    });
    lines.push("");
  }

  // 通知系统
  lines.push("【通知系统30天健康】");
  lines.push(`- 总发送：${notifHealth.total} 条，失败：${notifHealth.failed} 条${notifHealth.failureRate !== null ? `（失败率 ${notifHealth.failureRate}%）` : ""}`);
  if (notifHealth.weeklyTrend.length > 0) {
    notifHealth.weeklyTrend.filter(w => w.total > 0).forEach(w => {
      const rate = w.total > 0 ? Math.round((w.failed / w.total) * 1000) / 10 : 0;
      lines.push(`- ${w.weekLabel}：发送 ${w.total} | 失败 ${w.failed}（${rate}%）`);
    });
  }

  return lines.join("\n");
}

export async function generateLongTermReport(): Promise<LongTermReport | null> {
  if (!isAIConfigured()) return null;

  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;

  const data = await collectLongTermData();
  const dataContext = formatLongTermContext(data);

  const systemPrompt = [
    "你是一名高级项目管理顾问，正在对一个游戏开发团队的工单协作系统进行30天深度健康审查。",
    "根据提供的多维数据快照，撰写一份专业、深度的工作情况长期报告。",
    "",
    "严格按以下 JSON 格式输出，每个字段都必须有实质性内容，不要输出任何 JSON 以外的内容：",
    "{",
    '  "executiveSummary": "执行摘要（3-5句话）：团队整体30天健康状况一句话定性，关键数字支撑，最大正向成就，最严峻的系统性问题",',
    '  "projectHealth": "项目健康度评估（4-6句话）：工单吞吐量分析（新建vs关闭vs积累），解决效率（平均/中位时长），返修率和阻塞率的质量信号，存量工单年龄结构健康度",',
    '  "bottlenecks": "瓶颈与系统性风险（4-6句话）：识别最关键的2-3个系统性瓶颈（基于数据，不是猜测），这些瓶颈对团队产能的量化影响，状态流转中的异常模式（比如频繁返修），模块级风险集中区",',
    '  "teamEffectiveness": "团队效能分析（4-6句话）：成员间产能差距（最高vs最低），活跃天数与产出的相关性分析，交接行为是否健康（是协作加速器还是甩锅文化），评论/协作参与度分布",',
    '  "trendTrajectory": "趋势与轨迹（3-5句话）：30天工作节奏变化（加速/减速/停滞），积累趋势（净积累是否持续增加），与最近7天数据对比，预判未来2-4周如果不干预会发生什么",',
    '  "recommendations": "核心建议（5-7条）：每条以「•」开头，基于数据，具体到人/模块/机制，包含期望结果。按优先级排列，最高优先级放最前"',
    "}",
    "",
    "重要约束：",
    "- 使用简体中文，语言专业、直接、有洞察力",
    "- 必须引用具体数字，避免空洞论断",
    "- 识别数据中的模式和相关性，而不只是复述数字",
    "- 建议必须可执行，避免「加强沟通」「提高重视」此类无意义建议",
    "- 不要使用 Markdown 格式（不要 **加粗** 或 # 标题）",
  ].join("\n");

  const result = await chatCompletion(systemPrompt, dataContext, {
    maxTokens: 4096,
  });

  if (!result) return null;

  try {
    const cleaned = result.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<LongTermReport>;

    if (!parsed.executiveSummary || !parsed.recommendations) return null;

    return {
      executiveSummary:   parsed.executiveSummary   ?? "",
      projectHealth:      parsed.projectHealth      ?? "",
      bottlenecks:        parsed.bottlenecks         ?? "",
      teamEffectiveness:  parsed.teamEffectiveness  ?? "",
      trendTrajectory:    parsed.trendTrajectory     ?? "",
      recommendations:    parsed.recommendations     ?? "",
      dataContext,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI 助手对话（带组织记忆上下文）
// ---------------------------------------------------------------------------

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatResponse = {
  reply: string;
  error?: string;
};

/**
 * 与 AI 助手对话。
 * AI 拥有完整的「组织记忆」上下文，随着数据积累会越来越了解你的团队。
 *
 * @param message 本轮用户消息
 * @param history 历史对话（最近 N 轮）
 */
export async function chatWithAssistant(
  message: string,
  history: AssistantMessage[] = [],
): Promise<ChatResponse> {
  if (!isAIConfigured()) {
    return { reply: "", error: "AI 功能未配置" };
  }

  const user = await getCurrentUser();
  if (!user) return { reply: "", error: "请先登录" };

  // ── 1. 拉取组织记忆 ──────────────────────────────────────────────────
  const memoryContext = await buildMemoryContext();

  // ── 2. 拉取当前关键指标（实时数据） ─────────────────────────────────
  let realtimeContext = "";
  try {
    const [overview, positive, memberWorkload] = await Promise.all([
      getOverviewStats(),
      getPositiveStats(),
      getMemberWorkload(),
    ]);

    const today = new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
    realtimeContext = [
      `=== 当前实时状态（${today}）===`,
      `今日更新：${positive.todayProgressUpdates} 条 | 今日完成：${positive.todayClosedResolved} 个 | 今日新增：${positive.todayNewIssues} 个`,
      `待关注：逾期 ${overview.overdueCount} | 阻塞 ${overview.blockedCount} | 紧急 ${overview.urgentCount} | 今日未更新 ${overview.noUpdateToday}`,
      `成员当前在办（前5）：${memberWorkload.slice(0, 5).map((m) => `${m.name} ${m.total}个`).join("，")}`,
    ].join("\n");
  } catch {
    realtimeContext = "（实时数据暂时无法获取）";
  }

  // ── 3. 构建系统提示 ──────────────────────────────────────────────────
  const systemPrompt = [
    "你是这家游戏公司的专属 AI 管理助理。",
    "你深度了解公司的研发项目、团队成员工作情况、协作流程和历史规律。",
    "你会基于积累的组织记忆和实时数据，给出专业、有针对性的分析和建议。",
    "",
    "行为准则：",
    "- 使用简体中文，语言直接、有洞察力、专业",
    "- 回答时优先引用你已知的组织记忆和实时数据，不要泛泛而谈",
    "- 如果问到某个成员，结合ta的画像来回答",
    "- 如果问到模块/项目，结合模块健康度来回答",
    "- 如果问到整体情况，综合组织洞察和实时数据",
    "- 如果记忆里暂时没有相关信息，诚实告知并说明下次学习后会知道",
    "- 不要编造数据，不要空洞套话",
    "- 回答长度匹配问题复杂度：简单问题简短回答，分析类问题可适当展开",
    "",
    memoryContext || "（暂无积累的组织记忆，建议先运行一次学习任务）",
    "",
    realtimeContext,
  ].join("\n");

  // ── 4. 构建对话历史 ──────────────────────────────────────────────────
  const messages: AIChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  // ── 5. 记录交互事件 ──────────────────────────────────────────────────
  await logInteractionEvent(user.id, "ai_chat", {
    metadata: { messageLength: message.length, hasHistory: history.length > 0 },
  });

  // ── 6. 调用 AI ────────────────────────────────────────────────────────
  const reply = await chatCompletionFromMessages(messages, {
    maxTokens: 2048,
    disableThinking: true,
  });

  if (!reply) {
    return { reply: "", error: "AI 暂时无法响应，请稍后再试" };
  }

  return { reply };
}
