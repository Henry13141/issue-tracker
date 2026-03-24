"use server";

import { createClient } from "@/lib/supabase/server";
import { getChinaDayBounds } from "@/lib/dates";
import { ACTIVE_STATUSES } from "@/lib/constants";
import type { IssueWithRelations, User } from "@/types";

export type DashboardStats = {
  noUpdateToday: number;
  resolvedToday: number;
  overdue: number;
  blocked: number;
};

export type StaleMemberRow = {
  user: Pick<User, "id" | "name" | "email">;
  staleIssueCount: number;
};

export type RecentUpdateRow = {
  id: string;
  content: string;
  created_at: string;
  user: Pick<User, "id" | "name"> | null;
  issue: Pick<IssueWithRelations, "id" | "title"> | null;
};

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();
  const todayDateStr = getChinaDayBounds().dateStr;

  const { data: activeIssues, error: aErr } = await supabase
    .from("issues")
    .select("id, assignee_id")
    .in("status", ACTIVE_STATUSES);

  if (aErr || !activeIssues?.length) {
    const blockedOnly = await supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .eq("status", "blocked");

    const resolvedToday = await supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .gte("resolved_at", startIso)
      .lte("resolved_at", endIso);

    const overdue = await supabase
      .from("issues")
      .select("id", { count: "exact", head: true })
      .lt("due_date", todayDateStr)
      .neq("status", "resolved")
      .neq("status", "closed");

    return {
      noUpdateToday: 0,
      resolvedToday: resolvedToday.count ?? 0,
      overdue: overdue.count ?? 0,
      blocked: blockedOnly.count ?? 0,
    };
  }

  const activeIds = activeIssues.map((i) => i.id as string);

  const { data: todayUpdates } = await supabase
    .from("issue_updates")
    .select("issue_id")
    .in("issue_id", activeIds)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const updatedSet = new Set((todayUpdates ?? []).map((u) => u.issue_id as string));
  const noUpdateToday = activeIds.filter((id) => !updatedSet.has(id)).length;

  const { count: resolvedToday } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .gte("resolved_at", startIso)
    .lte("resolved_at", endIso);

  const { count: overdue } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .lt("due_date", todayDateStr)
    .neq("status", "resolved")
    .neq("status", "closed");

  const { count: blocked } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("status", "blocked");

  return {
    noUpdateToday,
    resolvedToday: resolvedToday ?? 0,
    overdue: overdue ?? 0,
    blocked: blocked ?? 0,
  };
}

export async function getStaleMembers(): Promise<StaleMemberRow[]> {
  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();

  const { data: activeIssues, error } = await supabase
    .from("issues")
    .select("id, assignee_id, assignee:users!issues_assignee_id_fkey(id, name, email)")
    .in("status", ACTIVE_STATUSES)
    .not("assignee_id", "is", null);

  if (error || !activeIssues?.length) return [];

  const byAssignee = new Map<
    string,
    { user: Pick<User, "id" | "name" | "email">; issueIds: string[] }
  >();

  for (const row of activeIssues) {
    const aid = row.assignee_id as string | null;
    if (!aid) continue;
    const raw = row.assignee as Pick<User, "id" | "name" | "email"> | Pick<User, "id" | "name" | "email">[] | null;
    const assignee = Array.isArray(raw) ? raw[0] : raw;
    if (!assignee?.id) continue;
    if (!byAssignee.has(aid)) {
      byAssignee.set(aid, { user: assignee, issueIds: [] });
    }
    byAssignee.get(aid)!.issueIds.push(row.id as string);
  }

  const allIds = [...new Set(activeIssues.map((r) => r.id as string))];
  const { data: todayUpdates } = await supabase
    .from("issue_updates")
    .select("issue_id")
    .in("issue_id", allIds)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const updatedToday = new Set((todayUpdates ?? []).map((u) => u.issue_id as string));

  const result: StaleMemberRow[] = [];
  for (const { user, issueIds } of byAssignee.values()) {
    const stale = issueIds.filter((id) => !updatedToday.has(id));
    if (stale.length > 0) {
      result.push({ user, staleIssueCount: stale.length });
    }
  }

  return result.sort((a, b) => b.staleIssueCount - a.staleIssueCount);
}

export async function getRecentUpdates(limit = 20): Promise<RecentUpdateRow[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("issue_updates")
    .select(
      `
      id,
      content,
      created_at,
      user:users!issue_updates_user_id_fkey(id, name),
      issue:issues!issue_updates_issue_id_fkey(id, title)
    `
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error);
    return [];
  }

  const rows = (data ?? []) as {
    id: string;
    content: string;
    created_at: string;
    user: { id: string; name: string } | { id: string; name: string }[] | null;
    issue: { id: string; title: string } | { id: string; title: string }[] | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    created_at: r.created_at,
    user: Array.isArray(r.user) ? r.user[0] ?? null : r.user,
    issue: Array.isArray(r.issue) ? r.issue[0] ?? null : r.issue,
  }));
}
