/**
 * 工单进度更新触发的企业微信通知（P1 升级版 / P3 裁剪版）
 *
 * P3 后此文件只保留两个函数：
 *   - dingtalkAfterProgressUpdate：进度更新内容通知→管理员
 *   - dingtalkAfterIssueUpdateToBlocked：进度更新中标为阻塞→负责人
 *
 * 以下函数已迁移到 src/lib/event-notification.ts（事件驱动通知派发器）：
 *   - dingtalkAfterCreateIssue       → dispatchEventNotifications { issue_created }
 *   - dingtalkAfterUpdateIssue       → dispatchEventNotifications { status_changed / assignee_changed / ... }
 *   - dingtalkAfterIssueResolvedOrClosed → dispatchEventNotifications { status_changed (resolved|closed) }
 */

import { createClient } from "@/lib/supabase/server";
import { isWecomAppConfigured, isWecomWebhookConfigured } from "@/lib/wecom";
import { sendNotification } from "@/lib/notification-service";
import { getIssueDetailUrl } from "@/lib/app-url";
import type { IssueStatus } from "@/types";

function formatIssueRef(issueId: string, title: string): string {
  const url = getIssueDetailUrl(issueId);
  if (url) return `[${title}](${url})`;
  return `**${title}**（路径 \`/issues/${issueId}\`，请配置 NEXT_PUBLIC_APP_URL 以生成可点击链接）`;
}

async function getWecomUserid(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("wecom_userid").eq("id", userId).maybeSingle();
  const v = (data?.wecom_userid as string | null | undefined)?.trim();
  return v || null;
}

async function getAdminUserIds(): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("users").select("id").eq("role", "admin");
  return (data ?? []).map((u) => u.id as string);
}

async function workNoticeToUser(
  userId: string,
  title: string,
  markdown: string,
  issueId?: string
) {
  if (!isWecomAppConfigured()) return;
  const wc = await getWecomUserid(userId);
  if (!wc) return;
  await sendNotification({
    channel:             "wecom_app",
    targetWecomUserid:   wc,
    targetUserId:        userId,
    issueId:             issueId ?? null,
    triggerSource:       "issue_event",
    title,
    content:             markdown,
  });
}

async function webhook(content: string, issueId?: string) {
  if (!isWecomWebhookConfigured()) return;
  await sendNotification({
    channel:       "wecom_bot",
    issueId:       issueId ?? null,
    triggerSource: "issue_event",
    content,
  });
}

// ─── 对外函数 ─────────────────────────────────────────────────────────────────

/** 有人提交了进度更新：实时通知所有管理员（操作者本人除外） */
export function dingtalkAfterProgressUpdate(params: {
  issueId: string;
  issueTitle: string;
  content: string;
  statusFrom: IssueStatus;
  statusTo: IssueStatus;
  actorName: string;
  actorUserId: string;
}): void {
  void (async () => {
    if (!isWecomAppConfigured()) return;

    const admins = await getAdminUserIds();
    const recipients = admins.filter((id) => id !== params.actorUserId);
    if (recipients.length === 0) return;

    const ref = formatIssueRef(params.issueId, params.issueTitle);
    const statusChanged = params.statusFrom !== params.statusTo;
    const LABELS: Record<string, string> = {
      todo: "待处理", in_progress: "处理中", blocked: "卡住",
      pending_review: "待验证", resolved: "已解决", closed: "已关闭",
    };

    const lines = [
      `## 进度更新`,
      "",
      `- 问题：${ref}`,
      `- 更新人：**${params.actorName}**`,
    ];
    if (statusChanged) {
      lines.push(`- 状态：${LABELS[params.statusFrom] ?? params.statusFrom} → **${LABELS[params.statusTo] ?? params.statusTo}**`);
    }
    lines.push("", `> ${params.content.length > 200 ? params.content.slice(0, 200) + "…" : params.content}`);
    lines.push("", "请及时帮忙推进相关问题，必要时可协调资源支持。");

    const md = lines.join("\n");
    const shortTitle = `进度更新 · ${params.issueTitle.slice(0, 16)}${params.issueTitle.length > 16 ? "…" : ""}`;

    for (const uid of recipients) {
      await workNoticeToUser(uid, shortTitle, md, params.issueId);
    }
  })().catch((e) => console.error("[wecom-event] progress_update", e));
}

/** 进度记录里把状态改为阻塞：通知负责人（P3 事件通知的补充，确保阻塞消息携带进度上下文） */
export function dingtalkAfterIssueUpdateToBlocked(params: {
  issueId: string;
  title: string;
  assigneeId: string | null;
  actorName: string;
}): void {
  void (async () => {
    if (!params.assigneeId) return;
    if (!isWecomAppConfigured() && !isWecomWebhookConfigured()) return;

    const ref = formatIssueRef(params.issueId, params.title);
    const md = [
      `## 问题已通过进度更新标为阻塞`,
      "",
      `- ${ref}`,
      "",
      `由 **${params.actorName}** 在进度中更新状态。`,
      `请及时帮忙处理问题，并补充阻塞原因与需要支持的点。`,
    ].join("\n");

    await workNoticeToUser(
      params.assigneeId,
      `阻塞：${params.title.slice(0, 20)}${params.title.length > 20 ? "…" : ""}`,
      md,
      params.issueId
    );

    await webhook(
      [`### 米伽米 · 阻塞（进度）`, `- ${ref}`, `- 操作：**${params.actorName}**`].join("\n"),
      params.issueId
    );
  })().catch((e) => console.error("[wecom-event] issue_update blocked", e));
}
