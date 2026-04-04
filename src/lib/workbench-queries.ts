import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getChinaDayBounds } from "@/lib/dates";
import { ACTIVE_STATUSES } from "@/lib/constants";
import type { IssueEventType, IssuePriority, IssueWithRelations } from "@/types";

function reminderSubtypeLabel(payload: Record<string, unknown> | null | undefined): string | null {
  const t = payload && typeof payload === "object" ? (payload as { type?: string }).type : undefined;
  if (t === "no_update_today") return "今日待同步";
  if (t === "overdue") return "已逾期";
  if (t === "stale_3_days") return "3天未更新";
  return null;
}

/** 工作台动态流展示用（reminder_created 会带 payload 子类型） */
export function formatWorkbenchEventLabel(
  eventType: IssueEventType,
  eventPayload?: Record<string, unknown> | null
): string {
  if (eventType === "reminder_created") {
    const sub = reminderSubtypeLabel(eventPayload ?? null);
    return sub ? `生成了提醒（${sub}）` : "生成了提醒";
  }
  const map: Record<Exclude<IssueEventType, "reminder_created">, string> = {
    issue_created: "创建了工单",
    issue_updated: "更新了进展",
    assignee_changed: "变更了负责人",
    reviewer_changed: "变更了验收人",
    status_changed: "变更了状态",
    priority_changed: "变更了优先级",
    due_date_changed: "变更了截止日期",
    reminder_sent: "发送了提醒",
    notification_delivery_success: "通知已送达",
    notification_delivery_failed: "通知未送达",
    issue_reopened: "重新打开了工单",
    issue_closed: "关闭了工单",
    handover: "交接了任务",
    handover_return: "退回了任务",
  };
  return map[eventType] ?? eventType;
}

const issueSelect = `
  *,
  assignee:users!issues_assignee_id_fkey(id, email, name, role, avatar_url, created_at, updated_at),
  reviewer:users!issues_reviewer_id_fkey(id, email, name, role, avatar_url, created_at, updated_at),
  creator:users!issues_creator_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
`;

const NOISE_EVENT_TYPES: IssueEventType[] = [
  "notification_delivery_success",
  "notification_delivery_failed",
];

const PRI_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type WorkbenchStats = {
  assignedOpen: number;
  needUpdateToday: number;
  overdue: number;
  unreadReminders: number;
};

export type WorkbenchEventRow = {
  id: string;
  issue_id: string;
  event_type: IssueEventType;
  created_at: string;
  event_payload: Record<string, unknown>;
  actor: { id: string; name: string } | null;
  issue: { id: string; title: string } | null;
};

