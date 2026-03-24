import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds, chinaDateMinusDays } from "@/lib/reminder-logic";
import {
  sendDingtalkMarkdown,
  sendDingtalkWorkNotice,
  logDingTalkWorkNoticeDelivery,
  dingtalkDeliveryPollDelayMs,
  isDingtalkAppConfigured,
  isDingtalkWebhookConfigured,
} from "@/lib/dingtalk";
import type { IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

type IssueRow = {
  id: string;
  status: IssueStatus;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
};

type ItemNoUpdate = { title: string; assignee: string; assigneeId: string };
type ItemOverdue = { title: string; assignee: string; assigneeId: string; dueDate: string };
type ItemStale = { title: string; assignee: string; assigneeId: string };

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
    "以下是你负责的问题，请及时处理：",
    "",
  ];
  if (nu.length > 0) {
    lines.push(`### 今日未更新进度（${nu.length}）`);
    nu.forEach((i) => lines.push(`- ${i.title}`));
    lines.push("");
  }
  if (od.length > 0) {
    lines.push(`### 超期未关闭（${od.length}）`);
    od.forEach((i) => lines.push(`- ${i.title}（截止 ${i.dueDate}）`));
    lines.push("");
  }
  if (st.length > 0) {
    lines.push(`### 连续 3 天无进度更新（${st.length}）`);
    st.forEach((i) => lines.push(`- ${i.title}`));
    lines.push("");
  }
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
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (secret) {
    const header = request.headers.get("authorization");
    const ok = vercelCron || header === `Bearer ${secret}`;
    if (!ok) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
        { status: 503 }
      );
    }
    const supabase = createAdminClient();
    const { startIso, endIso, dateStr: todayStr } = getChinaDayBounds();
    const windowStartStr = `${chinaDateMinusDays(todayStr, 2)}T00:00:00+08:00`;
    const windowStart = new Date(windowStartStr).toISOString();

    const { data: issues, error } = await supabase
      .from("issues")
      .select("id, status, assignee_id, due_date, created_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: allUsers } = await supabase.from("users").select("id, name, dingtalk_userid");
    const userNameMap = new Map((allUsers ?? []).map((u) => [u.id as string, u.name as string]));
    const dingtalkIdMap = new Map(
      (allUsers ?? []).map((u) => [
        u.id as string,
        ((u as { dingtalk_userid?: string | null }).dingtalk_userid ?? null) as string | null,
      ])
    );

    const list = (issues ?? []) as IssueRow[];
    let insertedNoUpdate = 0;
    let insertedOverdue = 0;
    let insertedStale = 0;

    const noUpdateItems: ItemNoUpdate[] = [];
    const overdueItems: ItemOverdue[] = [];
    const staleItems: ItemStale[] = [];

    const { data: allIssueRows } = await supabase.from("issues").select("id, title");
    const issueTitleMap = new Map((allIssueRows ?? []).map((i) => [i.id as string, i.title as string]));

    for (const issue of list) {
      const assignee = issue.assignee_id;
      if (!assignee) continue;

      const { data: updatesToday } = await supabase
        .from("issue_updates")
        .select("id")
        .eq("issue_id", issue.id)
        .gte("created_at", startIso)
        .lte("created_at", endIso);

      const hasTodayUpdate = (updatesToday?.length ?? 0) > 0;

      if (
        ["in_progress", "blocked", "pending_review"].includes(issue.status) &&
        !hasTodayUpdate
      ) {
        const dup = await hasReminderToday(
          supabase,
          issue.id,
          assignee,
          "no_update_today",
          startIso,
          endIso
        );
        if (!dup) {
          await supabase.from("reminders").insert({
            issue_id: issue.id,
            user_id: assignee,
            type: "no_update_today",
            message: "今日尚未提交进度更新",
            is_read: false,
          });
          insertedNoUpdate++;
          noUpdateItems.push({
            title: issueTitleMap.get(issue.id) ?? issue.id,
            assignee: userNameMap.get(assignee) ?? "未知",
            assigneeId: assignee,
          });
        }
      }

      if (
        issue.due_date &&
        issue.due_date < todayStr &&
        issue.status !== "resolved" &&
        issue.status !== "closed"
      ) {
        const dup = await hasReminderToday(
          supabase,
          issue.id,
          assignee,
          "overdue",
          startIso,
          endIso
        );
        if (!dup) {
          await supabase.from("reminders").insert({
            issue_id: issue.id,
            user_id: assignee,
            type: "overdue",
            message: `问题已超期（截止 ${issue.due_date}）`,
            is_read: false,
          });
          insertedOverdue++;
          overdueItems.push({
            title: issueTitleMap.get(issue.id) ?? issue.id,
            assignee: userNameMap.get(assignee) ?? "未知",
            assigneeId: assignee,
            dueDate: issue.due_date!,
          });
        }
      }

      const { data: lastUp } = await supabase
        .from("issue_updates")
        .select("created_at")
        .eq("issue_id", issue.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastTs = lastUp?.created_at ?? issue.created_at;
      if (new Date(lastTs).getTime() < new Date(windowStart).getTime()) {
        if (["in_progress", "blocked", "pending_review"].includes(issue.status)) {
          const dup = await hasReminderToday(
            supabase,
            issue.id,
            assignee,
            "stale_3_days",
            startIso,
            endIso
          );
          if (!dup) {
            await supabase.from("reminders").insert({
              issue_id: issue.id,
              user_id: assignee,
              type: "stale_3_days",
              message: "连续 3 天无进度更新（按上海日历日）",
              is_read: false,
            });
            insertedStale++;
            staleItems.push({
              title: issueTitleMap.get(issue.id) ?? issue.id,
              assignee: userNameMap.get(assignee) ?? "未知",
              assigneeId: assignee,
            });
          }
        }
      }
    }

    const total = insertedNoUpdate + insertedOverdue + insertedStale;
    let dingtalkWebhookSent = false;
    let workNoticeSent = 0;
    const workNoticeErrors: string[] = [];
    const workNoticeTasks: { task_id: number; context: string }[] = [];

    if (total > 0) {
      if (isDingtalkWebhookConfigured()) {
        const lines: string[] = [`## 📋 每日催办提醒（${todayStr}）\n`];
        if (noUpdateItems.length > 0) {
          lines.push(`### 今日未更新（${noUpdateItems.length}个）`);
          noUpdateItems.forEach((i) => lines.push(`- ${i.title} → **${i.assignee}**`));
          lines.push("");
        }
        if (overdueItems.length > 0) {
          lines.push(`### 超期未关闭（${overdueItems.length}个）`);
          overdueItems.forEach((i) =>
            lines.push(`- ${i.title}（截止 ${i.dueDate}）→ **${i.assignee}**`)
          );
          lines.push("");
        }
        if (staleItems.length > 0) {
          lines.push(`### 连续3天未更新（${staleItems.length}个）`);
          staleItems.forEach((i) => lines.push(`- ${i.title} → **${i.assignee}**`));
          lines.push("");
        }
        await sendDingtalkMarkdown("每日催办提醒", lines.join("\n"));
        dingtalkWebhookSent = true;
      }

      if (isDingtalkAppConfigured()) {
        const assigneeIds = new Set<string>();
        for (const i of noUpdateItems) assigneeIds.add(i.assigneeId);
        for (const i of overdueItems) assigneeIds.add(i.assigneeId);
        for (const i of staleItems) assigneeIds.add(i.assigneeId);

        for (const uid of assigneeIds) {
          const dtUserid = dingtalkIdMap.get(uid);
          if (!dtUserid) continue;
          const md = buildPersonalMarkdown(uid, todayStr, noUpdateItems, overdueItems, staleItems);
          if (!md) continue;
          try {
            const { task_id } = await sendDingtalkWorkNotice(dtUserid, `每日催办 · ${todayStr}`, md);
            workNoticeTasks.push({
              task_id,
              context: `daily_reminder date=${todayStr} assignee_user=${uid}`,
            });
            workNoticeSent++;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            workNoticeErrors.push(`${uid}: ${msg}`);
            console.error("[cron] DingTalk work notice failed:", uid, msg);
          }
        }

        if (workNoticeTasks.length > 0) {
          await new Promise((r) => setTimeout(r, dingtalkDeliveryPollDelayMs()));
          await Promise.all(
            workNoticeTasks.map((t) => logDingTalkWorkNoticeDelivery(t.task_id, t.context))
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      today: todayStr,
      inserted: {
        no_update_today: insertedNoUpdate,
        overdue: insertedOverdue,
        stale_3_days: insertedStale,
      },
      dingtalk_webhook_sent: dingtalkWebhookSent,
      dingtalk_work_notice: {
        sent: workNoticeSent,
        errors: workNoticeErrors.length ? workNoticeErrors : undefined,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Cron failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
