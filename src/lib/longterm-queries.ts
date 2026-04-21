/**
 * 长期报告专用查询（30天纵向视角）
 *
 * 所有函数使用 admin client 绕过 RLS，失败时返回安全默认值。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds } from "@/lib/dates";
import type { IssueStatus } from "@/types";

function tryDB() {
  try { return createAdminClient(); } catch { return null; }
}

function toShanghaiBound(daysAgo: number, end = false) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y  = parts.find(p => p.type === "year")?.value  ?? "";
  const mo = parts.find(p => p.type === "month")?.value ?? "";
  const dy = parts.find(p => p.type === "day")?.value   ?? "";
  const dateStr = `${y}-${mo}-${dy}`;
  return new Date(`${dateStr}T${end ? "23:59:59.999" : "00:00:00"}+08:00`).toISOString();
}

// ─── 返回类型 ────────────────────────────────────────────────────────────────

export type TrendDay30 = {
  dateStr: string;
  newIssues: number;
  closedIssues: number;
};

export type LifecycleStats = {
  /** 过去30天关闭/解决的工单数 */
  closedCount: number;
  /** 平均解决时长（天），null 表示无数据 */
  avgResolutionDays: number | null;
  /** 中位解决时长（天）*/
  medianResolutionDays: number | null;
  /** 解决时长分布 */
  resolutionBuckets: { label: string; count: number }[];
  /** 曾经历返修（pending_rework 或 reopen_count > 0）的工单数 */
  reworkCount: number;
  /** 返修率 0-100 */
  reworkRate: number | null;
  /** 曾被阻塞的工单数（在关闭的工单中） */
  everBlockedCount: number;
  /** 当前存量工单的年龄分布 */
  openAgeBuckets: { label: string; count: number }[];
};

export type MemberLongTermRow = {
  userId: string;
  name: string;
  /** 30天人工进展更新条数 */
  updates30: number;
  /** 30天关闭/解决的工单数（作为负责人） */
  closed30: number;
  /** 30天新建工单数（作为创建者） */
  created30: number;
  /** 30天发出的交接次数 */
  handoversSent30: number;
  /** 30天收到的交接次数 */
  handoversReceived30: number;
  /** 30天评论数 */
  comments30: number;
  /** 当前在办数量 */
  currentOpen: number;
  /** 活跃天数（30天内有 update 记录的不同日期数） */
  activeDays30: number;
};

export type StatusFlowRow = {
  from: string;
  to: string;
  count: number;
};

export type HandoverStats = {
  /** 30天内交接总次数 */
  total: number;
  /** 退回（return）次数 */
  returnCount: number;
  /** 退回率 0-100 */
  returnRate: number | null;
  /** 前5最活跃交接对 */
  topPairs: { fromName: string; toName: string; count: number }[];
};

export type ModuleLifecycle = {
  module: string;
  openCount: number;
  closedLast30: number;
  avgResolutionDays: number | null;
  overdueRate: number | null;
};

// ─── 30天每日趋势 ────────────────────────────────────────────────────────────

export async function get30DayTrend(): Promise<TrendDay30[]> {
  const db = tryDB();

  // 生成过去30天的日期字符串
  const days: { dateStr: string; startIso: string; endIso: string }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y  = parts.find(p => p.type === "year")?.value  ?? "";
    const mo = parts.find(p => p.type === "month")?.value ?? "";
    const dy = parts.find(p => p.type === "day")?.value   ?? "";
    const dateStr  = `${y}-${mo}-${dy}`;
    const startIso = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
    const endIso   = new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
    days.push({ dateStr, startIso, endIso });
  }

  if (!db) return days.map(d => ({ dateStr: d.dateStr, newIssues: 0, closedIssues: 0 }));

  const weekStart = days[0].startIso;
  const weekEnd   = days[29].endIso;

  const [createdRes, closedRes] = await Promise.all([
    db.from("issues").select("created_at").gte("created_at", weekStart).lte("created_at", weekEnd),
    db.from("issues").select("closed_at").gte("closed_at", weekStart).lte("closed_at", weekEnd).not("closed_at", "is", null),
  ]);

  function toDateStr(iso: string) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    return `${p.find(x => x.type === "year")?.value}-${p.find(x => x.type === "month")?.value}-${p.find(x => x.type === "day")?.value}`;
  }

  const createdMap = new Map<string, number>();
  for (const r of (createdRes.data ?? []) as { created_at: string }[]) {
    const d = toDateStr(r.created_at);
    createdMap.set(d, (createdMap.get(d) ?? 0) + 1);
  }
  const closedMap = new Map<string, number>();
  for (const r of (closedRes.data ?? []) as { closed_at: string }[]) {
    const d = toDateStr(r.closed_at!);
    closedMap.set(d, (closedMap.get(d) ?? 0) + 1);
  }

  return days.map(d => ({
    dateStr:      d.dateStr,
    newIssues:    createdMap.get(d.dateStr) ?? 0,
    closedIssues: closedMap.get(d.dateStr) ?? 0,
  }));
}

