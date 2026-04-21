/**
 * Dashboard 查询服务（P2）
 *
 * 统一封装管理驾驶舱所需的全部聚合查询，使用 admin client 以：
 * 1. 绕过 RLS 直接读取 notification_deliveries 等管理表
 * 2. 保证统计口径不受当前用户权限影响
 *
 * 所有函数失败时返回安全默认值，不抛出。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds } from "@/lib/dates";
import type { IssueStatus, IssuePriority } from "@/types";

// ─── 内部 helpers ──────────────────────────────────────────────────────────

function tryDB() {
  try { return createAdminClient(); } catch { return null; }
}

/** 获取过去 N 天（含今天）的上海时区日期边界数组，index 0 = 最旧 */
function getLast7Days(): { dateStr: string; startIso: string; endIso: string }[] {
  const days: { dateStr: string; startIso: string; endIso: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d);
    const y  = parts.find((p) => p.type === "year")?.value  ?? "";
    const mo = parts.find((p) => p.type === "month")?.value ?? "";
    const dy = parts.find((p) => p.type === "day")?.value   ?? "";
    const dateStr  = `${y}-${mo}-${dy}`;
    const startIso = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
    const endIso   = new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
    days.push({ dateStr, startIso, endIso });
  }
  return days;
}

const ACTIVE_STATUSES: IssueStatus[]         = ["in_progress", "blocked", "pending_review", "pending_rework"];
const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

// ─── 返回类型 ──────────────────────────────────────────────────────────────

export type OverviewStats = {
  noUpdateToday:    number;
  overdueCount:     number;
  blockedCount:     number;
  urgentCount:      number;
  stale3DaysCount:  number;
  todayNotifFailed: number;
  todayNotifTotal:  number;
  todayReminders:   number;
};

export type HighRiskIssue = {
  id:               string;
  title:            string;
  status:           IssueStatus;
  priority:         IssuePriority;
  assigneeName:     string | null;
  reviewerName:     string | null;
  dueDate:          string | null;
  lastActivityAt:   string | null;
  /**
   * 仅用于 dashboard 排序的启发式分数，不是流程规则或 KPI 真值。
   * 算法：urgent+4 / overdue+3 / stale+2 / blocked+2 / 每7天增龄+1
   */
  riskRankScore:    number;
  riskTags:         ("urgent" | "overdue" | "stale" | "blocked")[];
  daysSinceActivity: number;
};

export type MemberWorkloadRow = {
  userId:        string;
  name:          string;
  email:         string;
  wecomUserId:   string | null;
  total:         number;
  overdue:       number;
  blocked:       number;
  stale:         number;
  urgent:        number;
  updates7Days:  number;
  lastActivityAt: string | null;
};

export type GroupStat = {
  label:   string;
  total:   number;
  overdue: number;
  blocked: number;
  urgent:  number;
};

export type ModuleCategoryStats = {
  modules:    GroupStat[];
  categories: GroupStat[];
};

export type TrendDay = {
  dateStr:      string;
  newIssues:    number;
  closedIssues: number;
  reminders:    number;
  notifFailed:  number;
};

export type NotificationHealth = {
  todayTotal:       number;
  todaySuccess:     number;
  todayFailed:      number;
  /** 今日失败率 0-100，保留1位小数。总量为0时返回 null */
  todayFailureRate: number | null;
  weekTotal:        number;
  weekFailed:       number;
  /** 近7天失败率 0-100，保留1位小数 */
  weekFailureRate:  number | null;
  topErrors:        { code: string; count: number }[];
  recentFailures:   {
    id: string;
    errorCode:         string | null;
    errorMessage:      string | null;
    targetWecomUserid: string | null;
    triggerSource:     string;
    createdAt:         string;
    targetUserName?:   string | null;
  }[];
};

// ─── 正向协作指标 ──────────────────────────────────────────────────────────

export type PositiveStats = {
  todayProgressUpdates: number;
  todayClosedResolved:  number;
  todayNewIssues:       number;
  weekClosedResolved:   number;
  activeContributors:   number;
  todayHandovers:       number;
};

