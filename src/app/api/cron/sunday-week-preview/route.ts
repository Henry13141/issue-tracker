/**
 * 周日晚间：向群内发一条「下周待继续办理」汇总（仅群机器人，不打扰个人）。
 * Cron：周日 13:00 UTC = 上海 21:00。
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { getChinaDayBounds } from "@/lib/reminder-logic";
import { getChinaWeekday } from "@/lib/dates";
import { isWecomWebhookConfigured } from "@/lib/wecom";
import { sendGroupDigest } from "@/lib/notification-service";
import { INCOMPLETE_ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/constants";
import type { IssueStatus } from "@/types";

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }

  if (!isWecomWebhookConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "WECOM_WEBHOOK_URL 未配置",
    });
  }

  if (getChinaWeekday() !== 0) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "仅在上海时区周日执行群汇总",
    });
  }

  try {
    const supabase = createAdminClient();
    const { dateStr: todayStr } = getChinaDayBounds();
    const dateLabel = `${todayStr.slice(0, 4)}年${Number(todayStr.slice(5, 7))}月${Number(todayStr.slice(8, 10))}日`;

    const { data: issues, error: issuesErr } = await supabase
      .from("issues")
      .select("id, title, status, assignee_id")
      .in("status", INCOMPLETE_ISSUE_STATUSES)
      .not("assignee_id", "is", null);

    if (issuesErr) return NextResponse.json({ error: issuesErr.message }, { status: 500 });

    const { data: allUsers } = await supabase.from("users").select("id, name");
    const nameMap = new Map((allUsers ?? []).map((u) => [u.id as string, (u.name as string) ?? "同事"]));

    type Row = { id: string; title: string; status: IssueStatus; assignee_id: string };
    const byAssignee = new Map<string, Row[]>();
    for (const row of (issues ?? []) as Row[]) {
      const aid = row.assignee_id;
      if (!aid) continue;
      const list = byAssignee.get(aid) ?? [];
      list.push(row);
      byAssignee.set(aid, list);
    }

    if (byAssignee.size === 0) {
      return NextResponse.json({
        ok: true,
        date: todayStr,
        message: "没有未完成且已指派的问题，未发送群消息",
        wecom_group_sent: false,
      });
    }

    let totalItems = 0;
    for (const rows of byAssignee.values()) totalItems += rows.length;

    const groupLines: string[] = [
      `下周待继续办理 · ${dateLabel}（共 ${totalItems} 条）`,
      "",
      "新的一周继续推进，有阻塞可在系统里说明。",
      "",
    ];

    for (const [assigneeUserId, rows] of byAssignee) {
      const name = nameMap.get(assigneeUserId) ?? "同事";
      const items = rows.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
      groupLines.push(`${name}（${items.length}）`);
      for (const r of items) {
        const st = ISSUE_STATUS_LABELS[r.status as IssueStatus] ?? r.status;
        groupLines.push(`· ${r.title}（${st}）`);
      }
      groupLines.push("");
    }

    const result = await sendGroupDigest({
      content:       groupLines.join("\n"),
      triggerSource: "cron_week_preview",
    });

    return NextResponse.json({
      ok: true,
      date: todayStr,
      assignees_with_incomplete_issues: byAssignee.size,
      total_items: totalItems,
      wecom_group_sent: result.success,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cron failed" }, { status: 500 });
  }
}