// ─── 工单生命周期统计 ────────────────────────────────────────────────────────

export async function getIssueLifecycleStats(): Promise<LifecycleStats> {
  const db = tryDB();
  const empty: LifecycleStats = {
    closedCount: 0, avgResolutionDays: null, medianResolutionDays: null,
    resolutionBuckets: [], reworkCount: 0, reworkRate: null,
    everBlockedCount: 0, openAgeBuckets: [],
  };
  if (!db) return empty;

  const thirtyDaysAgo = toShanghaiBound(30);
  const todayStr = getChinaDayBounds().dateStr;
  const now = Date.now();

  const [closedRes, reworkRes, openAgeRes] = await Promise.all([
    // 过去30天关闭的工单，获取创建时间和关闭时间 + 是否曾被阻塞
    db.from("issues")
      .select("created_at, closed_at, resolved_at, status, reopen_count, blocked_reason")
      .in("status", ["resolved", "closed"])
      .gte("closed_at", thirtyDaysAgo)
      .not("closed_at", "is", null),

    // 曾进入返修状态的工单（通过 status_from/to 追踪）
    db.from("issue_updates")
      .select("issue_id")
      .eq("status_to", "pending_rework")
      .gte("created_at", thirtyDaysAgo),

    // 当前未关闭工单（用于年龄分布）
    db.from("issues")
      .select("created_at")
      .not("status", "in", '("resolved","closed")'),
  ]);

  // 解决时长计算
  const closedRows = (closedRes.data ?? []) as {
    created_at: string; closed_at: string | null; resolved_at: string | null;
    status: string; reopen_count: number; blocked_reason: string | null;
  }[];

  const resolutionDays: number[] = [];
  let everBlockedCount = 0;

  for (const r of closedRows) {
    const endTime = r.closed_at ?? r.resolved_at;
    if (endTime) {
      const days = (new Date(endTime).getTime() - new Date(r.created_at).getTime()) / 86_400_000;
      resolutionDays.push(Math.max(0, days));
    }
    if (r.blocked_reason || r.reopen_count > 0) everBlockedCount++;
  }

  const closedCount = closedRows.length;
  let avgResolutionDays: number | null = null;
  let medianResolutionDays: number | null = null;

  if (resolutionDays.length > 0) {
    avgResolutionDays = Math.round((resolutionDays.reduce((a, b) => a + b, 0) / resolutionDays.length) * 10) / 10;
    const sorted = [...resolutionDays].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianResolutionDays = Math.round((sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]) * 10) / 10;
  }

  const resolutionBuckets = [
    { label: "1天以内",   min: 0,  max: 1 },
    { label: "1-3天",     min: 1,  max: 3 },
    { label: "3-7天",     min: 3,  max: 7 },
    { label: "7-30天",    min: 7,  max: 30 },
    { label: "30天以上",  min: 30, max: Infinity },
  ].map(b => ({
    label: b.label,
    count: resolutionDays.filter(d => d >= b.min && d < b.max).length,
  }));

  // 返修率
  const reworkIssueIds = new Set((reworkRes.data ?? []).map((r: { issue_id: string }) => r.issue_id));
  const reworkCount = reworkIssueIds.size;
  const reworkRate = closedCount > 0 ? Math.round((reworkCount / closedCount) * 1000) / 10 : null;

  // 当前存量工单年龄分布
  const openRows = (openAgeRes.data ?? []) as { created_at: string }[];
  const openAgeBuckets = [
    { label: "7天以内",   min: 0,  max: 7 },
    { label: "7-30天",    min: 7,  max: 30 },
    { label: "30-60天",   min: 30, max: 60 },
    { label: "60天以上",  min: 60, max: Infinity },
  ].map(b => ({
    label: b.label,
    count: openRows.filter(r => {
      const ageDays = (now - new Date(r.created_at).getTime()) / 86_400_000;
      return ageDays >= b.min && ageDays < b.max;
    }).length,
  }));

  return { closedCount, avgResolutionDays, medianResolutionDays, resolutionBuckets, reworkCount, reworkRate, everBlockedCount, openAgeBuckets };
}

