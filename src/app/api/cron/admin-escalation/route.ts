import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds } from "@/lib/reminder-logic";
import { isWecomAppConfigured } from "@/lib/wecom";
import { sendAdminDigest } from "@/lib/notification-service";
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

function buildEscalationMarkdown(
  adminName: string,
  dateLabel: string,
  noActionAssignees: { name: string; issues: { title: string; status: IssueStatus }[] }[],
  listUrl: string
): string {
  const lines: string[] = [
    `## 督促提醒 · ${dateLabel}`,
    "",
    `**${adminName}**，下午好。`,
    "",
    `今天早晨已向负责人发送了问题提醒，以下 **${noActionAssignees.length}** 位同事截至目前仍未更新进度：`,
    "",
  ];

  for (const a of noActionAssignees) {
    lines.push(`### ${a.name}（${a.issues.length} 条未完成）`);
    for (const it of a.issues) {
      const st = ISSUE_STATUS_LABELS[it.status] ?? it.status;
      lines.push(`- ${it.title}（${st}）`);
    }
    lines.push("");
  }

  if (listUrl) {
    lines.push(`[打开问题列表 →](${listUrl}/issues)`);
    lines.push("");
  }
  lines.push("请及时帮忙推动相关同事处理问题，并补充最新状态，谢谢。");

  return lines.join("\n");
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }

  if (!isWecomAppConfigured()) {
    return NextResponse.json({
      ok: true, skipped: true,
      reason: "企业微信应用未配置（WECOM_CORPID / WECOM_CORPSECRET / WECOM_AGENTID）",
    });
  }

  try {
    const supabase = createAdminClient();
    const { dateStr: todayStr, startIso: todayStartIso } = getChinaDayBounds();
    const dateLabel = `${todayStr.slice(0, 4)}年${Number(todayStr.slice(5, 7))}月${Number(todayStr.slice(8, 10))}日`;

    const { data: issues, error: issuesErr } = await supabase
      .from("issues")
      .select("id, title, status, assignee_id")
      .in("status", INCOMPLETE_ISSUE_STATUSES)
      .not("assignee_id", "is", null);

    if (issuesErr) return NextResponse.json({ error: issuesErr.message }, { status: 500 });

    if (!issues || issues.length === 0) {
      return NextResponse.json({ ok: true, date: todayStr, message: "没有未完成且已指派的问题，无需督促" });
    }

    const { data: allUsers } = await supabase.from("users").select("id, name, role, wecom_userid");
    const userMap = new Map(
      (allUsers ?? []).map((u) => [
        u.id as string,
        {
          name:        (u.name as string) ?? "同事",
          role:        u.role as string,
          wecomUserid: ((u as { wecom_userid?: string | null }).wecom_userid ?? "").trim(),
        },
      ])
    );

    type Row = { id: string; title: string; status: IssueStatus; assignee_id: string };
    const byAssignee = new Map<string, Row[]>();
    for (const row of issues as Row[]) {
      const aid = row.assignee_id;
      if (!aid) continue;
      const list = byAssignee.get(aid) ?? [];
      list.push(row);
      byAssignee.set(aid, list);
    }

    const assigneeIds = [...byAssignee.keys()];

    const { data: todayUpdates } = await supabase
      .from("issue_updates")
      .select("user_id")
      .gte("created_at", todayStartIso)
      .in("user_id", assigneeIds);

    const updatedUserIds = new Set((todayUpdates ?? []).map((u) => u.user_id as string));

    const noActionAssignees: {
      userId: string;
      name: string;
      wecomUserid: string;
      issues: { title: string; status: IssueStatus }[];
    }[] = [];

    for (const [assigneeId, rows] of byAssignee) {
      if (updatedUserIds.has(assigneeId)) continue;
      const u = userMap.get(assigneeId);
      if (!u || !u.wecomUserid) continue;
      noActionAssignees.push({
        userId:      assigneeId,
        name:        u.name,
        wecomUserid: u.wecomUserid,
        issues:      rows
          .map((r) => ({ title: r.title, status: r.status }))
          .sort((a, b) => a.title.localeCompare(b.title, "zh-CN")),
      });
    }

    if (noActionAssignees.length === 0) {
      return NextResponse.json({ ok: true, date: todayStr, message: "所有负责人今天都已更新进度，无需督促" });
    }

    const admins = (allUsers ?? []).filter(
      (u) => u.role === "admin" && ((u as { wecom_userid?: string | null }).wecom_userid ?? "").trim()
    );

    if (admins.length === 0) {
      return NextResponse.json({
        ok: true, date: todayStr,
        no_action_assignees: noActionAssignees.length,
        message: "没有配置了企业微信 userid 的管理员，无法发送督促通知",
      });
    }

    const base = getPublicAppUrl();
    let sent = 0;
    const errors: string[] = [];

    for (const admin of admins) {
      const adminWc   = ((admin as { wecom_userid?: string | null }).wecom_userid ?? "").trim();
      const adminName = (admin.name as string) ?? "管理员";

      const md    = buildEscalationMarkdown(adminName, dateLabel, noActionAssignees, base || "");
      const title = `督促提醒 · ${noActionAssignees.length} 位同事今日未更新`;

      const result = await sendAdminDigest({
        targetWecomUserid: adminWc,
        targetUserId:      admin.id as string,
        title,
        content:           md,
        triggerSource:     "cron_admin",
      });

      if (result.success) {
        sent++;
      } else {
        errors.push(`admin ${admin.id}: ${result.errorMessage ?? result.errorCode}`);
        console.error("[cron] admin-escalation:", admin.id, result.errorCode);
      }
    }

    return NextResponse.json({
      ok:                   true,
      date:                 todayStr,
      no_action_assignees:  noActionAssignees.length,
      no_action_names:      noActionAssignees.map((a) => a.name),
      admin_notified:       sent,
      send_failed_count:    errors.length,
      send_failures:        errors.length ? errors : undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cron failed" }, { status: 500 });
  }
}
