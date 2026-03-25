/**
 * P3: 事件驱动通知派发器
 *
 * 职责：
 * 1. 基于工单字段变更集合，确定各变更类型对应的接收人
 * 2. 将同一次操作的多个变更合并为单条摘要消息（同次更新合并）
 * 3. 10 分钟防抖：以「事件子类型桶」为粒度防抖，不同重要事件不会互相误杀
 *    防抖键 = issue_id + target_user_id + event_bucket + 10min 窗口
 *    event_bucket 见下方 BUCKET_* 常量说明
 * 4. 通过 notification-service 发送（留 notification_deliveries 日志，支持重试）
 *
 * 操作者本人不会收到任何通知（已在接收人集合建立后统一排除）。
 * creator / assignee / reviewer 同一人时，Set 自动去重，不会重复发送。
 * wecom_userid 缺失时静默跳过（不写 failed 记录），避免批量刷噪音日志。
 *
 * 调用方：
 *   actions/issues.ts（createIssue / updateIssue / addIssueUpdate）
 *
 * 不涉及：
 *   Cron 催办（daily-reminder / morning-assignee-digest / admin-escalation）
 *   进度更新内容通知（dingtalkAfterProgressUpdate，继续独立运行）
 */

import type { IssueStatus, IssuePriority } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification, sendGroupDigest } from "@/lib/notification-service";
import { getIssueDetailUrl } from "@/lib/app-url";
import { isWecomAppConfigured, isWecomWebhookConfigured } from "@/lib/wecom";

// ─── 防抖窗口 ─────────────────────────────────────────────────────────────────

/** 同一工单同一接收人的最短通知间隔（毫秒） */
const DEBOUNCE_MS = 10 * 60 * 1000;

// ─── 事件桶（防抖粒度）────────────────────────────────────────────────────────
//
// 防抖以"事件桶"为单位，不同桶的事件互不影响。
// 例：10 分钟内先发了 assignee 变更通知，5 分钟后进入 blocked 状态，
//     两个桶不同，blocked 通知仍会发出，不会被误杀。
//
// 桶优先级（高 → 低）：status > priority > due_date > assignment > created
// 同一批次包含多种变更时，取最高优先级桶作为该批次的代表桶。

const BUCKET_STATUS     = "issue_event.status";
const BUCKET_PRIORITY   = "issue_event.priority";
const BUCKET_DUE_DATE   = "issue_event.due_date";
const BUCKET_ASSIGNMENT = "issue_event.assignment";
const BUCKET_CREATED    = "issue_event.created";

const BUCKET_PRIORITY_ORDER = [
  BUCKET_STATUS,
  BUCKET_PRIORITY,
  BUCKET_DUE_DATE,
  BUCKET_ASSIGNMENT,
  BUCKET_CREATED,
] as const;

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

/** 可触发通知的变更类型 */
export type NotifiableChange =
  | { type: "issue_created" }
  | { type: "assignee_changed"; fromId: string | null; toId: string | null }
  | { type: "reviewer_changed"; fromId: string | null; toId: string | null }
  | { type: "status_changed"; from: IssueStatus; to: IssueStatus }
  | { type: "priority_urgent"; from: IssuePriority }
  /** due_date 提前（更紧）才触发，推后或首次设置不触发 */
  | { type: "due_date_advanced"; from: string; to: string };

export interface EventNotificationContext {
  issueId:    string;
  /** 当前工单标题（更新后） */
  issueTitle: string;
  /** 操作者用户 ID */
  actorId:    string;
  /** 操作者显示名 */
  actorName:  string;
  /** 更新后的负责人 ID */
  assigneeId: string | null;
  /** 更新后的评审人 ID */
  reviewerId: string | null;
  /** 工单创建者 ID */
  creatorId:  string;
  /** 本次操作产生的所有变更 */
  changes:    NotifiableChange[];
}

// ─── 对外入口（fire-and-forget，不阻塞主流程） ────────────────────────────────

/**
 * 派发事件驱动通知。
 * 内部异步执行，不会抛出异常到调用方。
 */
export function dispatchEventNotifications(ctx: EventNotificationContext): void {
  if (ctx.changes.length === 0) return;
  void _dispatch(ctx).catch((e) =>
    console.error("[event-notification] dispatch failed:", e instanceof Error ? e.message : e)
  );
}

