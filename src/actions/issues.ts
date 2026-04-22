"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getChinaDayBounds } from "@/lib/dates";
import { ACTIVE_STATUSES, isIssueCategory, isIssueModule } from "@/lib/constants";
import { validateTransition, validateTransitionActor, isReopenTransition } from "@/lib/issue-state-machine";
import { writeIssueEvent, writeIssueEvents } from "@/lib/issue-events";
import type {
  IssuePriority,
  IssueAttachment,
  IssueAttachmentWithUrl,
  IssueEventWithActor,
  IssueHandoverWithUsers,
  IssueParticipant,
  IssueSummary,
  IssueStatus,
  IssueUpdateWithUser,
  IssueWithRelations,
  UpdateCommentWithUser,
} from "@/types";
import {
  dispatchEventNotifications,
  notifyAdminsOnProgressUpdate,
  notifyAssigneeOnBlocked,
  type NotifiableChange,
} from "@/lib/event-notification";

const issueSelect = `
  *,
  assignee:users!issues_assignee_id_fkey(id, email, name, role, avatar_url, created_at, updated_at),
  reviewer:users!issues_reviewer_id_fkey(id, email, name, role, avatar_url, created_at, updated_at),
  creator:users!issues_creator_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
`;

export type IssueSortBy = "updated_at" | "created_at" | "due_date" | "last_activity_at" | "priority";
export type IssueSortDir = "asc" | "desc";
export type IssueRisk = "overdue" | "stale" | "blocked" | "urgent";
export type IssueTab = "all" | "mine" | "risk";

export type IssueFilters = {
  status?:     IssueStatus[];
  priority?:   IssuePriority[];
  assigneeId?: string | null;
  reviewerId?: string | null;
  category?:   string | null;
  module?:     string | null;
  source?:     string | null;
  risk?:       IssueRisk | null;
  sortBy?:     IssueSortBy;
  sortDir?:    IssueSortDir;
  q?:          string;
  page?:       number;
  pageSize?:   number;
  tab?:        IssueTab;
};

