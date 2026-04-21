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
import { getChinaWeekday } from "@/lib/dates";
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

  const total = nu.length + od.length + st.length;
  const lines: string[] = [
    `待你推进（${todayStr}）共 ${total} 条`,
    "",
  ];
  if (od.length > 0) {
    lines.push(`⏰ 已过截止（${od.length}）`);
    od.forEach((i) => lines.push(`· ${i.title}（截止 ${i.dueDate}）`));
    lines.push("");
  }
  if (st.length > 0) {
    lines.push(`📌 3天未更新（${st.length}）`);
    st.forEach((i) => lines.push(`· ${i.title}`));
    lines.push("");
  }
  if (nu.length > 0) {
    lines.push(`📝 今日待同步（${nu.length}）`);
    nu.forEach((i) => lines.push(`· ${i.title}`));
    lines.push("");
  }
  lines.push("方便时补一条进展，遇到阻塞写下卡点，团队帮你推 💪");
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
      if (["in_progress", "blocked", "pending_review", "pending_rework"].includes(issue.status)) {
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
                message:  `今日（${todayStr}）还没有进展更新，方便时补一条`,
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
                message:  `已过截止日期（${issue.due_date}），补一条进展或调整日期都行`,
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
      if (["in_progress", "blocked", "pending_review", "pending_rework"].includes(issue.status)) {
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
                message:  `已有 3 天没有新进展了，方便时补一条当前情况`,
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

    const chinaDow = getChinaWeekday();
    const skipWecomPush =
      chinaDow === 6
        ? "周六不打扰：不发送待推进群消息与个人工作通知"
        : chinaDow === 0
          ? "周日企微改由晚间「下周待继续」群汇总统一发送，本时段不推送"
          : null;

    if (!skipWecomPush && total > 0 && isWecomWebhookConfigured()) {
      const lines: string[] = [`待推进事项（${todayStr}）共 ${total} 条\n`];
      if (overdueItems.length > 0) {
        lines.push(`⏰ 已过截止（${overdueItems.length}）`);
        overdueItems.forEach((i) => lines.push(`· ${i.title} → ${i.assignee}`));
        lines.push("");
      }
      if (staleItems.length > 0) {
        lines.push(`📌 3天未更新（${staleItems.length}）`);
        staleItems.forEach((i) => lines.push(`· ${i.title} → ${i.assignee}`));
        lines.push("");
      }
      if (noUpdateItems.length > 0) {
        lines.push(`📝 今日待同步（${noUpdateItems.length}）`);
        noUpdateItems.forEach((i) => lines.push(`· ${i.title} → ${i.assignee}`));
        lines.push("");
      }
      const result = await sendGroupDigest({ content: lines.join("\n"), triggerSource: "cron_daily" });
      webhookSent = result.success;
    }

    if (!skipWecomPush && total > 0 && isWecomAppConfigured()) {
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
          title:             `待你推进 · ${todayStr}`,
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
      wecom_push_skipped: skipWecomPush ? true : undefined,
      wecom_push_skip_reason: skipWecomPush ?? undefined,
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