// ─── 内部实现 ─────────────────────────────────────────────────────────────────

function tryDB() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

/** 确定该批次变更所属的最高优先级事件桶（用作防抖键与 trigger_source） */
function getEventBucket(changes: NotifiableChange[]): string {
  const buckets = new Set<string>();
  for (const c of changes) {
    if (c.type === "status_changed")   buckets.add(BUCKET_STATUS);
    if (c.type === "priority_urgent")  buckets.add(BUCKET_PRIORITY);
    if (c.type === "due_date_advanced") buckets.add(BUCKET_DUE_DATE);
    if (c.type === "assignee_changed" || c.type === "reviewer_changed") buckets.add(BUCKET_ASSIGNMENT);
    if (c.type === "issue_created")    buckets.add(BUCKET_CREATED);
  }
  for (const b of BUCKET_PRIORITY_ORDER) {
    if (buckets.has(b)) return b;
  }
  return BUCKET_ASSIGNMENT;
}

const STATUS_LABELS: Record<IssueStatus, string> = {
  todo:           "待处理",
  in_progress:    "处理中",
  blocked:        "阻塞",
  pending_review: "待验证",
  resolved:       "已解决",
  closed:         "已关闭",
};

const PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: "低", medium: "中", high: "高", urgent: "紧急",
};

type UserRow = { name: string; wecom_userid: string | null };