export type IssuesResult = {
  items: IssueWithRelations[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getIssues(filters: IssueFilters = {}): Promise<IssuesResult> {
  const supabase = await createClient();
  const sortBy = filters.sortBy ?? "last_activity_at";
  const sortDir = filters.sortDir ?? "desc";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize ?? 20)));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const tab = filters.tab ?? "all";

  // priority 排序在 app-side 完成（Supabase 不支持自定义枚举顺序）。
  // 为了支持分页，priority 仅对“当页数据”进行二次排序。
  const dbSortBy  = sortBy === "priority" ? "updated_at" : sortBy;
  const ascending = sortDir === "asc";

  let query = supabase
    .from("issues")
    .select(issueSelect, { count: "exact" })
    .is("parent_issue_id", null)
    // is_list_terminal：迁移 add_issues_list_terminal_sort.sql；false 在前，已解决/已关闭在后
    .order("is_list_terminal", { ascending: true })
    .order(dbSortBy, { ascending, nullsFirst: false });

  if (tab === "mine" && filters.assigneeId) {
    query = query.eq("assignee_id", filters.assigneeId).not("status", "in", '("resolved","closed")');
  }
  if (tab === "risk") {
    const today = new Date().toISOString().slice(0, 10);
    const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString();
    query = query.or(
      [
        "status.eq.blocked",
        "and(priority.eq.urgent,status.not.in.(resolved,closed))",
        `and(due_date.lt.${today},status.not.in.(resolved,closed))`,
        `and(last_activity_at.lt."${staleThreshold}",status.in.(in_progress,blocked,pending_review,pending_rework))`,
      ].join(",")
    );
  }

  if (!(tab === "mine" && filters.assigneeId) && filters.status?.length) query = query.in("status", filters.status);
  if (filters.priority?.length) query = query.in("priority", filters.priority);
  if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
  if (filters.reviewerId) query = query.eq("reviewer_id", filters.reviewerId);
  if (filters.category?.trim() && isIssueCategory(filters.category.trim())) {
    query = query.eq("category", filters.category.trim());
  }
  if (filters.module?.trim() && isIssueModule(filters.module.trim())) {
    query = query.eq("module", filters.module.trim());
  }
  if (filters.source?.trim())   query = query.eq("source", filters.source.trim());
  if (filters.q?.trim())        query = query.ilike("title", `%${filters.q.trim()}%`);

  // 风险标签筛选（服务端）
  if (filters.risk) {
    const today = new Date().toISOString().slice(0, 10);
    const staleThreshold = new Date(Date.now() - 3 * 86_400_000).toISOString();
    switch (filters.risk) {
      case "overdue":
        query = query.lt("due_date", today).not("status", "in", '("resolved","closed")');
        break;
      case "blocked":
        query = query.eq("status", "blocked");
        break;
      case "urgent":
        query = query.eq("priority", "urgent").not("status", "in", '("resolved","closed")');
        break;
      case "stale":
        query = query.lt("last_activity_at", staleThreshold).in("status", ["in_progress", "blocked", "pending_review", "pending_rework"]);
        break;
    }
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    console.error(error);
    return { items: [], total: 0, page, pageSize };
  }

  let rows = (data ?? []) as IssueWithRelations[];

  // 列表仅需要附件数量，不拉取存储路径和签名 URL。
  if (rows.length > 0) {
    const issueIds = rows.map((r) => r.id);
    const { data: attachments } = await supabase
      .from("issue_attachments")
      .select("issue_id")
      .in("issue_id", issueIds);

    if (attachments?.length) {
      const countMap = new Map<string, number>();
      for (const row of attachments as Pick<IssueAttachment, "issue_id">[]) {
        countMap.set(row.issue_id, (countMap.get(row.issue_id) ?? 0) + 1);
      }
      rows = rows.map((r) => ({
        ...r,
        attachmentCount: countMap.get(r.id) ?? 0,
      }));
    } else {
      rows = rows.map((r) => ({ ...r, attachmentCount: 0 }));
    }
  }

  // 优先级排序（app-side）：同页内仍保持「非终态在前、已解决/已关闭在后」
  if (sortBy === "priority") {
    const ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const terminal = (s: IssueStatus) => s === "resolved" || s === "closed";
    rows = rows.sort((a, b) => {
      const ta = terminal(a.status) ? 1 : 0;
      const tb = terminal(b.status) ? 1 : 0;
      if (ta !== tb) return ta - tb;
      const diff = (ORDER[a.priority] ?? 9) - (ORDER[b.priority] ?? 9);
      return ascending ? diff : -diff;
    });
  }

  return {
    items: rows,
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** 获取 issue 基础信息（不含进度更新/评论），用于详情页首屏快速加载 */
export async function getIssueBasic(id: string): Promise<IssueWithRelations | null> {
  const supabase = await createClient();
  const issueRes = await supabase
    .from("issues")
    .select(issueSelect)
    .eq("id", id)
    .single();

  const { data: issue, error } = issueRes;
  if (error || !issue) return null;

  const issueRow = issue as IssueWithRelations;

  // Fetch parent issue summary (if this is a subtask)
  let parent: IssueWithRelations["parent"] = null;
  if (issueRow.parent_issue_id) {
    const { data: parentRow } = await supabase
      .from("issues")
      .select("id, title, status, priority")
      .eq("id", issueRow.parent_issue_id)
      .single();
    if (parentRow) {
      parent = parentRow as IssueWithRelations["parent"];
    }
  }

  // Fetch children (subtasks)
  const { data: childRows } = await supabase
    .from("issues")
    .select("id, title, description, status, priority, assignee_id, due_date, assignee:users!issues_assignee_id_fkey(id, name, avatar_url)")
    .eq("parent_issue_id", id)
    .order("created_at", { ascending: true });

  const children: IssueSummary[] = (childRows ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: row.description as string | null,
    status: row.status as IssueSummary["status"],
    priority: row.priority as IssueSummary["priority"],
    assignee_id: row.assignee_id as string | null,
    due_date: row.due_date as string | null,
    assignee: Array.isArray(row.assignee)
      ? (row.assignee[0] as Pick<import("@/types").User, "id" | "name" | "avatar_url"> | undefined) ?? null
      : (row.assignee as Pick<import("@/types").User, "id" | "name" | "avatar_url"> | null),
  }));

  const childMetaMap = new Map<string, { index: number; title: string }>();
  children.forEach((child, idx) => {
    childMetaMap.set(child.id, { index: idx + 1, title: child.title });
  });

  const allIssueIds = [id, ...children.map((c) => c.id)];
  const { data: allAttachmentRows } = await supabase
    .from("issue_attachments")
    .select("*")
    .in("issue_id", allIssueIds)
    .is("issue_update_id", null)
    .order("created_at", { ascending: true });

  const attachmentRows = ((allAttachmentRows ?? []) as IssueAttachment[]);
  let attachmentsWithUrls: IssueAttachmentWithUrl[] = attachmentRows.map((row) => {
    const pathIssueId = row.storage_path.split("/")[0] ?? "";
    const childMeta = childMetaMap.get(row.issue_id) ?? childMetaMap.get(pathIssueId);
    return {
      ...row,
      source_subtask_index: childMeta?.index ?? null,
      source_subtask_title: childMeta?.title ?? null,
    };
  });

  // 回退规则：若仅有 1 个未标注附件，且仅有 1 个子任务当前没有附件，
  // 则将该附件归到该子任务（用于兼容早期以父任务名义上传、缺少归属信息的历史数据）。
  const unlabeledIndexes: number[] = [];
  const childAttachmentCount = new Map<number, number>();
  for (const a of attachmentsWithUrls) {
    if (a.source_subtask_index) {
      childAttachmentCount.set(
        a.source_subtask_index,
        (childAttachmentCount.get(a.source_subtask_index) ?? 0) + 1
      );
    } else {
      unlabeledIndexes.push(attachmentsWithUrls.indexOf(a));
    }
  }

  if (children.length > 0 && unlabeledIndexes.length === 1) {
    const missingChildIndexes = children
      .map((_, idx) => idx + 1)
      .filter((idx) => (childAttachmentCount.get(idx) ?? 0) === 0);

    if (missingChildIndexes.length === 1) {
      const targetIndex = missingChildIndexes[0];
      const targetTitle = children[targetIndex - 1]?.title ?? null;
      const at = unlabeledIndexes[0];
      attachmentsWithUrls[at] = {
        ...attachmentsWithUrls[at],
        source_subtask_index: targetIndex,
        source_subtask_title: targetTitle,
      };
    }
  }

  if (attachmentsWithUrls.length > 0) {
    const { data: signedRows } = await supabase.storage
      .from("issue-files")
      .createSignedUrls(attachmentsWithUrls.map((a) => a.storage_path), 3600);
    if (signedRows) {
      const signedUrlMap = new Map(
        signedRows.map((row) => [row.path ?? "", row.signedUrl ?? undefined])
      );
      attachmentsWithUrls = attachmentsWithUrls.map((a) => ({
        ...a,
        url: signedUrlMap.get(a.storage_path),
      }));
    }
  }

  // 查询交接链路与参与者
  const [handoversRes, participantsRes] = await Promise.all([
    supabase
      .from("issue_handovers")
      .select(`*, from_user:users!issue_handovers_from_user_id_fkey(id, name), to_user:users!issue_handovers_to_user_id_fkey(id, name)`)
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("issue_participants")
      .select(`*, user:users!issue_participants_user_id_fkey(id, name)`)
      .eq("issue_id", id),
  ]);

  const handovers = (handoversRes.data ?? []).map((h) => ({
    ...h,
    from_user: Array.isArray(h.from_user) ? h.from_user[0] ?? null : h.from_user ?? null,
    to_user: Array.isArray(h.to_user) ? h.to_user[0] ?? null : h.to_user ?? null,
  })) as IssueHandoverWithUsers[];

  const participants = (participantsRes.data ?? []).map((p) => ({
    ...p,
    user: Array.isArray(p.user) ? p.user[0] ?? null : p.user ?? null,
  })) as IssueParticipant[];

  return {
    ...issueRow,
    issue_updates: [],
    attachments: attachmentsWithUrls,
    parent,
    children,
    handovers,
    participants,
  };
}