// ─── 成员30天长期效能 ────────────────────────────────────────────────────────

export async function getMember30DayStats(): Promise<MemberLongTermRow[]> {
  const db = tryDB();
  if (!db) return [];

  const thirtyDaysAgo = toShanghaiBound(30);

  const [usersRes, updatesRes, closedRes, createdRes, handoversRes, commentsRes, openRes] = await Promise.all([
    db.from("users").select("id, name"),
    db.from("issue_updates")
      .select("user_id, created_at")
      .gte("created_at", thirtyDaysAgo)
      .eq("is_system_generated", false),
    db.from("issues")
      .select("assignee_id")
      .in("status", ["resolved", "closed"])
      .gte("closed_at", thirtyDaysAgo),
    db.from("issues")
      .select("creator_id")
      .gte("created_at", thirtyDaysAgo),
    db.from("issue_handovers")
      .select("from_user_id, to_user_id")
      .gte("created_at", thirtyDaysAgo),
    db.from("issue_update_comments")
      .select("user_id")
      .gte("created_at", thirtyDaysAgo),
    db.from("issues")
      .select("assignee_id")
      .not("status", "in", '("resolved","closed")')
      .not("assignee_id", "is", null),
  ]);

  const users = (usersRes.data ?? []) as { id: string; name: string }[];

  // 计算每个成员的活跃天数
  const updateRows = (updatesRes.data ?? []) as { user_id: string; created_at: string }[];
  const activeDaysMap = new Map<string, Set<string>>();
  const updates30Map  = new Map<string, number>();

  for (const r of updateRows) {
    updates30Map.set(r.user_id, (updates30Map.get(r.user_id) ?? 0) + 1);
    const dayStr = r.created_at.slice(0, 10);
    if (!activeDaysMap.has(r.user_id)) activeDaysMap.set(r.user_id, new Set());
    activeDaysMap.get(r.user_id)!.add(dayStr);
  }

  const closed30Map  = new Map<string, number>();
  for (const r of (closedRes.data ?? []) as { assignee_id: string | null }[]) {
    if (r.assignee_id) closed30Map.set(r.assignee_id, (closed30Map.get(r.assignee_id) ?? 0) + 1);
  }

  const created30Map = new Map<string, number>();
  for (const r of (createdRes.data ?? []) as { creator_id: string }[]) {
    created30Map.set(r.creator_id, (created30Map.get(r.creator_id) ?? 0) + 1);
  }

  const handoversSentMap     = new Map<string, number>();
  const handoversReceivedMap = new Map<string, number>();
  for (const r of (handoversRes.data ?? []) as { from_user_id: string; to_user_id: string }[]) {
    handoversSentMap.set(r.from_user_id, (handoversSentMap.get(r.from_user_id) ?? 0) + 1);
    handoversReceivedMap.set(r.to_user_id, (handoversReceivedMap.get(r.to_user_id) ?? 0) + 1);
  }

  const comments30Map = new Map<string, number>();
  for (const r of (commentsRes.data ?? []) as { user_id: string }[]) {
    comments30Map.set(r.user_id, (comments30Map.get(r.user_id) ?? 0) + 1);
  }

  const currentOpenMap = new Map<string, number>();
  for (const r of (openRes.data ?? []) as { assignee_id: string | null }[]) {
    if (r.assignee_id) currentOpenMap.set(r.assignee_id, (currentOpenMap.get(r.assignee_id) ?? 0) + 1);
  }

  return users.map(u => ({
    userId:             u.id,
    name:               u.name,
    updates30:          updates30Map.get(u.id) ?? 0,
    closed30:           closed30Map.get(u.id) ?? 0,
    created30:          created30Map.get(u.id) ?? 0,
    handoversSent30:    handoversSentMap.get(u.id) ?? 0,
    handoversReceived30: handoversReceivedMap.get(u.id) ?? 0,
    comments30:         comments30Map.get(u.id) ?? 0,
    currentOpen:        currentOpenMap.get(u.id) ?? 0,
    activeDays30:       activeDaysMap.get(u.id)?.size ?? 0,
  })).filter(m =>
    m.updates30 > 0 || m.closed30 > 0 || m.created30 > 0 || m.currentOpen > 0
  ).sort((a, b) => (b.updates30 + b.closed30 * 2) - (a.updates30 + a.closed30 * 2));
}

