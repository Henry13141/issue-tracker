/**
 * daily-reminder Cron（P1 升级版）
 *
 * 职责分离：
 * 1. 写 reminders 记录（hasReminderToday 幂等保护）
 * 2. 发通知（通过 notification-service，留下 notification_deliveries 日志）
 * 两步完全独立，写 reminder 失败不影响不通知，反之亦然。
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds, chinaDateMinusDays } from "@/lib/reminder-logic";
import {
  isWecomAppConfigured,
  isWecomWebhookConfigured,
} from "@/lib/wecom";
import { writeIssueEvent } from "@/lib/issue-events";
import {
  sendGroupDigest,
  sendReminderNotification,
} from "@/lib/notification-service";
import type { IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

type IssueRow = {
  id: string;
  title: string;
  status: IssueStatus;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
  /**
   * P0 中由触发器维护（仅人工 issue_updates 触发），与 dashboard stale 定义一致。
   * cron stale 检测统一用此字段，避免与 dashboard 口径漂移。
   */
  last_activity_at: string | null;
};

type ItemNoUpdate = { title: string; assignee: string; assigneeId: string; reminderId: string | null };
type ItemOverdue  = { title: string; assignee: string; assigneeId: string; dueDate: string; reminderId: string | null; issueId: string };
type ItemStale    = { title: string; assignee: string; assigneeId: string; reminderId: string | null; issueId: string };

function buildPersonalMarkdown(
  assigneeId: string,
  todayStr: string,
  noUpdateItems: ItemNoUpdate[],
  overdueItems: ItemOverdue[],
  staleItems: ItemStale[]
): string | null {
  const nu = noUpdateItems.filter((i) => i.assigneeId === assigneeId);
  const od = overdueItems.filter((i) => i.assigneeId === assigneeId);
  const st = staleItems.filter((i) => i.assigneeId === assigneeId);
  if (nu.length === 0 && od.length === 0 && st.length === 0) return null;

  const lines: string[] = [
    `## 今日催办（${todayStr}）`,
    "",
    "给你同步一下今天需要你及时帮忙处理的问题：",
    "",
  ];
  if (nu.length > 0) {
    lines.push(`### 今日还没有进展更新（${nu.length}个）`);
    nu.forEach((i) => lines.push(`- ${i.title}`));
    lines.push("");
  }
  if (od.length > 0) {
    lines.push(`### 已超期未关闭（${od.length}个）`);
    od.forEach((i) => lines.push(`- ${i.title}（截止日期：${i.dueDate}，建议今天补一下进展或调整截止日期）`));
    lines.push("");
  }
  if (st.length > 0) {
    lines.push(`### 连续 3 天无进度更新（${st.length}个）`);
    st.forEach((i) => lines.push(`- ${i.title}（连续 3 天没有新进展，方便的话补一条当前情况）`));
    lines.push("");
  }
  lines.push("如果当前有阻塞，直接在问题里写下卡点，团队会更快协助你推进。");
  return lines.join("\n");
}

async function hasReminderToday(
  supabase: ReturnType<typeof createAdminClient>,
  issueId: string,
  userId: string,
  type: string,
  startIso: string,
  endIso: string
) {
  const { data } = await supabase
    .from("reminders")
    .select("id")
    .eq("issue_id", issueId)
    .eq("user_id", userId)
    .eq("type", type)
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .maybeSingle();
  return !!data;
}

