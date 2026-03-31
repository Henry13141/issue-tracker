/**
 * Cron: flush-deferred
 *
 * 每天 09:30（上海时间）运行，将所有在非工作时间产生的延迟通知批量发出。
 *
 * 延迟通知标识：
 *   notification_deliveries.status = 'pending'
 *   notification_deliveries.provider_response @> '{"deferred": true}'
 *
 * 触发时间（UTC）：01:30（= CST 09:30）
 * Vercel cron 表达式：30 1 * * *
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendWecomWorkNotice,
  sendWecomWebhookText,
  stripMarkdown,
  isWecomAppConfigured,
  isWecomWebhookConfigured,
} from "@/lib/wecom";
import { normalizeNotificationError } from "@/lib/notification-error";

export const dynamic = "force-dynamic";

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!secret) return true;
  return vercelCron || request.headers.get("authorization") === `Bearer ${secret}`;
}

type DeliveryRow = {
  id: string;
  channel: string;
  target_wecom_userid: string | null;
  target_user_id: string | null;
  title: string | null;
  content: string;
  trigger_source: string;
  attempt_count: number;
  provider_response: Record<string, unknown>;
};

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 503 }
    );
  }

  const appOk     = isWecomAppConfigured();
  const webhookOk = isWecomWebhookConfigured();
  if (!appOk && !webhookOk) {
    return NextResponse.json({ ok: true, skipped: true, reason: "企业微信未配置" });
  }

  const now = new Date();

  try {
    const db = createAdminClient();

    // 查询所有标记为 deferred 的 pending 通知（最多处理 200 条）
    const { data: rows, error: qErr } = await db
      .from("notification_deliveries")
      .select("id, channel, target_wecom_userid, target_user_id, title, content, trigger_source, attempt_count, provider_response")
      .eq("status", "pending")
      .filter("provider_response->>deferred", "eq", "true")
      .order("created_at", { ascending: true })
      .limit(200);

    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }

    const pending = (rows ?? []) as DeliveryRow[];

    // 进一步过滤：send_after <= now（避免当前批次处理尚未到点的记录）
    const ready = pending.filter((r) => {
      const sendAfter = r.provider_response?.send_after as string | undefined;
      if (!sendAfter) return true; // 无时间标记则立即发
      return new Date(sendAfter) <= now;
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of ready) {
      let success = false;
      let errorCode: string | undefined;
      let errorMessage: string | undefined;

      if (row.channel === "wecom_app") {
        if (!appOk || !row.target_wecom_userid?.trim()) {
          skipped++;
          await db.from("notification_deliveries").update({
            status:       "failed",
            error_code:   "config_missing_or_no_userid",
            error_message: !appOk ? "企业微信应用未配置" : "target_wecom_userid 为空",
            provider_response: { ...row.provider_response, flushed_at: now.toISOString() },
          }).eq("id", row.id);
          continue;
        }

        try {
          await sendWecomWorkNotice(
            row.target_wecom_userid,
            row.title ?? "",
            row.content
          );
          success = true;
        } catch (e: unknown) {
          const normalized = normalizeNotificationError(e);
          errorCode    = normalized.code;
          errorMessage = normalized.message;
          errors.push(`${row.id}: ${errorMessage}`);
        }
      } else if (row.channel === "wecom_bot") {
        if (!webhookOk) {
          skipped++;
          await db.from("notification_deliveries").update({
            status:       "failed",
            error_code:   "config_missing",
            error_message: "WECOM_WEBHOOK_URL 未配置",
            provider_response: { ...row.provider_response, flushed_at: now.toISOString() },
          }).eq("id", row.id);
          continue;
        }

        try {
          const plain = stripMarkdown(row.content);
          const result = await sendWecomWebhookText(plain);
          if (result.ok) {
            success = true;
          } else {
            errorCode    = "webhook_error";
            errorMessage = result.error;
            errors.push(`${row.id}: ${errorMessage}`);
          }
        } catch (e: unknown) {
          const normalized = normalizeNotificationError(e);
          errorCode    = normalized.code;
          errorMessage = normalized.message;
          errors.push(`${row.id}: ${errorMessage}`);
        }
      } else {
        // 未知 channel，标记失败
        skipped++;
        await db.from("notification_deliveries").update({
          status:       "failed",
          error_code:   "unknown_channel",
          error_message: `未知 channel: ${row.channel}`,
          provider_response: { ...row.provider_response, flushed_at: now.toISOString() },
        }).eq("id", row.id);
        continue;
      }

      // 更新投递记录
      await db.from("notification_deliveries").update({
        status:           success ? "success" : "failed",
        sent_at:          success ? now.toISOString() : null,
        error_code:       errorCode   ?? null,
        error_message:    errorMessage ?? null,
        attempt_count:    row.attempt_count + 1,
        provider_response: {
          ...row.provider_response,
          flushed_at: now.toISOString(),
        },
      }).eq("id", row.id);

      if (success) sent++;
      else failed++;
    }

    return NextResponse.json({
      ok:              true,
      deferred_total:  pending.length,
      ready_to_send:   ready.length,
      sent,
      failed,
      skipped,
      errors:          errors.length ? errors : undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 }
    );
  }
}
