import { createClient } from "@/lib/supabase/server";
import {
  sendDingtalkMarkdown,
  sendDingtalkWorkNoticeAndLogDelivery,
  isDingtalkAppConfigured,
  isDingtalkWebhookConfigured,
} from "@/lib/dingtalk";
import { getIssueDetailUrl, getPublicAppUrl } from "@/lib/app-url";
import type { IssueStatus } from "@/types";

function formatIssueRef(issueId: string, title: string): string {
  const url = getIssueDetailUrl(issueId);
  if (url) return `[${title}](${url})`;
  return `**${title}**（路径 \`/issues/${issueId}\`，请配置 NEXT_PUBLIC_APP_URL 以生成可点击链接）`;
}

async function getDingtalkUserid(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("dingtalk_userid").eq("id", userId).maybeSingle();
  const v = data?.dingtalk_userid?.trim();
  return v || null;
}

async function getUserName(userId: string): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("name").eq("id", userId).maybeSingle();
  return (data?.name as string) || "成员";
}

async function getAdminUserIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("id").eq("role", "admin");
  return (data ?? []).map((u) => u.id as string);
}

async function webhook(title: string, markdown: string) {
  if (!isDingtalkWebhookConfigured()) return;
  await sendDingtalkMarkdown(title, markdown);
}

async function workNoticeToUser(
  userId: string,
  title: string,
  markdown: string,
  logContext: string
) {
  if (!isDingtalkAppConfigured()) return;
  const dt = await getDingtalkUserid(userId);
  if (!dt) return;
  await sendDingtalkWorkNoticeAndLogDelivery(dt, title, markdown, logContext);
}

function isTerminalStatus(s: IssueStatus): boolean {
  return s === "resolved" || s === "closed";
}

/** 已解决 / 已关闭：私信通知创建人与负责人（去重），不通知操作者本人 */
export function dingtalkAfterIssueResolvedOrClosed(params: {
  issueId: string;
  title: string;
  status: "resolved" | "closed";
  creatorId: string;
  assigneeId: string | null;
  actorName: string;
  actorUserId: string;
}): void {
  void (async () => {
    if (!isDingtalkAppConfigured() && !isDingtalkWebhookConfigured()) return;

    const recipientIds = new Set<string>();
    recipientIds.add(params.creatorId);
    if (params.assigneeId) recipientIds.add(params.assigneeId);
    const admins = await getAdminUserIds();
    for (const aid of admins) recipientIds.add(aid);
    recipientIds.delete(params.actorUserId);

    const ref = formatIssueRef(params.issueId, params.title);
    const headline = params.status === "closed" ? "问题已关闭" : "问题已解决";
    const statusLine = params.status === "closed" ? "状态：**已关闭**" : "状态：**已解决**";

    const md = [`## ${headline}`, "", `- ${ref}`, "", statusLine, "", `由 **${params.actorName}** 更新。`].join(
      "\n"
    );

    const shortTitle = `${headline} · ${params.title.slice(0, 16)}${params.title.length > 16 ? "…" : ""}`;

    for (const uid of recipientIds) {
      await workNoticeToUser(
        uid,
        shortTitle,
        md,
        `resolved_or_closed issue=${params.issueId} status=${params.status} notify_user=${uid}`
      );
    }

    if (isDingtalkWebhookConfigured()) {
      const lines = [`### ${headline}`, `- ${ref}`, `- 操作：**${params.actorName}**`];
      if (recipientIds.size > 0) {
        const names: string[] = [];
        for (const uid of recipientIds) {
          names.push(await getUserName(uid));
        }
        lines.push(`- 已私信：**${names.join("、")}**`);
      } else {
        lines.push(`- 私信：处理人与相关方为同一人，未另发工作通知`);
      }
      await webhook(`问题跟踪 · ${headline}`, lines.join("\n"));
    }
  })().catch((e) => console.error("[dingtalk-event] resolved/closed", e));
}

/** 新建问题且已指派：通知负责人 + 可选群摘要 */
export function dingtalkAfterCreateIssue(params: {
  issueId: string;
  title: string;
  assigneeId: string | null;
  actorName: string;
}): void {
  void (async () => {
    if (!params.assigneeId) return;
    if (!isDingtalkAppConfigured() && !isDingtalkWebhookConfigured()) return;

    const ref = formatIssueRef(params.issueId, params.title);
    const md = [
      `## 新问题已指派给你`,
      "",
      `- ${ref}`,
      "",
      `由 **${params.actorName}** 创建。`,
    ].join("\n");

    await workNoticeToUser(
      params.assigneeId,
      `新问题：${params.title.slice(0, 20)}${params.title.length > 20 ? "…" : ""}`,
      md,
      `create_issue issue=${params.issueId} assignee=${params.assigneeId}`
    );

    const assigneeName = await getUserName(params.assigneeId);
    await webhook(
      "问题跟踪 · 新指派",
      [`### 新问题`, `- ${ref}`, `- 负责人：**${assigneeName}**`, `- 创建人：**${params.actorName}**`].join("\n")
    );
  })().catch((e) => console.error("[dingtalk-event] create", e));
}

