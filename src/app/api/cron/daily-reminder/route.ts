import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds, chinaDateMinusDays } from "@/lib/reminder-logic";
import type { IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

type IssueRow = {
  id: string;
  status: IssueStatus;
  assignee_id: string | null;
  due_date: string | null;
  created_at: string;
};

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

    const list = (issues ?? []) as IssueRow[];
    let insertedNoUpdate = 0;
    let insertedOverdue = 0;
    let insertedStale = 0;

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
          }
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
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Cron failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