export async function getPositiveStats(): Promise<PositiveStats> {
  const db = tryDB();
  if (!db) return { todayProgressUpdates: 0, todayClosedResolved: 0, todayNewIssues: 0, weekClosedResolved: 0, activeContributors: 0, todayHandovers: 0 };

  const { startIso, endIso } = getChinaDayBounds();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [updatesRes, closedTodayRes, newTodayRes, closedWeekRes, contributorsRes, handoversRes] = await Promise.all([
    db.from("issue_updates").select("id", { count: "exact", head: true }).gte("created_at", startIso).lte("created_at", endIso).eq("is_system_generated", false),
    db.from("issues").select("id", { count: "exact", head: true }).gte("closed_at", startIso).lte("closed_at", endIso).in("status", ["resolved", "closed"]),
    db.from("issues").select("id", { count: "exact", head: true }).gte("created_at", startIso).lte("created_at", endIso),
    db.from("issues").select("id", { count: "exact", head: true }).gte("closed_at", sevenDaysAgo).in("status", ["resolved", "closed"]),
    db.from("issue_updates").select("user_id").gte("created_at", sevenDaysAgo).eq("is_system_generated", false),
    db.from("issue_events").select("id", { count: "exact", head: true }).eq("event_type", "handover").gte("created_at", startIso).lte("created_at", endIso),
  ]);

  const contributorIds = new Set(((contributorsRes.data ?? []) as { user_id: string }[]).map(r => r.user_id));

  return {
    todayProgressUpdates: updatesRes.count ?? 0,
    todayClosedResolved:  closedTodayRes.count ?? 0,
    todayNewIssues:       newTodayRes.count ?? 0,
    weekClosedResolved:   closedWeekRes.count ?? 0,
    activeContributors:   contributorIds.size,
    todayHandovers:       handoversRes.count ?? 0,
  };
}

// ─── 今日总览统计 ──────────────────────────────────────────────────────────

export async function getOverviewStats(): Promise<OverviewStats> {
  const db = tryDB();
  if (!db) return { noUpdateToday: 0, overdueCount: 0, blockedCount: 0, urgentCount: 0, stale3DaysCount: 0, todayNotifFailed: 0, todayNotifTotal: 0, todayReminders: 0 };

  const { startIso, endIso, dateStr: todayStr } = getChinaDayBounds();
  const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const [
    activeIssues,
    todayUpdates,
    overdueRes,
    blockedRes,
    urgentRes,
    staleRes,
    notifRes,
    reminderRes,
  ] = await Promise.all([
    db.from("issues").select("id").in("status", ACTIVE_STATUSES),
    db.from("issue_updates").select("issue_id").gte("created_at", startIso).lte("created_at", endIso).eq("is_system_generated", false),
    db.from("issues").select("id", { count: "exact", head: true }).lt("due_date", todayStr).not("status", "in", '("resolved","closed")'),
    db.from("issues").select("id", { count: "exact", head: true }).eq("status", "blocked"),
    db.from("issues").select("id", { count: "exact", head: true }).eq("priority", "urgent").not("status", "in", '("resolved","closed")'),
    db.from("issues").select("id", { count: "exact", head: true }).in("status", ACTIVE_STATUSES).lt("last_activity_at", staleThreshold),
    db.from("notification_deliveries").select("status").gte("created_at", startIso).lte("created_at", endIso),
    db.from("reminders").select("id", { count: "exact", head: true }).gte("created_at", startIso).lte("created_at", endIso),
  ]);

  const activeIds   = new Set((activeIssues.data ?? []).map((r) => r.id as string));
  const updatedIds  = new Set((todayUpdates.data ?? []).map((r) => r.issue_id as string));
  const noUpdateToday = [...activeIds].filter((id) => !updatedIds.has(id)).length;

  const notifRows = (notifRes.data ?? []) as { status: string }[];
  const todayNotifTotal  = notifRows.length;
  const todayNotifFailed = notifRows.filter((r) => r.status === "failed").length;

  return {
    noUpdateToday,
    overdueCount:    overdueRes.count ?? 0,
    blockedCount:    blockedRes.count ?? 0,
    urgentCount:     urgentRes.count  ?? 0,
    stale3DaysCount: staleRes.count   ?? 0,
    todayNotifFailed,
    todayNotifTotal,
    todayReminders:  reminderRes.count ?? 0,
  };
}

// ─── 高风险工单 ────────────────────────────────────────────────────────────