export type IssueRowBeforeUpdate = {
  title: string;
  creator_id: string;
  assignee_id: string | null;
  status: IssueStatus;
  due_date: string | null;
};

/** 更新问题后的指派 / 阻塞 / 截止日期变更 / 已解决与已关闭 */
export function dingtalkAfterUpdateIssue(params: {
  issueId: string;
  before: IssueRowBeforeUpdate;
  patch: Partial<{
    title: string;
    assignee_id: string | null;
    status: IssueStatus;
    due_date: string | null;
  }>;
  actorName: string;
  actorUserId: string;
}): void {
  void (async () => {
    if (!isDingtalkAppConfigured() && !isDingtalkWebhookConfigured()) return;

    const { issueId, before, patch, actorName, actorUserId } = params;
    const title = patch.title ?? before.title;
    const ref = formatIssueRef(issueId, title);
    const afterAssignee =
      patch.assignee_id !== undefined ? patch.assignee_id : before.assignee_id;
    const afterStatus = patch.status !== undefined ? patch.status : before.status;
    const afterDue = patch.due_date !== undefined ? patch.due_date : before.due_date;

    if (patch.assignee_id !== undefined && patch.assignee_id !== before.assignee_id && patch.assignee_id) {
      const md = [
        `## 问题已重新指派给你`,
        "",
        `- ${ref}`,
        "",
        `由 **${actorName}** 更新指派。`,
      ].join("\n");
      await workNoticeToUser(
        patch.assignee_id,
        `指派变更：${title.slice(0, 18)}${title.length > 18 ? "…" : ""}`,
        md,
        `update_issue assignee issue=${issueId} user=${patch.assignee_id}`
      );
      const name = await getUserName(patch.assignee_id);
      await webhook(
        "问题跟踪 · 指派变更",
        [`### 指派变更`, `- ${ref}`, `- 新负责人：**${name}**`, `- 操作：**${actorName}**`].join("\n")
      );
    }

    if (
      patch.status !== undefined &&
      patch.status === "blocked" &&
      before.status !== "blocked" &&
      afterAssignee
    ) {
      const md = [
        `## 问题已标记为阻塞`,
        "",
        `- ${ref}`,
        "",
        `由 **${actorName}** 更新状态。`,
      ].join("\n");
      await workNoticeToUser(
        afterAssignee,
        `阻塞：${title.slice(0, 20)}${title.length > 20 ? "…" : ""}`,
        md,
        `update_issue blocked issue=${issueId} assignee=${afterAssignee}`
      );
      await webhook(
        "问题跟踪 · 阻塞",
        [`### 状态：阻塞`, `- ${ref}`, `- 操作：**${actorName}**`].join("\n")
      );
    }

    if (
      patch.due_date !== undefined &&
      patch.due_date !== before.due_date &&
      afterAssignee &&
      afterDue
    ) {
      const md = [
        `## 截止日期已更新`,
        "",
        `- ${ref}`,
        `- 新截止日：**${afterDue}**`,
        "",
        `由 **${actorName}** 更新。`,
      ].join("\n");
      await workNoticeToUser(
        afterAssignee,
        `截止日更新：${title.slice(0, 16)}${title.length > 16 ? "…" : ""}`,
        md,
        `update_issue due_date issue=${issueId} assignee=${afterAssignee}`
      );
      await webhook(
        "问题跟踪 · 截止日期",
        [`### 截止日期变更`, `- ${ref}`, `- 新截止日：**${afterDue}**`, `- 操作：**${actorName}**`].join("\n")
      );
    }

    if (
      patch.status !== undefined &&
      (patch.status === "resolved" || patch.status === "closed") &&
      !isTerminalStatus(before.status)
    ) {
      dingtalkAfterIssueResolvedOrClosed({
        issueId,
        title,
        status: patch.status,
        creatorId: before.creator_id,
        assigneeId: afterAssignee,
        actorName,
        actorUserId,
      });
    }
  })().catch((e) => console.error("[dingtalk-event] update", e));
}

/** 进度记录里把状态改为阻塞 */
export function dingtalkAfterIssueUpdateToBlocked(params: {
  issueId: string;
  title: string;
  assigneeId: string | null;
  actorName: string;
}): void {
  void (async () => {
    if (!params.assigneeId) return;
    if (!isDingtalkAppConfigured() && !isDingtalkWebhookConfigured()) return;

    const ref = formatIssueRef(params.issueId, params.title);
    const md = [
      `## 问题已通过进度更新标为阻塞`,
      "",
      `- ${ref}`,
      "",
      `由 **${params.actorName}** 在进度中更新状态。`,
    ].join("\n");

    await workNoticeToUser(
      params.assigneeId,
      `阻塞：${params.title.slice(0, 20)}${params.title.length > 20 ? "…" : ""}`,
      md,
      `issue_update blocked issue=${params.issueId} assignee=${params.assigneeId}`
    );

    await webhook(
      "问题跟踪 · 阻塞（进度）",
      [`### 状态：阻塞（进度更新）`, `- ${ref}`, `- 操作：**${params.actorName}**`].join("\n")
    );
  })().catch((e) => console.error("[dingtalk-event] issue_update blocked", e));
}
