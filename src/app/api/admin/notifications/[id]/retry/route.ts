/**
 * POST /api/admin/notifications/[id]/retry
 *
 * 重试设计（覆盖原记录 + 递增 attempt_count）：
 * - 保留原记录 ID 不变，复用原始 channel/content/target 等字段
 * - attempt_count += 1，status 先置 pending 再更新为 success/failed
 * - 最大允许 5 次（attempt_count >= 5 时拒绝）
 * - 重试结果写入 issue_events（如有 issue_id）
 *
 * 选择覆盖而非新增行的原因：
 *   admin 页面可按 delivery_id 查询最新状态，无需关联多条记录；
 *   如需完整历史可查 issue_events，那里有每次 success/failed 记录。
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNotification } from "@/lib/notification-service";
import { normalizeNotificationError } from "@/lib/notification-error";
import { writeIssueEvent } from "@/lib/issue-events";
import type { NotificationDelivery } from "@/types";

const MAX_ATTEMPTS = 5;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // ── 鉴权：仅 admin ────────────────────────────────────────────────────
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "仅管理员可执行重试" }, { status: 403 });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY 未配置" }, { status: 503 });
  }

  const db = createAdminClient();

  // ── 读取原记录 ────────────────────────────────────────────────────────
  const { data: delivery, error: fetchErr } = await db
    .from("notification_deliveries")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !delivery) {
    return NextResponse.json({ error: "投递记录不存在" }, { status: 404 });
  }

  const d = delivery as NotificationDelivery;

  if (d.status !== "failed") {
    return NextResponse.json({ error: "仅 failed 状态的记录可以重试" }, { status: 400 });
  }

  if (d.attempt_count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: `已达最大重试次数（${MAX_ATTEMPTS}）` },
      { status: 400 }
    );
  }

  // ── 将记录置为 pending，递增 attempt_count ───────────────────────────
  const newAttempt = d.attempt_count + 1;
  await db
    .from("notification_deliveries")
    .update({ status: "pending", attempt_count: newAttempt, error_code: null, error_message: null })
    .eq("id", id);

  // ── 重新发送 ──────────────────────────────────────────────────────────
  try {
    const result = await sendNotification({
      channel:             d.channel as "wecom_app" | "wecom_bot",
      targetWecomUserid:   d.target_wecom_userid ?? undefined,
      targetUserId:        d.target_user_id ?? undefined,
      issueId:             d.issue_id ?? undefined,
      reminderId:          d.reminder_id ?? undefined,
      triggerSource:       d.trigger_source,
      title:               d.title ?? undefined,
      content:             d.content,
    });

    if (result.success) {
      // sendNotification 内部已写 success 记录，但因为我们想更新 THIS record 而不是它内部创建的新 record，
      // 所以这里直接更新本记录（sendNotification 在 retry 场景会创建一个 NEW pending 记录，
      // 我们不需要它，改为直接更新原记录）
      await db
        .from("notification_deliveries")
        .update({
          status:            "success",
          sent_at:           new Date().toISOString(),
          error_code:        null,
          error_message:     null,
          provider_response: { ok: true, retried_by: user.id },
          attempt_count:     newAttempt,
        })
        .eq("id", id);

      if (d.issue_id) {
        await writeIssueEvent(db, {
          issueId:   d.issue_id,
          actorId:   user.id,
          eventType: "notification_delivery_success",
          payload:   { delivery_id: id, retry: true, attempt: newAttempt },
        });
      }

      // 删除 sendNotification 内部额外创建的那条 pending 记录（如果有）
      if (result.deliveryId && result.deliveryId !== id) {
        await db.from("notification_deliveries").delete().eq("id", result.deliveryId);
      }

      return NextResponse.json({ ok: true, attempt_count: newAttempt });
    } else {
      // 失败
      const errCode = result.errorCode ?? "provider_unknown_error";
      await db
        .from("notification_deliveries")
        .update({
          status:        "failed",
          error_code:    errCode,
          error_message: result.errorMessage ?? null,
          attempt_count: newAttempt,
        })
        .eq("id", id);

      if (d.issue_id) {
        await writeIssueEvent(db, {
          issueId:   d.issue_id,
          actorId:   user.id,
          eventType: "notification_delivery_failed",
          payload:   { delivery_id: id, retry: true, attempt: newAttempt, error_code: errCode },
        });
      }

      if (result.deliveryId && result.deliveryId !== id) {
        await db.from("notification_deliveries").delete().eq("id", result.deliveryId);
      }

      return NextResponse.json(
        { ok: false, error_code: errCode, error_message: result.errorMessage, attempt_count: newAttempt },
        { status: 200 }
      );
    }
  } catch (err: unknown) {
    const normalized = normalizeNotificationError(err);
    await db
      .from("notification_deliveries")
      .update({
        status:        "failed",
        error_code:    normalized.code,
        error_message: normalized.message,
        attempt_count: newAttempt,
      })
      .eq("id", id);

    return NextResponse.json(
      { ok: false, error_code: normalized.code, error_message: normalized.message },
      { status: 200 }
    );
  }
}