export async function GET(request: Request) {
  const secret     = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (secret) {
    const header = request.headers.get("authorization");
    if (!vercelCron && header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }

  try {
    const supabase   = createAdminClient();
    const { startIso, endIso, dateStr: todayStr } = getChinaDayBounds();
    const windowStartStr = `${chinaDateMinusDays(todayStr, 2)}T00:00:00+08:00`;
    const windowStart    = new Date(windowStartStr).toISOString();

    const { data: issues, error } = await supabase
      .from("issues")
      .select("id, title, status, assignee_id, due_date, created_at, last_activity_at");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: allUsers } = await supabase.from("users").select("id, name, wecom_userid");
    const userNameMap = new Map((allUsers ?? []).map((u) => [u.id as string, u.name as string]));
    const wecomIdMap  = new Map(
      (allUsers ?? []).map((u) => [
        u.id as string,
        ((u as { wecom_userid?: string | null }).wecom_userid ?? null) as string | null,
      ])
    );

    const list = (issues ?? []) as IssueRow[];

    // ─── 步骤一：写 reminders（幂等）────────────────────────────────────
    let insertedNoUpdate = 0;
    let insertedOverdue  = 0;
    let insertedStale    = 0;

    const noUpdateItems: ItemNoUpdate[] = [];
    const overdueItems:  ItemOverdue[]  = [];
    const staleItems:    ItemStale[]    = [];

    for (const issue of list) {
      const assignee = issue.assignee_id;
      if (!assignee) continue;

      // no_update_today：只统计人工更新（is_system_generated=false），与 dashboard 定义一致
      if (["in_progress", "blocked", "pending_review"].includes(issue.status)) {
        const { data: updatesToday } = await supabase
          .from("issue_updates")
          .select("id")
          .eq("issue_id", issue.id)
          .eq("is_system_generated", false)
          .gte("created_at", startIso)
          .lte("created_at", endIso);

        if ((updatesToday?.length ?? 0) === 0) {
          const dup = await hasReminderToday(supabase, issue.id, assignee, "no_update_today", startIso, endIso);
          if (!dup) {
            const { data: newReminder, error: remErr } = await supabase
              .from("reminders")
              .insert({
                issue_id: issue.id,
                user_id:  assignee,
                type:     "no_update_today",
                message:  `今日（${todayStr}）尚未提交任何进度更新`,
                is_read:  false,
              })
              .select("id")
              .single();

            if (remErr) {
              console.error("[cron] reminders insert failed (no_update_today):", remErr.message, issue.id);
            } else {
              insertedNoUpdate++;
              const rid = (newReminder as { id: string } | null)?.id ?? null;
              noUpdateItems.push({ title: issue.title, assignee: userNameMap.get(assignee) ?? "未知", assigneeId: assignee, reminderId: rid });
              await writeIssueEvent(supabase, {
                issueId: issue.id, actorId: null, eventType: "reminder_created",
                payload: { type: "no_update_today", reminder_id: rid, date: todayStr },
              });
            }
          }
        }
      }

      // overdue
      if (issue.due_date && issue.due_date < todayStr && issue.status !== "resolved" && issue.status !== "closed") {
        const dup = await hasReminderToday(supabase, issue.id, assignee, "overdue", startIso, endIso);
        if (!dup) {
          const { data: newReminder, error: remErr } = await supabase
            .from("reminders")
            .insert({
              issue_id: issue.id,
              user_id:  assignee,
              type:     "overdue",
              message:  `问题已超期（截止日期：${issue.due_date}），请尽快处理或更新截止日期`,
              is_read:  false,
            })
            .select("id")
            .single();

          if (remErr) {
            console.error("[cron] reminders insert failed (overdue):", remErr.message, issue.id);
          } else {
            insertedOverdue++;
            const rid = (newReminder as { id: string } | null)?.id ?? null;
            overdueItems.push({ title: issue.title, assignee: userNameMap.get(assignee) ?? "未知", assigneeId: assignee, dueDate: issue.due_date!, reminderId: rid, issueId: issue.id });
            await writeIssueEvent(supabase, {
              issueId: issue.id, actorId: null, eventType: "reminder_created",
              payload: { type: "overdue", reminder_id: rid, due_date: issue.due_date, date: todayStr },
            });
          }
        }
      }

      // stale_3_days：使用 last_activity_at（P0 触发器维护，只含人工活动），
      // 与 dashboard 和 issues 页的 stale 定义保持口径一致，同时消除了逐条查询 issue_updates 的 N+1 问题。
      if (["in_progress", "blocked", "pending_review"].includes(issue.status)) {
        const lastTs = issue.last_activity_at ?? issue.created_at;
        if (new Date(lastTs).getTime() < new Date(windowStart).getTime()) {
          const dup = await hasReminderToday(supabase, issue.id, assignee, "stale_3_days", startIso, endIso);
          if (!dup) {
            const { data: newReminder, error: remErr } = await supabase
              .from("reminders")
              .insert({
                issue_id: issue.id,
                user_id:  assignee,
                type:     "stale_3_days",
                message:  `已连续超过 3 个自然日（上海时间）无人工进度更新，请关注`,
                is_read:  false,
              })
              .select("id")
              .single();

            if (remErr) {
              console.error("[cron] reminders insert failed (stale_3_days):", remErr.message, issue.id);
            } else {
              insertedStale++;
              const rid = (newReminder as { id: string } | null)?.id ?? null;
              staleItems.push({ title: issue.title, assignee: userNameMap.get(assignee) ?? "未知", assigneeId: assignee, reminderId: rid, issueId: issue.id });
              await writeIssueEvent(supabase, {
                issueId: issue.id, actorId: null, eventType: "reminder_created",
                payload: { type: "stale_3_days", reminder_id: rid, stale_since: lastTs, date: todayStr },
              });
            }
          }
        }
      }
    }

    // ─── 步骤二：发通知（独立于 reminder 写入）──────────────────────────
    const total = insertedNoUpdate + insertedOverdue + insertedStale;
    let webhookSent   = false;
    let workNoticeSent = 0;
    const workNoticeErrors: string[] = [];

    if (total > 0 && isWecomWebhookConfigured()) {
      const lines: string[] = [`## 每日催办提醒（${todayStr}）\n`];
      if (noUpdateItems.length > 0) {
        lines.push(`### 今日未更新（${noUpdateItems.length}个）`);
        noUpdateItems.forEach((i) => lines.push(`- ${i.title} → **${i.assignee}**`));
        lines.push("");
      }
      if (overdueItems.length > 0) {
        lines.push(`### 超期未关闭（${overdueItems.length}个）`);
        overdueItems.forEach((i) => lines.push(`- ${i.title}（截止 ${i.dueDate}）→ **${i.assignee}**`));
        lines.push("");
      }
      if (staleItems.length > 0) {
        lines.push(`### 连续3天未更新（${staleItems.length}个）`);
        staleItems.forEach((i) => lines.push(`- ${i.title} → **${i.assignee}**`));
        lines.push("");
      }
      const result = await sendGroupDigest({ content: lines.join("\n"), triggerSource: "cron_daily" });
      webhookSent = result.success;
    }

    if (total > 0 && isWecomAppConfigured()) {
      const assigneeIds = new Set<string>();
      for (const i of [...noUpdateItems, ...overdueItems, ...staleItems]) assigneeIds.add(i.assigneeId);

      for (const uid of assigneeIds) {
        const wcUserid = wecomIdMap.get(uid);
        if (!wcUserid) continue;
        const md = buildPersonalMarkdown(uid, todayStr, noUpdateItems, overdueItems, staleItems);
        if (!md) continue;

        const result = await sendReminderNotification({
          targetWecomUserid: wcUserid,
          targetUserId:      uid,
          title:             `每日催办 · ${todayStr}`,
          content:           md,
          triggerSource:     "cron_daily",
        });

        if (result.success) {
          workNoticeSent++;
        } else {
          workNoticeErrors.push(`${uid}: ${result.errorMessage ?? result.errorCode}`);
          console.error("[cron] 企业微信工作通知失败:", uid, result.errorCode);
        }
      }
    }

    return NextResponse.json({
      ok:    true,
      today: todayStr,
      inserted: { no_update_today: insertedNoUpdate, overdue: insertedOverdue, stale_3_days: insertedStale },
      wecom_webhook_sent: webhookSent,
      wecom_work_notice: {
        sent:   workNoticeSent,
        errors: workNoticeErrors.length ? workNoticeErrors : undefined,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cron failed" }, { status: 500 });
  }
}