/** 获取 issue 进度更新列表（含评论、附件），用于详情页流式加载 */
export async function getIssueUpdatesAndComments(issueId: string): Promise<IssueUpdateWithUser[]> {
  const supabase = await createClient();

  const { data: updates, error: uErr } = await supabase
    .from("issue_updates")
    .select(
      `
      *,
      user:users!issue_updates_user_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
    `
    )
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true });

  if (uErr) console.error(uErr);

  const updateIds = (updates ?? []).map((u) => u.id as string);
  if (updateIds.length === 0) return [];

  const [commentsRes, updateAttachmentsRes] = await Promise.all([
    supabase
      .from("issue_update_comments")
      .select(`*, user:users!issue_update_comments_user_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)`)
      .in("update_id", updateIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("issue_attachments")
      .select("*")
      .eq("issue_id", issueId)
      .not("issue_update_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  const commentsMap: Record<string, UpdateCommentWithUser[]> = {};
  for (const c of ((commentsRes.data ?? []) as UpdateCommentWithUser[])) {
    (commentsMap[c.update_id] ??= []).push(c);
  }

  const updateAttachmentRows = ((updateAttachmentsRes.data ?? []) as IssueAttachment[]);
  let updateAttachmentsWithUrls: IssueAttachmentWithUrl[] = updateAttachmentRows;

  if (updateAttachmentRows.length > 0) {
    const { data: signedRows } = await supabase.storage
      .from("issue-files")
      .createSignedUrls(updateAttachmentRows.map((a) => a.storage_path), 3600);
    if (signedRows) {
      const signedUrlMap = new Map(
        signedRows.map((row) => [row.path ?? "", row.signedUrl ?? undefined])
      );
      updateAttachmentsWithUrls = updateAttachmentRows.map((a) => ({
        ...a,
        url: signedUrlMap.get(a.storage_path),
      }));
    }
  }

  const updateAttachmentsMap: Record<string, IssueAttachmentWithUrl[]> = {};
  for (const a of updateAttachmentsWithUrls) {
    (updateAttachmentsMap[a.issue_update_id!] ??= []).push(a);
  }

  return (updates ?? []).map((u) => ({
    ...(u as IssueUpdateWithUser),
    comments: commentsMap[(u as IssueUpdateWithUser).id] ?? [],
    attachments: updateAttachmentsMap[(u as IssueUpdateWithUser).id] ?? [],
  }));
}

export async function getIssueDetail(id: string): Promise<IssueWithRelations | null> {
  const supabase = await createClient();
  const [issueRes, updatesRes, attachmentsRes] = await Promise.all([
    supabase
      .from("issues")
      .select(issueSelect)
      .eq("id", id)
      .single(),
    supabase
      .from("issue_updates")
      .select(
        `
        *,
        user:users!issue_updates_user_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)
      `
      )
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("issue_attachments")
      .select("*")
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const { data: issue, error } = issueRes;

  if (error || !issue) return null;

  const { data: updates, error: uErr } = updatesRes;

  if (uErr) {
    console.error(uErr);
  }

  const updateIds = (updates ?? []).map((u) => u.id as string);
  const commentsMap: Record<string, UpdateCommentWithUser[]> = {};

  if (updateIds.length > 0) {
    const { data: comments } = await supabase
      .from("issue_update_comments")
      .select(`*, user:users!issue_update_comments_user_id_fkey(id, email, name, role, avatar_url, created_at, updated_at)`)
      .in("update_id", updateIds)
      .order("created_at", { ascending: true });

    for (const c of (comments ?? []) as UpdateCommentWithUser[]) {
      (commentsMap[c.update_id] ??= []).push(c);
    }
  }

  const { data: rawAttachments, error: attachmentErr } = attachmentsRes;
  if (attachmentErr) {
    console.error(attachmentErr);
  }

  const attachmentRows = (rawAttachments ?? []) as IssueAttachment[];
  let attachmentsWithUrls: IssueAttachmentWithUrl[] = attachmentRows;

  if (attachmentRows.length > 0) {
    const { data: signedRows, error: signErr } = await supabase.storage
      .from("issue-files")
      .createSignedUrls(attachmentRows.map((a) => a.storage_path), 3600);

    if (signErr) {
      console.error(signErr);
    } else if (signedRows) {
      const signedUrlMap = new Map(
        signedRows.map((row) => [row.path ?? "", row.signedUrl ?? undefined])
      );
      attachmentsWithUrls = attachmentRows.map((a) => ({
        ...a,
        url: signedUrlMap.get(a.storage_path),
      }));
    }
  }

  const issueAttachments = attachmentsWithUrls.filter((a) => !a.issue_update_id);
  const updateAttachmentsMap: Record<string, IssueAttachmentWithUrl[]> = {};
  for (const a of attachmentsWithUrls.filter((a) => a.issue_update_id)) {
    (updateAttachmentsMap[a.issue_update_id!] ??= []).push(a);
  }

  const updatesWithComments = (updates ?? []).map((u) => ({
    ...(u as IssueUpdateWithUser),
    comments: commentsMap[(u as IssueUpdateWithUser).id] ?? [],
    attachments: updateAttachmentsMap[(u as IssueUpdateWithUser).id] ?? [],
  }));

  return {
    ...(issue as IssueWithRelations),
    issue_updates: updatesWithComments,
    attachments: issueAttachments,
  };
}

/** 获取 issue 事件时间线（倒序） */
export async function getIssueEvents(issueId: string): Promise<IssueEventWithActor[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issue_events")
    .select(`*, actor:users!issue_events_actor_id_fkey(id, name, avatar_url)`)
    .eq("issue_id", issueId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getIssueEvents] error:", error.message);
    return [];
  }
  return (data ?? []) as IssueEventWithActor[];
}

export async function createIssue(input: {
  title: string;
  description?: string | null;
  priority: IssuePriority;
  assignee_id?: string | null;
  reviewer_id?: string | null;
  due_date?: string | null;
  status?: IssueStatus;
  category?: string | null;
  module?: string | null;
  source?: string;
  parent_issue_id?: string | null;
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  let inheritedAssigneeId = input.assignee_id ?? null;

  if (input.parent_issue_id && input.assignee_id === undefined) {
    const { data: parentIssue } = await supabase
      .from("issues")
      .select("assignee_id")
      .eq("id", input.parent_issue_id)
      .single();
    inheritedAssigneeId = (parentIssue?.assignee_id as string | null) ?? null;
  }

  // 员工创建：负责人固定为自己；子任务与父任务负责人一致；审核人由系统默认（郝毅等）
  if (user.role !== "admin") {
    if (!input.parent_issue_id) {
      inheritedAssigneeId = user.id;
    } else {
      const { data: parentIssue } = await supabase
        .from("issues")
        .select("assignee_id")
        .eq("id", input.parent_issue_id)
        .single();
      inheritedAssigneeId = (parentIssue?.assignee_id as string | null) ?? user.id;
    }
  }

  // NOTE: category, module, source, reviewer_id require p0_governance.sql migration.
  // Build insert object conditionally to avoid schema cache errors on un-migrated DBs.
  const normalizedCategory = input.category?.trim() ? input.category.trim() : null;
  const normalizedModule = input.module?.trim() ? input.module.trim() : null;
  if (normalizedCategory && !isIssueCategory(normalizedCategory)) {
    throw new Error("分类不合法，请选择预设分类");
  }
  if (normalizedModule && !isIssueModule(normalizedModule)) {
    throw new Error("模块不合法，请选择预设模块");
  }

  const insertData: Record<string, unknown> = {
    title:           input.title,
    description:     input.description ?? null,
    priority:        input.priority,
    assignee_id:     inheritedAssigneeId,
    due_date:        input.due_date || null,
    status:          input.status ?? "todo",
    creator_id:      user.id,
    parent_issue_id: input.parent_issue_id ?? null,
  };

  // Probe for governance columns by checking schema cache via a dry-run select
  const { error: probeErr } = await supabase
    .from("issues")
    .select("category, module, source, reviewer_id")
    .limit(0);
  if (!probeErr) {
    const defaultReviewerId = await getDefaultReviewerId(supabase);
    const effectiveReviewerId =
      user.role === "admin" ? (input.reviewer_id ?? defaultReviewerId) : defaultReviewerId;
    insertData.category    = normalizedCategory;
    insertData.module      = normalizedModule;
    insertData.source      = user.role === "admin" ? (input.source ?? "manual") : "manual";
    insertData.reviewer_id = effectiveReviewerId;
  }

  const { data, error } = await supabase
    .from("issues")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    if (error.code === "23503") {
      throw new Error("账户未与成员表同步，无法创建问题。请联系管理员检查你的登录账号是否在「成员」列表中。");
    }
    throw new Error(error.message);
  }
  const newId = data?.id as string;

  await writeIssueEvent(supabase, {
    issueId:   newId,
    actorId:   user.id,
    eventType: "issue_created",
    payload:   {
      title:           input.title,
      priority:        input.priority,
      assignee_id:     inheritedAssigneeId,
      status:          input.status ?? "todo",
      parent_issue_id: input.parent_issue_id ?? null,
    },
  });

  dispatchEventNotifications({
    issueId:    newId,
    issueTitle: input.title,
    actorId:    user.id,
    actorName:  user.name,
    assigneeId: inheritedAssigneeId,
    reviewerId: (insertData.reviewer_id as string | null | undefined) ?? null,
    creatorId:  user.id,
    changes:    [{ type: "issue_created" }],
  });

  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
  if (input.parent_issue_id) {
    revalidatePath(`/issues/${input.parent_issue_id}`);
  }
  return newId;
}

export async function updateIssue(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: IssueStatus;
    priority: IssuePriority;
    assignee_id: string | null;
    reviewer_id: string | null;
    due_date: string | null;
    category: string | null;
    module: string | null;
    source: string;
    blocked_reason: string | null;
    closed_reason: string | null;
  }>
): Promise<{ error: string } | void> {
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };
  const supabase = await createClient();
  await normalizeTopLevelInProgressIssues(supabase);

  const { data: beforeRow } = await supabase
    .from("issues")
    .select("title, creator_id, assignee_id, reviewer_id, status, priority, due_date, reopen_count, blocked_reason, closed_reason, parent_issue_id")
    .eq("id", id)
    .single();

  if (!beforeRow) return { error: "问题不存在" };

  const isTopLevelIssue = beforeRow.parent_issue_id === null;

  // 非管理员不得修改优先级 / 负责人 / 审核人（与详情页权限一致，防绕过前端）
  if (user.role !== "admin") {
    if (patch.priority !== undefined && patch.priority !== (beforeRow.priority as IssuePriority)) {
      return { error: "仅管理员可修改优先级" };
    }
    if (
      patch.assignee_id !== undefined &&
      patch.assignee_id !== (beforeRow.assignee_id as string | null)
    ) {
      return { error: "仅管理员可修改负责人" };
    }
    if (
      patch.reviewer_id !== undefined &&
      patch.reviewer_id !== (beforeRow.reviewer_id as string | null)
    ) {
      return { error: "仅管理员可修改审核人" };
    }
  }

  const prevStatus = beforeRow.status as IssueStatus;
  const newStatus  = patch.status;

  if (
    isTopLevelIssue &&
    (
      newStatus === "in_progress" ||
      (patch.assignee_id !== undefined && prevStatus === "in_progress")
    )
  ) {
    const effectiveAssigneeId = patch.assignee_id !== undefined
      ? patch.assignee_id
      : (beforeRow.assignee_id as string | null);

    if (effectiveAssigneeId) {
      const conflictIssue = await findOtherTopLevelInProgressIssue(
        supabase,
        effectiveAssigneeId,
        id
      );
      if (conflictIssue) {
        return {
          error: `该负责人当前已有一个“处理中”问题：${conflictIssue.title}。请先把它改成其他状态，再将这条设为“处理中”。`,
        };
      }
    }
  }

  // ---------- 状态机校验（服务端权威） ----------
  if (newStatus && newStatus !== prevStatus) {
    const hasNonSystemUpdate = await checkHasNonSystemUpdate(supabase, id);
    const hasIncompleteSubtasks = newStatus === "pending_review"
      ? (await getIncompleteSubtaskCount(supabase, id)) > 0
      : false;

    const transErr = validateTransition(prevStatus, newStatus, {
      blockedReason:       patch.blocked_reason ?? (beforeRow.blocked_reason as string | null),
      closedReason:        patch.closed_reason  ?? (beforeRow.closed_reason  as string | null),
      reviewerId:          patch.reviewer_id !== undefined
        ? patch.reviewer_id
        : (beforeRow.reviewer_id as string | null),
      hasNonSystemUpdate,
      hasIncompleteSubtasks,
    });
    if (transErr) return { error: transErr.message };

    const actorErr = validateStatusActorPermission({
      user,
      from:       prevStatus,
      to:         newStatus,
      assigneeId: beforeRow.assignee_id as string | null,
      reviewerId: patch.reviewer_id !== undefined
        ? patch.reviewer_id
        : (beforeRow.reviewer_id as string | null),
    });
    if (actorErr) return { error: actorErr.message };
  }

  if (patch.category !== undefined) {
    const normalizedCategory = patch.category?.trim() ? patch.category.trim() : null;
    if (normalizedCategory && !isIssueCategory(normalizedCategory)) {
      return { error: "分类不合法，请选择预设分类" };
    }
    patch.category = normalizedCategory;
  }
  if (patch.module !== undefined) {
    const normalizedModule = patch.module?.trim() ? patch.module.trim() : null;
    if (normalizedModule && !isIssueModule(normalizedModule)) {
      return { error: "模块不合法，请选择预设模块" };
    }
    patch.module = normalizedModule;
  }

  const extra: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
  };

  // resolved_at / closed_at 联动
  if (newStatus) {
    extra.resolved_at = newStatus === "resolved" ? new Date().toISOString() : null;
    extra.closed_at   = newStatus === "closed"   ? new Date().toISOString() : null;
  }

  // reopen 计数：仅在 closed→in_progress 时递增，且只在 extra 里赋值一次
  // validateTransition 不修改任何数据，不会造成重复累加
  if (newStatus && isReopenTransition(prevStatus, newStatus)) {
    extra.reopen_count = ((beforeRow.reopen_count as number) ?? 0) + 1;
  }

  // blocked_reason 清理规则：
  //   - 正在进入 blocked（newStatus === "blocked"）→ 保留 patch 里提供的值
  //   - 从 blocked 离开（prevStatus === "blocked" && newStatus !== "blocked"）→ 无条件清空
  //     不依赖 patch.blocked_reason 是否传入，避免离开 blocked 后残留旧原因造成 UI 歧义
  if (newStatus && prevStatus === "blocked" && newStatus !== "blocked") {
    extra.blocked_reason = null;
  }
  // closed_reason 在 reopen 时刻意保留历史值（UI 上仅在 status=closed 时展示，不会造成歧义）

  const { error } = await supabase
    .from("issues")
    .update({ ...patch, ...extra })
    .eq("id", id);

  if (error) return { error: error.message };

  if (patch.assignee_id !== undefined) {
    await syncChildAssignees(supabase, id, patch.assignee_id);
  }

  if (newStatus && (newStatus === "resolved" || newStatus === "closed")) {
    await markHandoversCompleted(supabase, id);
  }

  // ---------- 写事件日志 ----------
  if (user && beforeRow) {
    const events: Parameters<typeof writeIssueEvents>[1] = [];
    const actorId = user.id;

    if (newStatus && newStatus !== prevStatus) {
      const isReopen = isReopenTransition(prevStatus, newStatus);
      events.push({
        issueId:   id,
        actorId,
        eventType: isReopen ? "issue_reopened" : newStatus === "closed" ? "issue_closed" : "status_changed",
        payload:   { from: prevStatus, to: newStatus },
      });
    }
    if (patch.assignee_id !== undefined && patch.assignee_id !== beforeRow.assignee_id) {
      events.push({
        issueId:   id,
        actorId,
        eventType: "assignee_changed",
        payload:   { from: beforeRow.assignee_id, to: patch.assignee_id },
      });
    }
    if (patch.reviewer_id !== undefined && patch.reviewer_id !== beforeRow.reviewer_id) {
      events.push({
        issueId:   id,
        actorId,
        eventType: "reviewer_changed",
        payload:   { from: beforeRow.reviewer_id, to: patch.reviewer_id },
      });
    }
    if (patch.priority !== undefined && patch.priority !== (beforeRow.priority as IssuePriority)) {
      events.push({
        issueId:   id,
        actorId,
        eventType: "priority_changed",
        payload:   { from: beforeRow.priority, to: patch.priority },
      });
    }
    if (patch.due_date !== undefined && patch.due_date !== (beforeRow.due_date as string | null)) {
      events.push({
        issueId:   id,
        actorId,
        eventType: "due_date_changed",
        payload:   { from: beforeRow.due_date, to: patch.due_date },
      });
    }
    // 仅字段更新（非状态/指派/优先级变化）
    const hasFieldUpdate = patch.title || patch.description !== undefined || patch.category !== undefined || patch.module !== undefined;
    if (hasFieldUpdate && events.length === 0) {
      events.push({ issueId: id, actorId, eventType: "issue_updated", payload: {} });
    }

    await writeIssueEvents(supabase, events);
  }

  // ---------- P3 事件驱动通知 ----------
  if (beforeRow && user) {
    const notifChanges: NotifiableChange[] = [];

    // 状态变更
    if (newStatus && newStatus !== prevStatus) {
      notifChanges.push({ type: "status_changed", from: prevStatus, to: newStatus });
    }

    // 负责人变更
    if (patch.assignee_id !== undefined && patch.assignee_id !== (beforeRow.assignee_id as string | null)) {
      notifChanges.push({
        type:   "assignee_changed",
        fromId: beforeRow.assignee_id as string | null,
        toId:   patch.assignee_id,
      });
    }

    // 评审人变更（P3 新增）
    if (patch.reviewer_id !== undefined && patch.reviewer_id !== (beforeRow.reviewer_id as string | null)) {
      notifChanges.push({
        type:   "reviewer_changed",
        fromId: beforeRow.reviewer_id as string | null,
        toId:   patch.reviewer_id,
      });
    }

    // 优先级提升为紧急（P3 新增）
    if (
      patch.priority !== undefined &&
      patch.priority !== (beforeRow.priority as IssuePriority) &&
      patch.priority === "urgent"
    ) {
      notifChanges.push({ type: "priority_urgent", from: beforeRow.priority as IssuePriority });
    }

    // 截止日期提前（P3 新增，仅在截止日变早时通知）
    const newDue  = patch.due_date;
    const prevDue = beforeRow.due_date as string | null;
    if (newDue !== undefined && newDue !== prevDue && newDue && prevDue && newDue < prevDue) {
      notifChanges.push({ type: "due_date_advanced", from: prevDue, to: newDue });
    }

    // 子任务的纯负责人/评审变更不单独推送通知（父任务通知已涵盖）
    const isSubtask = !!(beforeRow.parent_issue_id as string | null);
    const finalChanges = isSubtask
      ? notifChanges.filter((c) => c.type !== "assignee_changed" && c.type !== "reviewer_changed")
      : notifChanges;

    if (finalChanges.length > 0) {
      const afterAssigneeId = patch.assignee_id !== undefined
        ? patch.assignee_id
        : (beforeRow.assignee_id as string | null);
      const afterReviewerId = patch.reviewer_id !== undefined
        ? patch.reviewer_id
        : (beforeRow.reviewer_id as string | null);

      dispatchEventNotifications({
        issueId:    id,
        issueTitle: (patch.title ?? beforeRow.title) as string,
        actorId:    user.id,
        actorName:  user.name,
        assigneeId: afterAssigneeId,
        reviewerId: afterReviewerId,
        creatorId:  beforeRow.creator_id as string,
        changes:    finalChanges,
      });
    }
  }

  revalidatePath("/issues");
  revalidatePath(`/issues/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
}

export async function deleteIssue(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("issues").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
}

export async function addIssueUpdate(
  issueId: string,
  content: string,
  statusTo?: IssueStatus,
  pendingStoragePaths?: string[],
  opts?: {
    blockedReason?: string | null;
    closedReason?: string | null;
  }
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();

  const { data: issue, error: gErr } = await supabase
    .from("issues")
    .select("status, title, creator_id, assignee_id, reviewer_id, reopen_count, blocked_reason, closed_reason")
    .eq("id", issueId)
    .single();

  if (gErr || !issue) throw new Error("问题不存在");

  const prev = issue.status as IssueStatus;

  // ---------- 状态机校验 ----------
  if (statusTo && statusTo !== prev) {
    const hasNonSystemUpdate = await checkHasNonSystemUpdate(supabase, issueId);
    const hasIncompleteSubtasks = statusTo === "pending_review"
      ? (await getIncompleteSubtaskCount(supabase, issueId)) > 0
      : false;

    const transErr = validateTransition(prev, statusTo, {
      blockedReason:       opts?.blockedReason ?? (issue.blocked_reason as string | null),
      closedReason:        opts?.closedReason  ?? (issue.closed_reason  as string | null),
      reviewerId:          issue.reviewer_id as string | null,
      // 提交进度时 content 本身就是更新，视为满足 hasNonSystemUpdate
      hasNonSystemUpdate:  hasNonSystemUpdate || content.trim().length > 0,
      hasIncompleteSubtasks,
    });
    if (transErr) throw new Error(transErr.message);

    const actorErr = validateStatusActorPermission({
      user,
      from:       prev,
      to:         statusTo,
      assigneeId: issue.assignee_id as string | null,
      reviewerId: issue.reviewer_id as string | null,
    });
    if (actorErr) throw new Error(actorErr.message);
  }

  // ---------- 更新 issue 状态 ----------
  if (statusTo && statusTo !== prev) {
    const extra: Record<string, unknown> = {
      status:           statusTo,
      last_activity_at: new Date().toISOString(),
    };
    extra.resolved_at = statusTo === "resolved" ? new Date().toISOString() : null;
    extra.closed_at   = statusTo === "closed"   ? new Date().toISOString() : null;

    // reopen 计数：validateTransition 不改数据，此处是唯一累加点
    if (isReopenTransition(prev, statusTo)) {
      extra.reopen_count = ((issue.reopen_count as number) ?? 0) + 1;
    }

    // blocked_reason 清理规则（与 updateIssue 保持一致）：
    //   - 正在进入 blocked：应用 opts.blockedReason（已在状态机校验阶段验证非空）
    //   - 从 blocked 离开：无条件清空，不保留旧原因
    //   - 其他情况：不触碰
    if (statusTo === "blocked") {
      if (opts?.blockedReason !== undefined) extra.blocked_reason = opts.blockedReason;
    } else if (prev === "blocked") {
      extra.blocked_reason = null;
    }

    // closed_reason：进入 closed 时写入；reopen 时保留历史值（UI 上 closed_reason 字段仅在 status=closed 时渲染，不会误导用户）
    if (statusTo === "closed" && opts?.closedReason !== undefined) {
      extra.closed_reason = opts.closedReason;
    }

    const { error: uErr } = await supabase.from("issues").update(extra).eq("id", issueId);
    if (uErr) {
      if (uErr.code === "42501" || /row-level security/i.test(uErr.message ?? "")) {
        throw new Error(
          "无权限更新该问题状态。请在 Supabase 控制台执行仓库内 supabase/migrations/issues_update_all_authenticated.sql，允许已登录成员更新问题。"
        );
      }
      throw new Error(uErr.message);
    }

    if (statusTo === "resolved" || statusTo === "closed") {
      await markHandoversCompleted(supabase, issueId);
    }
  }

  // ---------- 确定 update_type ----------
  const updateType = statusTo && statusTo !== prev ? "status_change" : "comment";

  const { data: newUpdate, error: iErr } = await supabase
    .from("issue_updates")
    .insert({
      issue_id:            issueId,
      user_id:             user.id,
      content,
      status_from:         prev,
      status_to:           statusTo ?? prev,
      update_type:         updateType,
      is_system_generated: false,
    })
    .select("id")
    .single();

  if (iErr || !newUpdate) throw new Error(iErr?.message ?? "写入进度失败");

  // ---------- 关联附件 ----------
  if (pendingStoragePaths && pendingStoragePaths.length > 0) {
    const { data: attachRows } = await supabase
      .from("issue_attachments")
      .select("id")
      .eq("issue_id", issueId)
      .in("storage_path", pendingStoragePaths)
      .is("issue_update_id", null);

    if (attachRows && attachRows.length > 0) {
      await supabase
        .from("issue_attachments")
        .update({ issue_update_id: newUpdate.id as string })
        .in("id", attachRows.map((r) => r.id as string));
    }
  }

  // ---------- 写事件日志 ----------
  const eventsToWrite: Parameters<typeof writeIssueEvents>[1] = [];
  if (statusTo && statusTo !== prev) {
    const isReopen = isReopenTransition(prev, statusTo);
    eventsToWrite.push({
      issueId:   issueId,
      actorId:   user.id,
      eventType: isReopen ? "issue_reopened" : statusTo === "closed" ? "issue_closed" : "status_changed",
      payload:   { from: prev, to: statusTo, update_id: newUpdate.id },
    });
  } else {
    eventsToWrite.push({
      issueId:   issueId,
      actorId:   user.id,
      eventType: "issue_updated",
      payload:   { update_id: newUpdate.id, content_length: content.length },
    });
  }
  await writeIssueEvents(supabase, eventsToWrite);

  // ---------- 企业微信通知 ----------

  // 进度更新内容→管理员（保留，与事件通知互补，携带更新文本摘要）
  notifyAdminsOnProgressUpdate({
    issueId,
    issueTitle:  issue.title as string,
    content,
    statusFrom:  prev,
    statusTo:    statusTo ?? prev,
    actorName:   user.name,
    actorUserId: user.id,
  });

  // 进度更新触发的状态变更→P3 事件通知（含防抖，覆盖 assignee/reviewer/creator/admin）
  if (statusTo && statusTo !== prev) {
    dispatchEventNotifications({
      issueId,
      issueTitle: issue.title as string,
      actorId:    user.id,
      actorName:  user.name,
      assigneeId: (issue.assignee_id as string | null) ?? null,
      reviewerId: (issue.reviewer_id as string | null) ?? null,
      creatorId:  issue.creator_id as string,
      changes:    [{ type: "status_changed", from: prev, to: statusTo }],
    });
  }

  // 进度更新标为阻塞时额外发一条带进度上下文的专项通知给负责人
  if (statusTo === "blocked" && prev !== "blocked") {
    notifyAssigneeOnBlocked({
      issueId,
      title:      issue.title as string,
      assigneeId: (issue.assignee_id as string | null) ?? null,
      actorName:  user.name,
    });
  }

  revalidatePath(`/issues/${issueId}`);
  revalidatePath("/issues");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
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
  const defaultReviewerId = await getDefaultReviewerId(supabase);

  let memberMap: Map<string, string> | undefined;
  const needsLookup = rows.some((r) => r.assignee_name?.trim());
  if (needsLookup) {
    const { data: members } = await supabase.from("users").select("id, name");
    memberMap = new Map((members ?? []).map((m) => [m.name as string, m.id as string]));
  }

  // 注意：bulkCreateIssues 是管理员批量导入已有数据的入口（source = 'import'）。
  // 由于是初始创建而非状态流转（没有 prevStatus），不经过状态机 guard。
  // 如果导入数据包含 pending_review / resolved / closed 状态，属于数据迁移场景，允许直接写入。
  const inserts = rows
    .filter((r) => r.title?.trim())
    .map((r) => ({
      title:       r.title.trim(),
      description: r.description?.trim() || null,
      priority:    (["low", "medium", "high", "urgent"].includes(r.priority) ? r.priority : "medium") as IssuePriority,
      status:      (["todo", "in_progress", "blocked", "pending_review", "pending_rework", "resolved", "closed"].includes(r.status ?? "")
        ? r.status : "todo") as IssueStatus,
      assignee_id: (r.assignee_name && memberMap?.get(r.assignee_name.trim())) || null,
      reviewer_id: defaultReviewerId,
      due_date:    r.due_date || null,
      creator_id:  user.id,
      source:      "import",
    }));

  if (inserts.length === 0) throw new Error("没有有效的问题数据");

  const { data: inserted, error } = await supabase
    .from("issues")
    .insert(inserts)
    .select("id");

  if (error) throw new Error(error.message);

  // 批量写入 issue_created 事件
  if (inserted && inserted.length > 0) {
    for (const row of inserted) {
      await writeIssueEvent(supabase, {
        issueId:   row.id as string,
        actorId:   user.id,
        eventType: "issue_created",
        payload:   { source: "import" },
      });
    }
  }

  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
  return inserts.length;
}

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

/**
 * 我的任务页面数据聚合：一次性并行获取所有数据，消除串行瀑布。
 *
 * 原模式（串行）：open issues → updates today（+100-200ms 延迟）
 * 优化后（两轮并行）：
 *   第1轮：open issues + following issues（并行）
 *   第2轮：今日 updates + 跟进 issues 详情（并行，与第1轮部分重叠）
 */
export async function getMyTasksBundle(): Promise<{
  needUpdate: IssueWithRelations[];
  updatedToday: IssueWithRelations[];
  following: IssueWithRelations[];
}> {
  const user = await getCurrentUser();
  if (!user) return { needUpdate: [], updatedToday: [], following: [] };

  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();

  // ── 第1轮：open issues + following participants 并行 ─────────────────────
  const [openRes, participantRes] = await Promise.all([
    supabase
      .from("issues")
      .select(issueSelect)
      .eq("assignee_id", user.id)
      .neq("status", "resolved")
      .neq("status", "closed")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase
      .from("issue_participants")
      .select("issue_id")
      .eq("user_id", user.id)
      .eq("active", true)
      .in("role", ["handover_from"]),
  ]);

  const openIssues = (openRes.data ?? []) as IssueWithRelations[];
  const participantIssueIds = [
    ...new Set((participantRes.data ?? []).map((r) => r.issue_id as string)),
  ];

  const activeIds = openIssues
    .filter((i) => ACTIVE_STATUSES.includes(i.status))
    .map((i) => i.id);

  // ── 第2轮：today's updates + following issues 详情 并行 ──────────────────
  const [updatesRes, followingRes] = await Promise.all([
    activeIds.length > 0
      ? supabase
          .from("issue_updates")
          .select("issue_id")
          .in("issue_id", activeIds)
          .gte("created_at", startIso)
          .lte("created_at", endIso)
      : Promise.resolve({ data: [] as { issue_id: string }[] }),
    participantIssueIds.length > 0
      ? supabase
          .from("issues")
          .select(issueSelect)
          .in("id", participantIssueIds)
          .neq("assignee_id", user.id)
          .neq("status", "resolved")
          .neq("status", "closed")
          .order("last_activity_at", { ascending: false })
      : Promise.resolve({ data: [] as IssueWithRelations[] }),
  ]);

  const updatedSet = new Set((updatesRes.data ?? []).map((u) => (u as { issue_id: string }).issue_id));
  const following = (followingRes.data ?? []) as IssueWithRelations[];

  const needUpdate: IssueWithRelations[] = [];
  const updatedToday: IssueWithRelations[] = [];

  for (const issue of openIssues) {
    if (ACTIVE_STATUSES.includes(issue.status)) {
      if (updatedSet.has(issue.id)) updatedToday.push(issue);
      else needUpdate.push(issue);
    } else {
      updatedToday.push(issue);
    }
  }

  return { needUpdate, updatedToday, following };
}

/** 我跟进的：我曾经参与交接但不再是当前负责人的未关闭问题 */
export async function getMyFollowingIssues(): Promise<IssueWithRelations[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();

  const { data: participantRows, error: pErr } = await supabase
    .from("issue_participants")
    .select("issue_id")
    .eq("user_id", user.id)
    .eq("active", true)
    .in("role", ["handover_from"]);

  if (pErr || !participantRows?.length) return [];

  const issueIds = [...new Set(participantRows.map((r) => r.issue_id as string))];
  const { data, error } = await supabase
    .from("issues")
    .select(issueSelect)
    .in("id", issueIds)
    .neq("assignee_id", user.id)
    .neq("status", "resolved")
    .neq("status", "closed")
    .order("last_activity_at", { ascending: false });

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

/** 在给定 issue id 集合中，返回「今日（上海日界）已有进展记录」的 id（一次查询，供我的任务等页批量分组） */
export async function getIssueIdsWithUpdateTodayAmong(issueIds: string[]): Promise<Set<string>> {
  if (issueIds.length === 0) return new Set();
  const supabase = await createClient();
  const { startIso, endIso } = getChinaDayBounds();
  const { data: updates } = await supabase
    .from("issue_updates")
    .select("issue_id")
    .in("issue_id", issueIds)
    .gte("created_at", startIso)
    .lte("created_at", endIso);
  return new Set((updates ?? []).map((u) => u.issue_id as string));
}

export async function addUpdateComment(updateId: string, content: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { error } = await supabase.from("issue_update_comments").insert({
    update_id: updateId,
    user_id:   user.id,
    content,
  });
  if (error) throw new Error(error.message);

  const { data: upRow } = await supabase
    .from("issue_updates")
    .select("issue_id")
    .eq("id", updateId)
    .single();

  if (upRow?.issue_id) {
    revalidatePath(`/issues/${upRow.issue_id}`);
  }
}

// ---------------------------------------------------------------------------
// 任务交接 / 返工退回（专属流程，含交接链路记录与参与者管理）
// ---------------------------------------------------------------------------

export async function handoverIssue(params: {
  issueId: string;
  toUserId: string;
  note?: string;
  attachmentNames?: string[];
  kind?: "handover" | "return";
}): Promise<{ error?: string }> {
  const kind = params.kind ?? "handover";
  const user = await getCurrentUser();
  if (!user) return { error: "未登录" };

  const supabase = await createClient();

  const { data: issue, error: fetchErr } = await supabase
    .from("issues")
    .select("title, assignee_id, reviewer_id, creator_id, status, parent_issue_id")
    .eq("id", params.issueId)
    .single();

  if (fetchErr || !issue) return { error: "问题不存在" };

  const isAdmin = user.role === "admin";
  const isAssignee = (issue.assignee_id as string | null) === user.id;
  if (!isAdmin && !isAssignee) return { error: "无权限发起交接" };

  if (params.toUserId === user.id) return { error: "不能交接给自己" };

  // 如果是返工退回，校验 toUserId 必须是最近一条交接来源
  if (kind === "return") {
    const { data: lastHandover } = await supabase
      .from("issue_handovers")
      .select("from_user_id")
      .eq("issue_id", params.issueId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!lastHandover || (lastHandover.from_user_id as string) !== params.toUserId) {
      return { error: "只能退回给最近一位交接来源" };
    }
  }

  const fromUserId = issue.assignee_id as string | null;

  // 1. 更新负责人
  const { error: updateErr } = await supabase
    .from("issues")
    .update({ assignee_id: params.toUserId, last_activity_at: new Date().toISOString() })
    .eq("id", params.issueId);

  if (updateErr) return { error: updateErr.message };

  await syncChildAssignees(supabase, params.issueId, params.toUserId);

  // 2. 写 issue_handovers 记录
  if (kind === "return") {
    await supabase
      .from("issue_handovers")
      .update({ status: "returned" })
      .eq("issue_id", params.issueId)
      .eq("status", "active");
  }
  await supabase.from("issue_handovers").insert({
    issue_id:        params.issueId,
    from_user_id:    fromUserId ?? user.id,
    to_user_id:      params.toUserId,
    kind,
    note:            params.note?.trim() || null,
    attachment_names: params.attachmentNames?.length ? params.attachmentNames : null,
    status:          "active",
  });

  // 3. upsert issue_participants（原负责人作为跟进人保留）
  if (fromUserId) {
    await supabase.from("issue_participants").upsert(
      { issue_id: params.issueId, user_id: fromUserId, role: "handover_from", active: true },
      { onConflict: "issue_id,user_id,role" }
    );
  }
  await supabase.from("issue_participants").upsert(
    { issue_id: params.issueId, user_id: params.toUserId, role: "assignee", active: true },
    { onConflict: "issue_id,user_id,role" }
  );

  // 4. 写独立事件日志
  const eventType = kind === "return" ? "handover_return" : "handover";
  await writeIssueEvent(supabase, {
    issueId:   params.issueId,
    actorId:   user.id,
    eventType,
    payload:   { from: fromUserId, to: params.toUserId, kind, note: params.note?.trim() || null },
  });

  // 5. 创建进展更新（作为交接存档）
  const kindLabel = kind === "return" ? "返工退回" : "任务交接";
  const noteLines: string[] = [`【${kindLabel}】`];
  if (params.note?.trim()) noteLines.push(params.note.trim());
  if (params.attachmentNames && params.attachmentNames.length > 0) {
    noteLines.push(`已附上交接文件：${params.attachmentNames.join("、")}`);
  }
  await supabase.from("issue_updates").insert({
    issue_id:            params.issueId,
    user_id:             user.id,
    content:             noteLines.join("\n"),
    status_from:         issue.status,
    status_to:           issue.status,
    update_type:         "comment",
    is_system_generated: false,
  });

  // 6. 发送交接/退回专项通知（fire-and-forget）
  const isSubtask = !!(issue.parent_issue_id as string | null);
  if (!isSubtask) {
    dispatchEventNotifications({
      issueId:    params.issueId,
      issueTitle: issue.title as string,
      actorId:    user.id,
      actorName:  user.name,
      assigneeId: params.toUserId,
      reviewerId: (issue.reviewer_id as string | null) ?? null,
      creatorId:  issue.creator_id as string,
      changes:    [{
        type:            kind === "return" ? "handover_return" : "handover",
        fromId:          user.id,
        toId:            params.toUserId,
        note:            params.note?.trim() || undefined,
        attachmentNames: params.attachmentNames?.length ? params.attachmentNames : undefined,
      }],
    });
  }

  revalidatePath(`/issues/${params.issueId}`);
  revalidatePath("/issues");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
  revalidatePath("/dashboard");

  return {};
}

/** 查询当前 issue 最近一条 active 交接的来源用户，用于"退回上一位"入口 */
export async function getLastHandoverFrom(issueId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("issue_handovers")
    .select("from_user_id")
    .eq("issue_id", issueId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.from_user_id as string) ?? null;
}

export async function toggleSubtaskCompletion(subtaskId: string, completed: boolean) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data: subtask, error } = await supabase
    .from("issues")
    .select("id, title, status, parent_issue_id, assignee_id, reviewer_id, creator_id")
    .eq("id", subtaskId)
    .single();

  if (error || !subtask) throw new Error("子任务不存在");
  if (!subtask.parent_issue_id) throw new Error("当前问题不是子任务");

  const { data: parentIssue } = await supabase
    .from("issues")
    .select("id, assignee_id")
    .eq("id", subtask.parent_issue_id)
    .single();

  const isAdmin = user.role === "admin";
  const isParentAssignee = (parentIssue?.assignee_id as string | null) === user.id;
  if (!isAdmin && !isParentAssignee) {
    throw new Error("仅父任务负责人或管理员可勾选子任务");
  }

  const nextStatus: IssueStatus = completed ? "resolved" : "todo";
  const patch: Record<string, unknown> = {
    status: nextStatus,
    last_activity_at: new Date().toISOString(),
    resolved_at: completed ? new Date().toISOString() : null,
    closed_at: null,
    blocked_reason: null,
    closed_reason: null,
  };

  const { error: updateErr } = await supabase
    .from("issues")
    .update(patch)
    .eq("id", subtaskId);

  if (updateErr) throw new Error(updateErr.message);

  await writeIssueEvent(supabase, {
    issueId: subtaskId,
    actorId: user.id,
    eventType: "status_changed",
    payload: {
      from: subtask.status,
      to: nextStatus,
      via: "subtask_checkbox",
    },
  });

  revalidatePath(`/issues/${subtaskId}`);
  revalidatePath(`/issues/${subtask.parent_issue_id}`);
  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
  revalidatePath("/home");
}

// ---------------------------------------------------------------------------
// 内部工具函数
// ---------------------------------------------------------------------------

/** 检查 issue 是否至少存在一条非系统生成的进度更新 */
async function checkHasNonSystemUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  issueId: string
): Promise<boolean> {
  const { count } = await supabase
    .from("issue_updates")
    .select("id", { count: "exact", head: true })
    .eq("issue_id", issueId)
    .eq("is_system_generated", false);
  return (count ?? 0) > 0;
}

async function getIncompleteSubtaskCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  issueId: string
): Promise<number> {
  const { count } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("parent_issue_id", issueId)
    .not("status", "in", '("resolved","closed")');

  return count ?? 0;
}

async function markHandoversCompleted(
  supabase: Awaited<ReturnType<typeof createClient>>,
  issueId: string
) {
  await supabase
    .from("issue_handovers")
    .update({ status: "completed" })
    .eq("issue_id", issueId)
    .eq("status", "active");
}

async function normalizeTopLevelInProgressIssues(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data, error } = await supabase
    .from("issues")
    .select("id, assignee_id")
    .is("parent_issue_id", null)
    .eq("status", "in_progress")
    .not("assignee_id", "is", null)
    .order("assignee_id", { ascending: true })
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false });

  if (error || !data?.length) {
    if (error) console.error("[normalizeTopLevelInProgressIssues] error:", error.message);
    return;
  }

  const seenAssigneeIds = new Set<string>();
  const demotedIds: string[] = [];

  for (const row of data) {
    const assigneeId = row.assignee_id as string | null;
    if (!assigneeId) continue;
    if (seenAssigneeIds.has(assigneeId)) {
      demotedIds.push(row.id as string);
      continue;
    }
    seenAssigneeIds.add(assigneeId);
  }

  if (demotedIds.length === 0) return;

  const { error: updateError } = await supabase
    .from("issues")
    .update({ status: "todo" })
    .in("id", demotedIds);

  if (updateError) {
    console.error("[normalizeTopLevelInProgressIssues] demote error:", updateError.message);
  }
}

async function findOtherTopLevelInProgressIssue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assigneeId: string,
  currentIssueId: string
) {
  const { data, error } = await supabase
    .from("issues")
    .select("id, title")
    .is("parent_issue_id", null)
    .eq("assignee_id", assigneeId)
    .eq("status", "in_progress")
    .neq("id", currentIssueId)
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[findOtherTopLevelInProgressIssue] error:", error.message);
    return null;
  }

  return data as { id: string; title: string } | null;
}

async function syncChildAssignees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parentIssueId: string,
  assigneeId: string | null
) {
  const { error } = await supabase
    .from("issues")
    .update({ assignee_id: assigneeId })
    .eq("parent_issue_id", parentIssueId);

  if (error) {
    console.error("[syncChildAssignees] error:", error.message);
  }
}

function validateStatusActorPermission(opts: {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;
  from: IssueStatus;
  to: IssueStatus;
  assigneeId: string | null;
  reviewerId: string | null;
}) {
  return validateTransitionActor({
    from:       opts.from,
    to:         opts.to,
    isAdmin:    opts.user.role === "admin",
    isAssignee: opts.user.id === opts.assigneeId,
    isReviewer: opts.user.id === opts.reviewerId,
  });
}

async function getDefaultReviewerId(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string | null> {
  const { data: admins } = await supabase
    .from("users")
    .select("id, name, email")
    .eq("role", "admin");

  if (!admins?.length) return null;

  const scored = admins
    .map((row) => {
      const name = String(row.name ?? "").trim().toLowerCase();
      const email = String(row.email ?? "").trim().toLowerCase();
      let score = 0;

      if (name === "郝毅") score += 100;
      else if (name.includes("郝毅")) score += 80;

      if (email.startsWith("haoyi@")) score += 60;
      else if (email.includes("haoyi")) score += 40;

      return { id: row.id as string, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.id ?? null;
}