async function _dispatch(ctx: EventNotificationContext): Promise<void> {
  const appOk     = isWecomAppConfigured();
  const webhookOk = isWecomWebhookConfigured();
  if (!appOk && !webhookOk) return;

  const db = tryDB();
  if (!db) return;

  // ── 1. 确定接收人集合 ──────────────────────────────────────────────────────
  //
  // 使用 Set<string> 自动去重：creator / assignee / reviewer 同一人时只进一次，
  // 确保不会为同一用户发送重复消息。
  const recipientIds = new Set<string>();
  let needAdmins = false;

  for (const change of ctx.changes) {
    switch (change.type) {
      case "issue_created":
        if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
        if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        break;

      case "assignee_changed":
        // 新负责人 + 评审人（需知晓工单负责人变动）
        if (change.toId) recipientIds.add(change.toId);
        if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        break;

      case "reviewer_changed":
        // 新评审人 + 负责人
        if (change.toId) recipientIds.add(change.toId);
        if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
        break;

      case "status_changed": {
        const { to } = change;
        if (to === "blocked") {
          // 阻塞：负责人和评审人都需采取行动
          if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
          if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        } else if (to === "pending_review") {
          // 待验证：评审人需采取行动，抄送负责人
          if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
          if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
        } else if (to === "resolved" || to === "closed") {
          // 已解决/已关闭：通知负责人、评审人、创建者、管理员
          if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
          if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
          recipientIds.add(ctx.creatorId);
          needAdmins = true;
        } else if (to === "in_progress" && change.from === "closed") {
          // 重新打开：负责人与评审人
          if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
          if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        }
        break;
      }

      case "priority_urgent":
        if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
        if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        break;

      case "due_date_advanced":
        if (ctx.assigneeId) recipientIds.add(ctx.assigneeId);
        if (ctx.reviewerId) recipientIds.add(ctx.reviewerId);
        break;
    }
  }

  // 操作者本人不收通知（覆盖所有事件类型，统一在此排除）
  recipientIds.delete(ctx.actorId);

  // 按需加载管理员（resolved / closed 场景）
  if (needAdmins) {
    const { data: admins } = await db
      .from("users")
      .select("id")
      .eq("role", "admin") as { data: { id: string }[] | null };
    for (const a of admins ?? []) {
      // 管理员也适用"操作者不自通知"规则
      if (a.id !== ctx.actorId) recipientIds.add(a.id);
    }
  }

  // ── 2. 批量查询用户信息 ────────────────────────────────────────────────────
  // 接收人 + 变更中引用的 from/to 用户 ID（用于消息中展示名字）
  const needUserIds = new Set<string>(recipientIds);
  for (const change of ctx.changes) {
    if (change.type === "assignee_changed" || change.type === "reviewer_changed") {
      if (change.fromId) needUserIds.add(change.fromId);
      if (change.toId)   needUserIds.add(change.toId);
    }
  }

  if (needUserIds.size === 0) return;

  const { data: users } = await db
    .from("users")
    .select("id, name, wecom_userid")
    .in("id", Array.from(needUserIds)) as { data: (UserRow & { id: string })[] | null };

  const userMap = new Map<string, UserRow>(
    (users ?? []).map((u) => [u.id, { name: u.name, wecom_userid: u.wecom_userid }])
  );

  // ── 3. 确定事件桶（防抖粒度）─────────────────────────────────────────────
  const bucket = getEventBucket(ctx.changes);

  // ── 4. 构建消息 ────────────────────────────────────────────────────────────
  const { msgTitle, msgBody } = buildMessage(ctx, userMap);

  // ── 5. 逐人发送（含按桶防抖）─────────────────────────────────────────────
  if (appOk && recipientIds.size > 0) {
    const since = new Date(Date.now() - DEBOUNCE_MS).toISOString();

    const tasks = Array.from(recipientIds).map(async (uid) => {
      const u = userMap.get(uid);
      const wecomId = u?.wecom_userid?.trim() || null;

      // wecom_userid 缺失时静默跳过，不写 failed delivery 记录。
      // 原因：这是配置缺失（非发送失败），频繁写 failed 会污染管理后台失败统计。
      // 管理员应通过 /members 页的"未配置企业微信"区域修复根因。
      if (!wecomId) return;

      // 防抖检查：以 issue_id + user_id + event_bucket 为键，10 分钟内同桶只发一次。
      // 不同桶（如 assignment vs status）不会互相阻塞，避免重要事件被误杀。
      const { data: recent } = await db
        .from("notification_deliveries")
        .select("id")
        .eq("issue_id", ctx.issueId)
        .eq("target_user_id", uid)
        .eq("trigger_source", bucket)
        .in("status", ["pending", "success"])
        .gte("created_at", since)
        .limit(1)
        .maybeSingle() as { data: { id: string } | null };

      if (recent) {
        console.log(
          `[event-notification] debounced bucket=${bucket} ` +
          `issue=${ctx.issueId.slice(0, 8)} user=${uid.slice(0, 8)}`
        );
        return;
      }

      await sendNotification({
        channel:           "wecom_app",
        targetWecomUserid: wecomId,
        targetUserId:      uid,
        issueId:           ctx.issueId,
        triggerSource:     bucket,
        title:             msgTitle,
        content:           msgBody,
      });
    });

    await Promise.all(tasks);
  }

  // ── 6. 群机器人汇总（单条，无防抖）───────────────────────────────────────
  if (webhookOk) {
    const groupBody = buildGroupMessage(ctx, userMap);
    await sendGroupDigest({
      content:       groupBody,
      issueId:       ctx.issueId,
      triggerSource: "issue_event",
    });
  }
}

// ─── 消息构建 ─────────────────────────────────────────────────────────────────

function buildMessage(
  ctx: EventNotificationContext,
  userMap: Map<string, UserRow>
): { msgTitle: string; msgBody: string } {
  const url = getIssueDetailUrl(ctx.issueId);
  const ref = url ? `[${ctx.issueTitle}](${url})` : `**${ctx.issueTitle}**`;

  const isCreated = ctx.changes.length === 1 && ctx.changes[0].type === "issue_created";

  // 标题：单变更用语义标题，多变更用摘要
  let msgTitle: string;
  if (isCreated) {
    msgTitle = `新工单：${ctx.issueTitle.slice(0, 20)}${ctx.issueTitle.length > 20 ? "…" : ""}`;
  } else if (ctx.changes.length === 1) {
    msgTitle = `${changeSemanticTitle(ctx.changes[0])} · ${ctx.issueTitle.slice(0, 16)}${ctx.issueTitle.length > 16 ? "…" : ""}`;
  } else {
    msgTitle = `工单动态（${ctx.changes.length} 项变更）· ${ctx.issueTitle.slice(0, 10)}…`;
  }

  // 正文
  const lines: string[] = [];

  if (isCreated) {
    lines.push(`## 新工单已分配`);
    lines.push("");
    lines.push(`工单：${ref}`);
    lines.push("");
    lines.push(`由 **${ctx.actorName}** 创建，请及时跟进。`);
  } else {
    // 多变更时用最重要的事件作为标题
    const heading = ctx.changes.length === 1
      ? changeSemanticTitle(ctx.changes[0])
      : "工单有新动态";
    lines.push(`## ${heading}`);
    lines.push("");
    lines.push(`工单：${ref}`);
    lines.push("");
    if (ctx.changes.length > 1) lines.push("本次变更：");
    for (const change of ctx.changes) {
      const line = formatChangeLine(change, userMap);
      if (line) lines.push(line);
    }
    lines.push("");
    lines.push(`由 **${ctx.actorName}** 操作。`);
  }

  return { msgTitle, msgBody: lines.join("\n") };
}