/** 同一工单、同一事件类型、同一分钟内、同一提醒子类型只保留一条（避免 cron 重复写入或重复展示） */
function dedupeWorkbenchEvents(rows: WorkbenchEventRow[]): WorkbenchEventRow[] {
  const seen = new Set<string>();
  const out: WorkbenchEventRow[] = [];
  for (const e of rows) {
    const minute = e.created_at.slice(0, 16);
    const sub =
      e.event_type === "reminder_created" ? reminderSubtypeLabel(e.event_payload) ?? "" : "";
    const key = `${e.issue_id}|${e.event_type}|${minute}|${sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export async function getWorkbenchStats(): Promise<WorkbenchStats | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const { startIso, endIso } = getChinaDayBounds();

  const { data: issues, error: issuesErr } = await supabase
    .from("issues")
    .select("id, status, due_date")
    .eq("assignee_id", user.id)
    .neq("status", "resolved")
    .neq("status", "closed");

  if (issuesErr || !issues) {
    console.error(issuesErr);
    return {
      assignedOpen: 0,
      needUpdateToday: 0,
      overdue: 0,
      unreadReminders: 0,
    };
  }

  const assignedOpen = issues.length;

  const overdue = issues.filter(
    (r) => r.due_date && String(r.due_date).slice(0, 10) < today
  ).length;

  const activeIds = issues
    .filter((r) => ACTIVE_STATUSES.includes(r.status as (typeof ACTIVE_STATUSES)[number]))
    .map((r) => r.id as string);

  let needUpdateToday = 0;
  if (activeIds.length > 0) {
    const { data: updates } = await supabase
      .from("issue_updates")
      .select("issue_id")
      .in("issue_id", activeIds)
      .gte("created_at", startIso)
      .lte("created_at", endIso);

    const updated = new Set((updates ?? []).map((u) => u.issue_id as string));
    needUpdateToday = activeIds.filter((id) => !updated.has(id)).length;
  }

  const { count: unreadReminders } = await supabase
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("is_read", false);

  return {
    assignedOpen,
    needUpdateToday,
    overdue,
    unreadReminders: unreadReminders ?? 0,
  };
}

/** 今日待推进（优先展示）与今日已更新，排序与「我的任务」一致思路 */
export async function getWorkbenchTaskGroups(): Promise<{
  needUpdate: IssueWithRelations[];
  updatedToday: IssueWithRelations[];
} | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();

  const { data, error } = await supabase
    .from("issues")
    .select(issueSelect)
    .eq("assignee_id", user.id)
    .neq("status", "resolved")
    .neq("status", "closed")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error || !data) {
    console.error(error);
    return { needUpdate: [], updatedToday: [] };
  }

  const rows = data as IssueWithRelations[];
  const activeIds = rows
    .filter((r) => ACTIVE_STATUSES.includes(r.status))
    .map((r) => r.id);

  let updatedSet = new Set<string>();
  if (activeIds.length > 0) {
    const { data: updates } = await supabase
      .from("issue_updates")
      .select("issue_id")
      .in("issue_id", activeIds)
      .gte("created_at", startIso)
      .lte("created_at", endIso);
    updatedSet = new Set((updates ?? []).map((u) => u.issue_id as string));
  }

  const needUpdate: IssueWithRelations[] = [];
  const updatedToday: IssueWithRelations[] = [];

  for (const issue of rows) {
    const active = ACTIVE_STATUSES.includes(issue.status);
    if (active) {
      if (updatedSet.has(issue.id)) updatedToday.push(issue);
      else needUpdate.push(issue);
    } else {
      updatedToday.push(issue);
    }
  }

  const sortByPriorityThenDue = (a: IssueWithRelations, b: IssueWithRelations) => {
    const pd = PRI_ORDER[a.priority] - PRI_ORDER[b.priority];
    if (pd !== 0) return pd;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  };

  needUpdate.sort(sortByPriorityThenDue);
  updatedToday.sort(sortByPriorityThenDue);

  return {
    needUpdate: needUpdate.slice(0, 12),
    updatedToday: updatedToday.slice(0, 8),
  };
}

export async function getWorkbenchRecentEvents(limit = 18): Promise<WorkbenchEventRow[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();

  const { data: mine } = await supabase
    .from("issues")
    .select("id")
    .eq("assignee_id", user.id)
    .neq("status", "resolved")
    .neq("status", "closed");

  const { data: participantRows } = await supabase
    .from("issue_participants")
    .select("issue_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .eq("role", "handover_from");

  const idSet = new Set<string>();
  for (const r of mine ?? []) idSet.add(r.id as string);
  for (const r of participantRows ?? []) idSet.add(r.issue_id as string);

  const ids = [...idSet];
  if (ids.length === 0) return [];

  const fetchLimit = Math.min(80, limit * 4);
  const { data, error } = await supabase
    .from("issue_events")
    .select(
      `
      id,
      issue_id,
      event_type,
      created_at,
      event_payload,
      actor:users!issue_events_actor_id_fkey(id, name),
      issue:issues!issue_events_issue_id_fkey(id, title)
    `
    )
    .in("issue_id", ids)
    .order("created_at", { ascending: false })
    .limit(fetchLimit);

  if (error) {
    console.error("[getWorkbenchRecentEvents]", error.message);
    return [];
  }

  type RawRow = {
    id: string;
    issue_id: string;
    event_type: IssueEventType;
    created_at: string;
    event_payload: Record<string, unknown> | null;
    actor: { id: string; name: string } | { id: string; name: string }[] | null;
    issue: { id: string; title: string } | { id: string; title: string }[] | null;
  };

  const raw = (data ?? []) as RawRow[];
  const normalized: WorkbenchEventRow[] = raw.map((r) => ({
    id: r.id,
    issue_id: r.issue_id,
    event_type: r.event_type,
    created_at: r.created_at,
    event_payload: r.event_payload && typeof r.event_payload === "object" ? r.event_payload : {},
    actor: Array.isArray(r.actor) ? r.actor[0] ?? null : r.actor,
    issue: Array.isArray(r.issue) ? r.issue[0] ?? null : r.issue,
  }));

  const filtered = normalized.filter((e) => !NOISE_EVENT_TYPES.includes(e.event_type));
  const deduped = dedupeWorkbenchEvents(filtered);
  return deduped.slice(0, limit);
}
