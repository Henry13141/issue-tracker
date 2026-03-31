import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChinaDayBounds } from "@/lib/reminder-logic";
import { isWecomAppConfigured, isWecomWebhookConfigured } from "@/lib/wecom";
import { sendAdminDigest, sendGroupDigest } from "@/lib/notification-service";
import { getPublicAppUrl } from "@/lib/app-url";
import { INCOMPLETE_ISSUE_STATUSES, ISSUE_STATUS_LABELS } from "@/lib/constants";
import { chatCompletion, isAIConfigured } from "@/lib/ai";
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
  listUrl: string,
  aiSummary?: string | null,
): string {
  const n = items.length;
  const lines: string[] = [
    `## 早安 · ${dateLabel}`,
    "",
    `**${assigneeName}**，早上好～`,
    "",
    "我是米伽米问题追踪小助手，今天继续和你并肩推进。",
    "",
    n === 1
      ? `目前你名下还有 **1** 个待处理问题。请及时帮忙处理问题，方便时补一条进展就可以。`
      : `目前你名下还有 **${n}** 个待处理问题。请及时帮忙处理问题，方便时补一条进展就可以。`,
    "",
  ];

  if (aiSummary) {
    lines.push("### 昨日工作回顾（AI 生成）");
    lines.push("");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("### 待处理问题清单");
  lines.push("");

  for (const it of items) {
    const st = ISSUE_STATUS_LABELS[it.status] ?? it.status;
    lines.push(`- **${it.title}**（${st}）`);
  }

  lines.push("");
  if (listUrl) {
    lines.push(`[打开问题列表 →](${listUrl}/issues)`);
    lines.push("");
  }
  lines.push("若已处理完毕，把对应问题更新为「已解决」或「已关闭」即可，我会少打扰你。");
  lines.push("");
  lines.push("祝今天顺利。");

  return lines.join("\n");
}

async function generateYesterdaySummary(
  assigneeName: string,
  yesterdayUpdates: { title: string; content: string; time: string }[],
): Promise<string | null> {
  if (!isAIConfigured() || yesterdayUpdates.length === 0) return null;

  const context = yesterdayUpdates
    .map((u) => `[${u.time}] ${u.title}: ${u.content}`)
    .join("\n");

  const systemPrompt = [
    "你是项目管理助手。根据以下某员工昨天在各个任务中的进展记录，",
    "生成一段简洁的昨日工作回顾（3-5 句话），帮助员工快速回忆昨天做了什么。",
    "用第二人称（'你'），语气轻松友好。不要用 Markdown 标题。",
    "直接输出内容，不要加前缀。控制在 150 字以内。",
  ].join("");

  try {
    return await chatCompletion(systemPrompt, `员工：${assigneeName}\n昨日进展：\n${context}`, {
      maxTokens: 256,
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured" }, { status: 503 });
  }

  if (!isWecomAppConfigured() && !isWecomWebhookConfigured()) {
    return NextResponse.json({
      ok: true, skipped: true,
      reason: "企业微信应用和群机器人均未配置",
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

    const { data: allUsers } = await supabase.from("users").select("id, name, wecom_userid");
    const nameMap = new Map((allUsers ?? []).map((u) => [u.id as string, (u.name as string) ?? "同事"]));
    const wecomMap = new Map(
      (allUsers ?? []).map((u) => [
        u.id as string,
        ((u as { wecom_userid?: string | null }).wecom_userid ?? "").trim(),
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

    // ── 查询昨日进展（用于 AI 摘要）──────────────────────────────────
    type UpdateRow = { content: string; created_at: string; user_id: string; issue_id: string };
    const yesterdayUpdatesByUser = new Map<string, { title: string; content: string; time: string }[]>();

    if (isAIConfigured()) {
      const yesterday = new Date(Date.now() - 86400000);
      const yesterdayStart = new Date(yesterday);
      yesterdayStart.setUTCHours(0, 0, 0, 0);

      const { data: yesterdayUpdates } = await supabase
        .from("issue_updates")
        .select("content, created_at, user_id, issue_id")
        .eq("is_system_generated", false)
        .gte("created_at", yesterdayStart.toISOString())
        .lt("created_at", new Date().toISOString());

      const issueTitleMap = new Map<string, string>();
      for (const rows of byAssignee.values()) {
        for (const r of rows) issueTitleMap.set(r.id, r.title);
      }

      for (const u of (yesterdayUpdates ?? []) as UpdateRow[]) {
        const issueTitle = issueTitleMap.get(u.issue_id);
        if (!issueTitle || !u.user_id) continue;
        const list = yesterdayUpdatesByUser.get(u.user_id) ?? [];
        list.push({
          title: issueTitle,
          content: u.content.slice(0, 200),
          time: u.created_at.slice(11, 16),
        });
        yesterdayUpdatesByUser.set(u.user_id, list);
      }
    }

    const base = getPublicAppUrl();
    let sent = 0;
    let skippedNoWecom = 0;
    const errors: string[] = [];

    // ── 个人私信 ────────────────────────────────────────────────────────
    if (isWecomAppConfigured()) {
      for (const [assigneeUserId, rows] of byAssignee) {
        const wc = wecomMap.get(assigneeUserId);
        if (!wc) { skippedNoWecom++; continue; }

        const name  = nameMap.get(assigneeUserId) ?? "同事";
        const items = rows
          .map((r) => ({ title: r.title, status: r.status as IssueStatus }))
          .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

        let aiSummary: string | null = null;
        const userUpdates = yesterdayUpdatesByUser.get(assigneeUserId);
        if (userUpdates && userUpdates.length > 0) {
          aiSummary = await generateYesterdaySummary(name, userUpdates);
        }

        const md    = buildGentleMorningMarkdown(name, dateLabel, items, base || "", aiSummary);
        const title = `早安 · 今日待处理问题（${items.length}）`;

        const result = await sendAdminDigest({
          targetWecomUserid: wc,
          targetUserId:      assigneeUserId,
          title,
          content:           md,
          triggerSource:     "cron_morning",
        });

        if (result.success) {
          sent++;
        } else {
          errors.push(`${assigneeUserId}: ${result.errorMessage ?? result.errorCode}`);
          console.error("[cron] morning-assignee-digest:", assigneeUserId, result.errorCode);
        }
      }
    }

    // ── 群机器人：今日任务汇总（一条，发给整个群）───────────────────────
    let groupSent = false;
    if (byAssignee.size > 0 && isWecomWebhookConfigured()) {
      const groupLines: string[] = [
        `## 早安 · ${dateLabel} 今日待处理任务`,
        "",
        "以下同事名下有待处理问题，请各自在今天工作结束前更新一条进展：",
        "",
      ];

      for (const [assigneeUserId, rows] of byAssignee) {
        const name  = nameMap.get(assigneeUserId) ?? "同事";
        const items = rows.sort((a, b) =>
          a.title.localeCompare(b.title, "zh-CN")
        );
        groupLines.push(`**${name}（${items.length}个）**`);
        for (const r of items) {
          const st = ISSUE_STATUS_LABELS[r.status as IssueStatus] ?? r.status;
          groupLines.push(`- ${r.title}（${st}）`);
        }
        groupLines.push("");
      }

      const result = await sendGroupDigest({
        content:       groupLines.join("\n"),
        triggerSource: "cron_morning",
      });
      groupSent = result.success;
    }

    return NextResponse.json({
      ok: true,
      date:                             todayStr,
      assignees_with_incomplete_issues: byAssignee.size,
      wecom_work_notice_sent:           sent,
      skipped_no_wecom_userid:          skippedNoWecom,
      send_failed_count:                errors.length,
      send_failures:                    errors.length ? errors : undefined,
      wecom_group_sent:                 groupSent,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Cron failed" }, { status: 500 });
  }
}