function buildGroupMessage(
  ctx: EventNotificationContext,
  userMap: Map<string, UserRow>
): string {
  const url = getIssueDetailUrl(ctx.issueId);
  const ref = url ? `[${ctx.issueTitle}](${url})` : `**${ctx.issueTitle}**`;

  const lines = [
    `### 工单动态 · ${ctx.issueTitle.slice(0, 20)}`,
    `- 工单：${ref}`,
    `- 操作人：**${ctx.actorName}**`,
  ];

  for (const change of ctx.changes) {
    const line = formatChangeLine(change, userMap);
    if (line) lines.push(line);
  }

  return lines.join("\n");
}

/**
 * 结果导向的语义标题（让接收人一眼看到结果词，而非 A→B 状态字段名）
 */
function changeSemanticTitle(change: NotifiableChange): string {
  switch (change.type) {
    case "issue_created":    return "新工单已分配";
    case "assignee_changed": return "工单负责人已变更";
    case "reviewer_changed": return "工单评审人已变更";
    case "status_changed":
      if (change.to === "resolved")                            return "工单已解决";
      if (change.to === "closed")                              return "工单已关闭";
      if (change.to === "blocked")                             return "工单进入阻塞";
      if (change.to === "pending_review")                      return "工单待验证，请查阅";
      if (change.to === "in_progress" && change.from === "closed") return "工单已重新打开";
      return "工单状态已变更";
    case "priority_urgent":   return "工单优先级提升为紧急";
    case "due_date_advanced": return "工单截止日期已提前";
    default: return "工单有新动态";
  }
}

/**
 * 单条变更的描述行（结果导向，让接收人快速看清发生了什么）
 */
function formatChangeLine(
  change: NotifiableChange,
  userMap: Map<string, UserRow>
): string {
  const getName = (id: string | null) =>
    id ? (userMap.get(id)?.name ?? "（未知）") : "（未设置）";

  switch (change.type) {
    case "assignee_changed":
      return `- 负责人变更：${getName(change.fromId)} → **${getName(change.toId)}**`;
    case "reviewer_changed":
      return `- 评审人变更：${getName(change.fromId)} → **${getName(change.toId)}**`;
    case "status_changed":
      // 特殊结果词，比 A→B 更清晰
      if (change.to === "resolved")
        return `- **工单已解决**（原状态：${STATUS_LABELS[change.from] ?? change.from}）`;
      if (change.to === "closed")
        return `- **工单已关闭**（原状态：${STATUS_LABELS[change.from] ?? change.from}）`;
      if (change.to === "in_progress" && change.from === "closed")
        return `- **工单已重新打开**（原状态：已关闭）`;
      if (change.to === "blocked")
        return `- **状态变更：${STATUS_LABELS[change.from] ?? change.from} → 阻塞**`;
      if (change.to === "pending_review")
        return `- **状态变更：${STATUS_LABELS[change.from] ?? change.from} → 待验证**`;
      return `- 状态变更：${STATUS_LABELS[change.from] ?? change.from} → **${STATUS_LABELS[change.to] ?? change.to}**`;
    case "priority_urgent":
      return `- 优先级提升至：**紧急**（原：${PRIORITY_LABELS[change.from] ?? change.from}）`;
    case "due_date_advanced":
      return `- 截止日期提前：${change.from} → **${change.to}**`;
    default:
      return "";
  }
}
