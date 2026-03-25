"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getChinaDayBounds } from "@/lib/dates";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { validateTransition, isReopenTransition } from "@/lib/issue-state-machine";
import { writeIssueEvent, writeIssueEvents } from "@/lib/issue-events";
import type {
  IssuePriority,
  IssueAttachment,
  IssueAttachmentWithUrl,
  IssueEventWithActor,
  IssueStatus,
  IssueUpdateWithUser,
  IssueWithRelations,
  UpdateCommentWithUser,
} from "@/types";
import {
  dingtalkAfterIssueUpdateToBlocked,
  dingtalkAfterProgressUpdate,
} from "@/lib/issue-dingtalk-notify";
import {
  dispatchEventNotifications,
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
};

export async function getIssues(filters: IssueFilters = {}): Promise<IssueWithRelations[]> {
  const supabase = await createClient();
  const sortBy  = filters.sortBy  ?? "updated_at";
  const sortDir = filters.sortDir ?? "desc";

  // priority 排序在 app-side 完成（Supabase 不支持自定义枚举顺序）。
  // 重要：query 不加 .limit()，先拉取全部匹配结果再排序，避免先分页后排序导致跨页顺序错乱。
  const dbSortBy  = sortBy === "priority" ? "updated_at" : sortBy;
  const ascending = sortDir === "asc";

  let query = supabase
    .from("issues")
    .select(issueSelect)
    .order(dbSortBy, { ascending, nullsFirst: false });

  if (filters.status?.length) query = query.in("status", filters.status);
  if (filters.priority?.length) query = query.in("priority", filters.priority);
  if (filters.assigneeId) query = query.eq("assignee_id", filters.assigneeId);
  if (filters.reviewerId) query = query.eq("reviewer_id", filters.reviewerId);
  if (filters.category?.trim()) query = query.ilike("category", `%${filters.category.trim()}%`);
  if (filters.module?.trim())   query = query.ilike("module",   `%${filters.module.trim()}%`);
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
        query = query.lt("last_activity_at", staleThreshold).in("status", ["in_progress", "blocked", "pending_review"]);
        break;
    }
  }

  const { data, error } = await query;
  if (error) { console.error(error); return []; }

  let rows = (data ?? []) as IssueWithRelations[];

  // 优先级排序（app-side）
  if (sortBy === "priority") {
    const ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    rows = rows.sort((a, b) => {
      const diff = (ORDER[a.priority] ?? 9) - (ORDER[b.priority] ?? 9);
      return ascending ? diff : -diff;
    });
  }

  return rows;
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

  const { data: rawAttachments } = await supabase
    .from("issue_attachments")
    .select("*")
    .eq("issue_id", id)
    .order("created_at", { ascending: true });

  const attachmentsWithUrls: IssueAttachmentWithUrl[] = await Promise.all(
    ((rawAttachments ?? []) as IssueAttachment[]).map(async (a) => {
      const { data } = await supabase.storage
        .from("issue-files")
        .createSignedUrl(a.storage_path, 3600);
      return { ...a, url: data?.signedUrl ?? undefined };
    })
  );

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
    .select(`*, actor:users!issue_events_actor_id_fkey(id, name)`)
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
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .insert({
      title:       input.title,
      description: input.description ?? null,
      priority:    input.priority,
      assignee_id: input.assignee_id ?? null,
      reviewer_id: input.reviewer_id ?? null,
      due_date:    input.due_date || null,
      status:      input.status ?? "todo",
      creator_id:  user.id,
      category:    input.category ?? null,
      module:      input.module ?? null,
      source:      input.source ?? "manual",
    })
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
      title:       input.title,
      priority:    input.priority,
      assignee_id: input.assignee_id ?? null,
      status:      input.status ?? "todo",
    },
  });

  dispatchEventNotifications({
    issueId:    newId,
    issueTitle: input.title,
    actorId:    user.id,
    actorName:  user.name,
    assigneeId: input.assignee_id ?? null,
    reviewerId: input.reviewer_id ?? null,
    creatorId:  user.id,
    changes:    [{ type: "issue_created" }],
  });

  revalidatePath("/issues");
  revalidatePath("/dashboard");
  revalidatePath("/my-tasks");
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
) {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: beforeRow } = await supabase
    .from("issues")
    .select("title, creator_id, assignee_id, reviewer_id, status, priority, due_date, reopen_count, blocked_reason, closed_reason")
    .eq("id", id)
    .single();

  if (!beforeRow) throw new Error("问题不存在");

  const prevStatus = beforeRow.status as IssueStatus;
  const newStatus  = patch.status;

  // ---------- 状态机校验（服务端权威） ----------
  if (newStatus && newStatus !== prevStatus) {
    const hasNonSystemUpdate = await checkHasNonSystemUpdate(supabase, id);

    const transErr = validateTransition(prevStatus, newStatus, {
      blockedReason:       patch.blocked_reason ?? (beforeRow.blocked_reason as string | null),
      closedReason:        patch.closed_reason  ?? (beforeRow.closed_reason  as string | null),
      hasNonSystemUpdate,
    });
    if (transErr) throw new Error(transErr.message);
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

  if (error) throw new Error(error.message);

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

    if (notifChanges.length > 0) {
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
        changes:    notifChanges,
      });
    }
  }

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

    const transErr = validateTransition(prev, statusTo, {
      blockedReason:       opts?.blockedReason ?? (issue.blocked_reason as string | null),
      closedReason:        opts?.closedReason  ?? (issue.closed_reason  as string | null),
      // 提交进度时 content 本身就是更新，视为满足 hasNonSystemUpdate
      hasNonSystemUpdate:  hasNonSystemUpdate || content.trim().length > 0,
    });
    if (transErr) throw new Error(transErr.message);
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
  dingtalkAfterProgressUpdate({
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
    dingtalkAfterIssueUpdateToBlocked({
      issueId,
      title:      issue.title as string,
      assigneeId: (issue.assignee_id as string | null) ?? null,
      actorName:  user.name,
    });
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

  // 注意：bulkCreateIssues 是管理员批量导入已有数据的入口（source = 'import'）。
  // 由于是初始创建而非状态流转（没有 prevStatus），不经过状态机 guard。
  // 如果导入数据包含 pending_review / resolved / closed 状态，属于数据迁移场景，允许直接写入。
  const inserts = rows
    .filter((r) => r.title?.trim())
    .map((r) => ({
      title:       r.title.trim(),
      description: r.description?.trim() || null,
      priority:    (["low", "medium", "high", "urgent"].includes(r.priority) ? r.priority : "medium") as IssuePriority,
      status:      (["todo", "in_progress", "blocked", "pending_review", "resolved", "closed"].includes(r.status ?? "")
        ? r.status : "todo") as IssueStatus,
      assignee_id: (r.assignee_name && memberMap?.get(r.assignee_name.trim())) || null,
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
