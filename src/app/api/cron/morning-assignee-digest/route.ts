import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds } from "@/lib/reminder-logic";
import {
  sendDingtalkWorkNotice,
  logDingTalkWorkNoticeDelivery,
  dingtalkDeliveryPollDelayMs,
  isDingtalkAppConfigured,
} from "@/lib/dingtalk";
import { getPublicAppUrl } from "@/lib/app-url";
import { INCOMPLETE_ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/constants";
import type { IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!secret) return true;
  return vercelCron || request.headers.get("authorization") === `Bearer ${secret}`;
}

function buildGentleMorningMarkdown(
  assigneeName: string,
  dateLabel: string,
  items: { title: string; status: IssueStatus }[],
  listUrl: string
): string {
  const n = items.length;
  const lines: string[] = [
    `## 早安 · ${dateLabel}`,
    "",
    `**${assigneeName}**，早上好～`,
    "",
    "我是米伽米工单小助手，语气可能有点像您的日程助理，请多包涵。",
    "",
    n === 1
      ? `目前您名下还有 **1** 条未完成工单。方便时登录系统更新一下进度或状态就好，不着急～`
      : `目前您名下还有 **${n}** 条未完成工单。方便时登录系统随手更新一下进度或状态就好，不着急～`,
    "",
    "### 未完成清单",
    "",
  ];

  for (const it of items) {
    const st = ISSUE_STATUS_LABELS[it.status] ?? it.status;
    lines.push(`- **${it.title}**（${st}）`);
  }

  lines.push("");
  if (listUrl) {
    lines.push(`[打开问题列表 →](${listUrl}/issues)`);
    lines.push("");
  }
  lines.push("若已处理完毕，把对应工单标成「已解决」或「已关闭」即可，我会少打扰您。");
  lines.push("");
  lines.push("祝今天顺利。");

  return lines.join("\n");
}

/**
 * 每个工作日早晨：向所有「名下有未完成工单」且配置了钉钉 userid 的负责人
 * 发一条语气温和的工作通知（钉钉工作通知，非普通单聊）。
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }

  if (!isDingtalkAppConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "钉钉企业应用未配置（DINGTALK_APP_KEY / DINGTALK_APP_SECRET / DINGTALK_AGENT_ID）",
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

    if (issuesErr) {
      return NextResponse.json({ error: issuesErr.message }, { status: 500 });
    }

    const { data: allUsers } = await supabase.from("users").select("id, name, dingtalk_userid");
    const nameMap = new Map((allUsers ?? []).map((u) => [u.id as string, (u.name as string) ?? "同事"]));
    const dingMap = new Map(
      (allUsers ?? []).map((u) => [
        u.id as string,
        ((u as { dingtalk_userid?: string | null }).dingtalk_userid ?? "").trim(),
      ])
    );

    type Row = { id: string; title: string; status: IssueStatus; assignee_id: string };
    const byAssignee = new Map<string, Row[]>();
    for (const row of (issues ?? []) as Row[]) {
      const aid = row.assignee_id;
      if (!aid) continue;
      const list = byAssignee.get(aid) ?? [];
      list.push(row);
      byAssignee.set(aid, list);
    }

    const base = getPublicAppUrl();
    const listUrl = base || "";

    let sent = 0;
    let skippedNoDingtalk = 0;
    const errors: string[] = [];
    const tasks: { task_id: number; context: string }[] = [];

    for (const [assigneeUserId, rows] of byAssignee) {
      const dt = dingMap.get(assigneeUserId);
      if (!dt) {
        skippedNoDingtalk++;
        continue;
      }

      const name = nameMap.get(assigneeUserId) ?? "同事";
      const items = rows
        .map((r) => ({ title: r.title, status: r.status as IssueStatus }))
        .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

      const md = buildGentleMorningMarkdown(name, dateLabel, items, listUrl);
      const title = `早安 · 今日未完成工单（${items.length}）`;

      try {
        const { task_id } = await sendDingtalkWorkNotice(dt, title, md);
        tasks.push({ task_id, context: `morning_assignee_digest date=${todayStr} user=${assigneeUserId}` });
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${assigneeUserId}: ${msg}`);
        console.error("[cron] morning-assignee-digest:", assigneeUserId, msg);
      }
    }

    if (tasks.length > 0) {
      await new Promise((r) => setTimeout(r, dingtalkDeliveryPollDelayMs()));
      await Promise.all(tasks.map((t) => logDingTalkWorkNoticeDelivery(t.task_id, t.context)));
    }

    return NextResponse.json({
      ok: true,
      date: todayStr,
      assignees_with_incomplete_issues: byAssignee.size,
      dingtalk_work_notice_sent: sent,
      skipped_no_dingtalk_userid: skippedNoDingtalk,
      send_failed_count: errors.length,
      send_failures: errors.length ? errors : undefined,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Cron failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
