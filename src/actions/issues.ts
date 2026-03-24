"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getChinaDayBounds } from "@/lib/dates";
import { ACTIVE_STATUSES } from "@/lib/constants";
import type { IssuePriority, IssueStatus, IssueUpdateWithUser, IssueWithRelations } from "@/types";

const issueSelect = `
  *,
  assignee:users!issues_assignee_id_fkey(id, email, name, role, avatar_url, created_at, updated_at),
  creator:users!issues_creator_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
`;

export type IssueFilters = {
  status?: IssueStatus[];
  priority?: IssuePriority[];
  assigneeId?: string | null;
  q?: string;
};

export async function getIssues(filters: IssueFilters = {}): Promise<IssueWithRelations[]> {
  const supabase = await createClient();
  let query = supabase.from("issues").select(issueSelect).order("updated_at", { ascending: false });

  if (filters.status?.length) {
    query = query.in("status", filters.status);
  }
  if (filters.priority?.length) {
    query = query.in("priority", filters.priority);
  }
  if (filters.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId);
  }
  if (filters.q?.trim()) {
    query = query.ilike("title", `%${filters.q.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as IssueWithRelations[];
}

export async function getIssueDetail(id: string): Promise<IssueWithRelations | null> {
  const supabase = await createClient();
  const { data: issue, error } = await supabase
    .from("issues")
    .select(issueSelect)
    .eq("id", id)
    .single();

  if (error || !issue) return null;

  const { data: updates, error: uErr } = await supabase
    .from("issue_updates")
    .select(
      `
      *,
      user:users!issue_updates_user_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
    `
    )
    .eq("issue_id", id)
    .order("created_at", { ascending: true });

  if (uErr) {
    console.error(uErr);
  }

  return {
    ...(issue as IssueWithRelations),
    issue_updates: (updates ?? []) as IssueUpdateWithUser[],
  };
}

export async function createIssue(input: {
  title: string;
  description?: string | null;
  priority: IssuePriority;
  assignee_id?: string | null;
  due_date?: string | null;
  status?: IssueStatus;
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .insert({
      title: input.title,
      description: input.description ?? null,
      priority: input.priority,
      assignee_id: input.assignee_id ?? null,
      due_date: input.due_date || null,
      status: input.status ?? "todo",
      creator_id: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  return data?.id as string;
}

export async function updateIssue(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: IssueStatus;
    priority: IssuePriority;
    assignee_id: string | null;
    due_date: string | null;
  }>
) {
  const supabase = await createClient();

  const extra: Record<string, unknown> = {};
  if (patch.status === "resolved" && !("resolved_at" in patch)) {
    extra.resolved_at = new Date().toISOString();
  }
  if (patch.status === "closed") {
    extra.closed_at = new Date().toISOString();
  }
  if (patch.status && patch.status !== "resolved") {
    extra.resolved_at = null;
  }
  if (patch.status && patch.status !== "closed") {
    extra.closed_at = null;
  }

  const { error } = await supabase
    .from("issues")
    .update({ ...patch, ...extra })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/issues");
  revalidatePath(`/issues/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
}

export async function deleteIssue(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("issues").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
}

export async function addIssueUpdate(issueId: string, content: string, statusTo?: IssueStatus) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();

  const { data: issue, error: gErr } = await supabase
    .from("issues")
    .select("status")
    .eq("id", issueId)
    .single();

  if (gErr || !issue) throw new Error("问题不存在");

  const prev = issue.status as IssueStatus;

  const { error: iErr } = await supabase.from("issue_updates").insert({
    issue_id: issueId,
    user_id: user.id,
    content,
    status_from: prev,
    status_to: statusTo ?? prev,
  });

  if (iErr) throw new Error(iErr.message);

  if (statusTo && statusTo !== prev) {
    const extra: Record<string, unknown> = { status: statusTo };
    if (statusTo === "resolved") extra.resolved_at = new Date().toISOString();
    if (statusTo === "closed") extra.closed_at = new Date().toISOString();
    if (statusTo !== "resolved") extra.resolved_at = null;
    if (statusTo !== "closed") extra.closed_at = null;
    const { error: uErr } = await supabase.from("issues").update(extra).eq("id", issueId);
    if (uErr) throw new Error(uErr.message);
  }

  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/issues");
  revalidatePath("/my-tasks");
  revalidatePath("/dashboard");
}

export async function bulkCreateIssues(
  rows: {
    title: string;
    description?: string | null;
    priority: IssuePriority;
    status?: IssueStatus;
    assignee_name?: string | null;
    due_date?: string | null;
  }[]
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();

  let memberMap: Map<string, string> | undefined;
  const needsLookup = rows.some((r) => r.assignee_name?.trim());
  if (needsLookup) {
    const { data: members } = await supabase.from("users").select("id, name");
    memberMap = new Map((members ?? []).map((m) => [m.name as string, m.id as string]));
  }

  const inserts = rows
    .filter((r) => r.title?.trim())
    .map((r) => ({
      title: r.title.trim(),
      description: r.description?.trim() || null,
      priority: (["low", "medium", "high", "urgent"].includes(r.priority) ? r.priority : "medium") as IssuePriority,
      status: (["todo", "in_progress", "blocked", "pending_review", "resolved", "closed"].includes(r.status ?? "") ? r.status : "todo") as IssueStatus,
      assignee_id: (r.assignee_name && memberMap?.get(r.assignee_name.trim())) || null,
      due_date: r.due_date || null,
      creator_id: user.id,
    }));

  if (inserts.length === 0) throw new Error("没有有效的问题数据");

  const { error } = await supabase.from("issues").insert(inserts);
  if (error) throw new Error(error.message);

  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  return inserts.length;
}

/** Issues assigned to current user, excluding resolved/closed */
export async function getMyOpenIssues(): Promise<IssueWithRelations[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .select(issueSelect)
    .eq("assignee_id", user.id)
    .neq("status", "resolved")
    .neq("status", "closed")
    .order("due_date", { ascending: true, nullsFirst: false });

  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as IssueWithRelations[];
}

export async function getIssueIdsNeedingUpdateToday(): Promise<Set<string>> {
  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();

  const { data: activeIssues, error } = await supabase
    .from("issues")
    .select("id")
    .in("status", ACTIVE_STATUSES);

  if (error || !activeIssues?.length) return new Set();

  const ids = activeIssues.map((r) => r.id as string);
  const { data: updates } = await supabase
    .from("issue_updates")
    .select("issue_id")
    .in("issue_id", ids)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  const updatedToday = new Set((updates ?? []).map((u) => u.issue_id as string));
  return new Set(ids.filter((id) => !updatedToday.has(id)));
}

export async function issueHasUpdateToday(issueId: string): Promise<boolean> {
  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();
  const { count, error } = await supabase
    .from("issue_updates")
    .select("id", { count: "exact", head: true })
    .eq("issue_id", issueId)
    .gte("created_at", startIso)
    .lte("created_at", endIso);

  if (error) return false;
  return (count ?? 0) > 0;
}