export async function getHighRiskIssues(limit = 20): Promise<HighRiskIssue[]> {
  const db = tryDB();
  if (!db) return [];

  const todayStr       = getChinaDayBounds().dateStr;
  const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString();

  const { data, error } = await db
    .from("issues")
    .select(`
      id, title, status, priority, due_date, last_activity_at,
      assignee:users!issues_assignee_id_fkey(id, name),
      reviewer:users!issues_reviewer_id_fkey(id, name)
    `)
    .not("status", "in", '("resolved","closed")')
    .order("last_activity_at", { ascending: true })
    .limit(200);

  if (error || !data) return [];

  const now = Date.now();

  const withScores = (data as {
    id: string; title: string; status: string; priority: string;
    due_date: string | null; last_activity_at: string | null;
    assignee: { name: string } | { name: string }[] | null;
    reviewer: { name: string } | { name: string }[] | null;
  }[]).map((row) => {
    const assigneeRaw = Array.isArray(row.assignee) ? row.assignee[0] : row.assignee;
    const reviewerRaw = Array.isArray(row.reviewer) ? row.reviewer[0] : row.reviewer;

    const isOverdue = Boolean(row.due_date && row.due_date < todayStr);
    const isBlocked = row.status === "blocked";
    const isUrgent  = row.priority === "urgent";
    const isActive  = ACTIVE_STATUSES.includes(row.status as IssueStatus);
    const isStale   = isActive && Boolean(row.last_activity_at && row.last_activity_at < staleThreshold);

    const daysSinceActivity = row.last_activity_at
      ? Math.floor((now - new Date(row.last_activity_at).getTime()) / 86_400_000)
      : 999;

    let score = 0;
    if (isUrgent)  score += 4;
    if (isOverdue) score += 3;
    if (isStale)   score += 2;
    if (isBlocked) score += 2;
    score += Math.min(3, Math.floor(daysSinceActivity / 7));

    const riskTags: HighRiskIssue["riskTags"] = [];
    if (isUrgent)  riskTags.push("urgent");
    if (isOverdue) riskTags.push("overdue");
    if (isStale)   riskTags.push("stale");
    if (isBlocked) riskTags.push("blocked");

    return {
      id:               row.id,
      title:            row.title,
      status:           row.status as IssueStatus,
      priority:         row.priority as IssuePriority,
      assigneeName:     assigneeRaw?.name ?? null,
      reviewerName:     reviewerRaw?.name ?? null,
      dueDate:          row.due_date,
      lastActivityAt:   row.last_activity_at,
      riskRankScore:    score,
      riskTags,
      daysSinceActivity,
    };
  });

  return withScores
    .filter((r) => r.riskRankScore > 0 || r.status !== "todo")
    .sort((a, b) => {
      if (b.riskRankScore !== a.riskRankScore) return b.riskRankScore - a.riskRankScore;
      return (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    })
    .slice(0, limit);
}

// ─── 成员工作负载 ──────────────────────────────────────────────────────────

export async function getMemberWorkload(): Promise<MemberWorkloadRow[]> {
  const db = tryDB();
  if (!db) return [];

  const todayStr       = getChinaDayBounds().dateStr;
  const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const sevenDaysAgo   = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [usersRes, issuesRes, updatesRes] = await Promise.all([
    db.from("users").select("id, name, email, wecom_userid").order("name"),
    db.from("issues").select("id, status, priority, due_date, last_activity_at, assignee_id").not("status", "in", '("resolved","closed")').not("assignee_id", "is", null),
    db.from("issue_updates").select("user_id").gte("created_at", sevenDaysAgo).eq("is_system_generated", false),
  ]);

  const users   = (usersRes.data ?? []) as { id: string; name: string; email: string; wecom_userid: string | null }[];
  const issues  = (issuesRes.data ?? []) as { id: string; status: string; priority: string; due_date: string | null; last_activity_at: string | null; assignee_id: string }[];
  const updates = (updatesRes.data ?? []) as { user_id: string }[];

  const update7Map = new Map<string, number>();
  for (const u of updates) {
    update7Map.set(u.user_id, (update7Map.get(u.user_id) ?? 0) + 1);
  }

  const lastActivityMap = new Map<string, string | null>();
  for (const issue of issues) {
    const uid = issue.assignee_id;
    const cur = lastActivityMap.get(uid);
    if (!cur || (issue.last_activity_at && issue.last_activity_at > cur)) {
      lastActivityMap.set(uid, issue.last_activity_at);
    }
  }

  const workloadMap = new Map<string, Omit<MemberWorkloadRow, "userId" | "name" | "email" | "wecomUserId" | "updates7Days" | "lastActivityAt">>();
  for (const issue of issues) {
    const uid = issue.assignee_id;
    if (!workloadMap.has(uid)) workloadMap.set(uid, { total: 0, overdue: 0, blocked: 0, stale: 0, urgent: 0 });
    const w = workloadMap.get(uid)!;
    w.total++;
    if (issue.due_date && issue.due_date < todayStr)                                                        w.overdue++;
    if (issue.status === "blocked")                                                                           w.blocked++;
    if (ACTIVE_STATUSES.includes(issue.status as IssueStatus) && issue.last_activity_at && issue.last_activity_at < staleThreshold) w.stale++;
    if (issue.priority === "urgent")                                                                          w.urgent++;
  }

  return users
    .map((u) => ({
      userId:        u.id,
      name:          u.name,
      email:         u.email,
      wecomUserId:   u.wecom_userid,
      ...(workloadMap.get(u.id) ?? { total: 0, overdue: 0, blocked: 0, stale: 0, urgent: 0 }),
      updates7Days:  update7Map.get(u.id) ?? 0,
      lastActivityAt: lastActivityMap.get(u.id) ?? null,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => {
      const sa = a.overdue * 3 + a.blocked * 2 + a.stale * 2 + a.urgent * 2;
      const sb = b.overdue * 3 + b.blocked * 2 + b.stale * 2 + b.urgent * 2;
      return sb - sa || b.total - a.total;
    });
}

// ─── 模块 / 分类分布 ────────────────────────────────────────────────────────

export async function getModuleCategoryStats(): Promise<ModuleCategoryStats> {
  const db = tryDB();
  if (!db) return { modules: [], categories: [] };

  const todayStr = getChinaDayBounds().dateStr;

  const { data } = await db
    .from("issues")
    .select("module, category, status, priority, due_date")
    .not("status", "in", '("resolved","closed")');

  const rows = (data ?? []) as { module: string | null; category: string | null; status: string; priority: string; due_date: string | null }[];

  function aggregate(items: typeof rows, key: "module" | "category"): GroupStat[] {
    const map = new Map<string, GroupStat>();
    for (const r of items) {
      const label = r[key]?.trim() || "(未设置)";
      if (!map.has(label)) map.set(label, { label, total: 0, overdue: 0, blocked: 0, urgent: 0 });
      const g = map.get(label)!;
      g.total++;
      if (r.due_date && r.due_date < todayStr) g.overdue++;
      if (r.status === "blocked")              g.blocked++;
      if (r.priority === "urgent")             g.urgent++;
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 15);
  }

  return {
    modules:    aggregate(rows, "module"),
    categories: aggregate(rows, "category"),
  };
}

// ─── 近 7 天趋势 ────────────────────────────────────────────────────────────

export async function get7DayTrend(): Promise<TrendDay[]> {
  const db = tryDB();
  const days = getLast7Days();
  if (!db) return days.map((d) => ({ dateStr: d.dateStr, newIssues: 0, closedIssues: 0, reminders: 0, notifFailed: 0 }));

  const weekStart = days[0].startIso;
  const weekEnd   = days[6].endIso;

  const [issuesCreated, issuesClosed, remindersRes, notifRes] = await Promise.all([
    db.from("issues").select("created_at").gte("created_at", weekStart).lte("created_at", weekEnd),
    db.from("issues").select("closed_at").gte("closed_at", weekStart).lte("closed_at", weekEnd).not("closed_at", "is", null),
    db.from("reminders").select("created_at").gte("created_at", weekStart).lte("created_at", weekEnd),
    db.from("notification_deliveries").select("created_at, status").gte("created_at", weekStart).lte("created_at", weekEnd).eq("status", "failed"),
  ]);

  function toDateStr(iso: string) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
    return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
  }

  function countByDay(rows: { [k: string]: string | null }[], field: string): Map<string, number> {
    const m = new Map<string, number>();
    for (const r of rows) {
      const iso = r[field];
      if (!iso) continue;
      const d = toDateStr(iso);
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return m;
  }

  const createdMap  = countByDay((issuesCreated.data ?? []) as { created_at: string }[], "created_at");
  const closedMap   = countByDay((issuesClosed.data ?? [])  as { closed_at: string }[], "closed_at");
  const reminderMap = countByDay((remindersRes.data ?? [])  as { created_at: string }[], "created_at");
  const notifMap    = countByDay((notifRes.data ?? [])      as { created_at: string }[], "created_at");

  return days.map((d) => ({
    dateStr:      d.dateStr,
    newIssues:    createdMap.get(d.dateStr)  ?? 0,
    closedIssues: closedMap.get(d.dateStr)   ?? 0,
    reminders:    reminderMap.get(d.dateStr) ?? 0,
    notifFailed:  notifMap.get(d.dateStr)    ?? 0,
  }));
}

// ─── 通知健康度 ────────────────────────────────────────────────────────────

export async function getNotificationHealth(): Promise<NotificationHealth> {
  const db = tryDB();
  const empty: NotificationHealth = {
    todayTotal: 0, todaySuccess: 0, todayFailed: 0, todayFailureRate: null,
    weekTotal: 0, weekFailed: 0, weekFailureRate: null,
    topErrors: [], recentFailures: [],
  };
  if (!db) return empty;

  const { startIso, endIso } = getChinaDayBounds();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [todayRes, weekRes, errorRes, recentRes, usersRes] = await Promise.all([
    db.from("notification_deliveries").select("status").gte("created_at", startIso).lte("created_at", endIso),
    db.from("notification_deliveries").select("status").gte("created_at", sevenDaysAgo),
    db.from("notification_deliveries").select("error_code").eq("status", "failed").gte("created_at", sevenDaysAgo).not("error_code", "is", null),
    db.from("notification_deliveries").select("id, error_code, error_message, target_wecom_userid, target_user_id, trigger_source, created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(10),
    db.from("users").select("id, name"),
  ]);

  const todayRows    = (todayRes.data ?? []) as { status: string }[];
  const todayTotal   = todayRows.length;
  const todaySuccess = todayRows.filter(r => r.status === "success").length;
  const todayFailed  = todayRows.filter(r => r.status === "failed").length;
  const todayFailureRate = todayTotal > 0 ? Math.round((todayFailed / todayTotal) * 1000) / 10 : null;

  const weekRows   = (weekRes.data ?? []) as { status: string }[];
  const weekTotal  = weekRows.length;
  const weekFailed = weekRows.filter(r => r.status === "failed").length;
  const weekFailureRate = weekTotal > 0 ? Math.round((weekFailed / weekTotal) * 1000) / 10 : null;

  const errorCount = new Map<string, number>();
  for (const r of (errorRes.data ?? []) as { error_code: string }[]) {
    if (r.error_code) errorCount.set(r.error_code, (errorCount.get(r.error_code) ?? 0) + 1);
  }
  const topErrors = [...errorCount.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count).slice(0, 5);

  const userNameMap = new Map(((usersRes.data ?? []) as { id: string; name: string }[]).map(u => [u.id, u.name]));

  const recentFailures = ((recentRes.data ?? []) as {
    id: string; error_code: string | null; error_message: string | null;
    target_wecom_userid: string | null; target_user_id: string | null;
    trigger_source: string; created_at: string;
  }[]).map((r) => ({
    id:                r.id,
    errorCode:         r.error_code,
    errorMessage:      r.error_message,
    targetWecomUserid: r.target_wecom_userid,
    triggerSource:     r.trigger_source,
    createdAt:         r.created_at,
    targetUserName:    r.target_user_id ? (userNameMap.get(r.target_user_id) ?? null) : null,
  }));

  return { todayTotal, todaySuccess, todayFailed, todayFailureRate, weekTotal, weekFailed, weekFailureRate, topErrors, recentFailures };
}

// ─── 通知覆盖率 ────────────────────────────────────────────────────────────

export type NotificationCoverage = {
  total: number;
  withWecom: number;
  withoutWecom: number;
  coverageRate: number;
};

export async function getNotificationCoverage(): Promise<NotificationCoverage> {
  const db = tryDB();
  if (!db) return { total: 0, withWecom: 0, withoutWecom: 0, coverageRate: 0 };

  const { data } = await db.from("users").select("wecom_userid");
  const rows = (data ?? []) as { wecom_userid: string | null }[];
  const total = rows.length;
  const withWecom = rows.filter(r => r.wecom_userid?.trim()).length;
  return {
    total,
    withWecom,
    withoutWecom: total - withWecom,
    coverageRate: total > 0 ? Math.round((withWecom / total) * 100) : 0,
  };
}