// ─── 状态流转分析 ────────────────────────────────────────────────────────────

export async function getStatusFlowStats(): Promise<StatusFlowRow[]> {
  const db = tryDB();
  if (!db) return [];

  const thirtyDaysAgo = toShanghaiBound(30);

  const { data } = await db
    .from("issue_updates")
    .select("status_from, status_to")
    .gte("created_at", thirtyDaysAgo)
    .not("status_from", "is", null)
    .not("status_to",   "is", null)
    .neq("status_from", "")
    .neq("status_to",   "");

  const rows = (data ?? []) as { status_from: string; status_to: string }[];
  const countMap = new Map<string, number>();
  for (const r of rows) {
    if (r.status_from === r.status_to) continue;
    const key = `${r.status_from}→${r.status_to}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  return [...countMap.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split("→");
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// ─── 交接行为统计 ────────────────────────────────────────────────────────────

export async function getHandoverStats(): Promise<HandoverStats> {
  const db = tryDB();
  const empty: HandoverStats = { total: 0, returnCount: 0, returnRate: null, topPairs: [] };
  if (!db) return empty;

  const thirtyDaysAgo = toShanghaiBound(30);

  const [handoversRes, usersRes] = await Promise.all([
    db.from("issue_handovers").select("from_user_id, to_user_id, kind").gte("created_at", thirtyDaysAgo),
    db.from("users").select("id, name"),
  ]);

  const rows = (handoversRes.data ?? []) as { from_user_id: string; to_user_id: string; kind: string }[];
  const userMap = new Map(((usersRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name]));

  const total       = rows.length;
  const returnCount = rows.filter(r => r.kind === "return").length;
  const returnRate  = total > 0 ? Math.round((returnCount / total) * 1000) / 10 : null;

  const pairMap = new Map<string, number>();
  for (const r of rows.filter(r => r.kind === "handover")) {
    const key = `${r.from_user_id}→${r.to_user_id}`;
    pairMap.set(key, (pairMap.get(key) ?? 0) + 1);
  }

  const topPairs = [...pairMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => {
      const [fromId, toId] = key.split("→");
      return { fromName: userMap.get(fromId) ?? fromId, toName: userMap.get(toId) ?? toId, count };
    });

  return { total, returnCount, returnRate, topPairs };
}

// ─── 模块/分类生命周期健康 ───────────────────────────────────────────────────

export async function getModuleLifecycle(): Promise<ModuleLifecycle[]> {
  const db = tryDB();
  if (!db) return [];

  const thirtyDaysAgo = toShanghaiBound(30);
  const todayStr = getChinaDayBounds().dateStr;

  const [openRes, closedRes] = await Promise.all([
    db.from("issues")
      .select("module, due_date")
      .not("status", "in", '("resolved","closed")'),
    db.from("issues")
      .select("module, created_at, closed_at")
      .in("status", ["resolved", "closed"])
      .gte("closed_at", thirtyDaysAgo)
      .not("closed_at", "is", null),
  ]);

  const openRows   = (openRes.data ?? []) as { module: string | null; due_date: string | null }[];
  const closedRows = (closedRes.data ?? []) as { module: string | null; created_at: string; closed_at: string }[];

  const modules = new Set([
    ...openRows.map(r => r.module ?? "(未分类)"),
    ...closedRows.map(r => r.module ?? "(未分类)"),
  ]);

  return [...modules].map(module => {
    const open   = openRows.filter(r => (r.module ?? "(未分类)") === module);
    const closed = closedRows.filter(r => (r.module ?? "(未分类)") === module);

    const openCount     = open.length;
    const closedLast30  = closed.length;
    const overdueCount  = open.filter(r => r.due_date && r.due_date < todayStr).length;
    const overdueRate   = openCount > 0 ? Math.round((overdueCount / openCount) * 1000) / 10 : null;

    const days = closed.map(r => Math.max(0, (new Date(r.closed_at).getTime() - new Date(r.created_at).getTime()) / 86_400_000));
    const avgResolutionDays = days.length > 0
      ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10
      : null;

    return { module, openCount, closedLast30, avgResolutionDays, overdueRate };
  })
    .filter(r => r.openCount > 0 || r.closedLast30 > 0)
    .sort((a, b) => b.openCount - a.openCount)
    .slice(0, 12);
}

// ─── 通知系统30天健康 ────────────────────────────────────────────────────────

export type NotifHealth30 = {
  total: number;
  failed: number;
  failureRate: number | null;
  /** 每周失败率：[ { weekLabel, failureRate } ] */
  weeklyTrend: { weekLabel: string; total: number; failed: number }[];
};

export async function getNotifHealth30(): Promise<NotifHealth30> {
  const db = tryDB();
  const empty: NotifHealth30 = { total: 0, failed: 0, failureRate: null, weeklyTrend: [] };
  if (!db) return empty;

  const thirtyDaysAgo = toShanghaiBound(30);

  const { data } = await db
    .from("notification_deliveries")
    .select("status, created_at")
    .gte("created_at", thirtyDaysAgo);

  const rows = (data ?? []) as { status: string; created_at: string }[];
  const total  = rows.length;
  const failed = rows.filter(r => r.status === "failed").length;
  const failureRate = total > 0 ? Math.round((failed / total) * 1000) / 10 : null;

  // 按周分组（过去4周）
  const weeks = [
    { label: "第4周前", daysAgoStart: 30, daysAgoEnd: 22 },
    { label: "第3周",   daysAgoStart: 21, daysAgoEnd: 15 },
    { label: "第2周",   daysAgoStart: 14, daysAgoEnd: 8  },
    { label: "最近7天", daysAgoStart: 7,  daysAgoEnd: 0  },
  ];

  const weeklyTrend = weeks.map(w => {
    const start = toShanghaiBound(w.daysAgoStart);
    const end   = toShanghaiBound(w.daysAgoEnd, true);
    const weekRows = rows.filter(r => r.created_at >= start && r.created_at <= end);
    return {
      weekLabel: w.label,
      total:  weekRows.length,
      failed: weekRows.filter(r => r.status === "failed").length,
    };
  });

  return { total, failed, failureRate, weeklyTrend };
}

// ─── 综合汇总：一次性收集所有长期数据 ───────────────────────────────────────

export type LongTermData = {
  trend30:      TrendDay30[];
  lifecycle:    LifecycleStats;
  members:      MemberLongTermRow[];
  statusFlow:   StatusFlowRow[];
  handovers:    HandoverStats;
  modules:      ModuleLifecycle[];
  notifHealth:  NotifHealth30;
};

export async function collectLongTermData(): Promise<LongTermData> {
  const [trend30, lifecycle, members, statusFlow, handovers, modules, notifHealth] = await Promise.all([
    get30DayTrend(),
    getIssueLifecycleStats(),
    getMember30DayStats(),
    getStatusFlowStats(),
    getHandoverStats(),
    getModuleLifecycle(),
    getNotifHealth30(),
  ]);
  return { trend30, lifecycle, members, statusFlow, handovers, modules, notifHealth };
}
