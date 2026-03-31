/**
 * 统一通知发送服务（P1）
 *
 * 所有企业微信通知必须经过此服务发出，以便：
 * 1. 在 notification_deliveries 留下审计记录
 * 2. 归一化错误并写入 issue_events
 * 3. 支持管理员重试失败记录
 *
 * 调用关系：
 *   Cron routes / issue-dingtalk-notify.ts
 *     → sendNotification() / sendIssueNotification() / sendReminderNotification() / etc.
 *       → wecom.ts（sendWecomWorkNotice / sendWecomMarkdown）
 *       → notification_deliveries（admin client）
 *       → issue_events（admin client）
 */

import {
  sendWecomWorkNotice,
  sendWecomWebhookText,
  stripMarkdown,
  isWecomAppConfigured,
  isWecomWebhookConfigured,
} from "@/lib/wecom";
import { normalizeNotificationError } from "@/lib/notification-error";
import { writeIssueEvent } from "@/lib/issue-events";
import { isWithinBusinessHours, nextBusinessStart } from "@/lib/business-hours";
import type { NotificationChannel, NotificationTriggerSource } from "@/types";

// ─── 内部类型 ──────────────────────────────────────────────────────────────

export interface SendParams {
  channel: NotificationChannel;
  /** 企业微信通讯录 userid（wecom_app 必须有一个来源） */
  targetWecomUserid?: string | null;
  /** 内部用户 UUID（用于日志关联，也可作 wecom_userid 缺失时的说明） */
  targetUserId?: string | null;
  issueId?: string | null;
  reminderId?: string | null;
  triggerSource: NotificationTriggerSource | string;
  title?: string | null;
  /** Markdown 格式内容（wecom_app 内部会转纯文本发送） */
  content: string;
}

export interface SendResult {
  success: boolean;
  deliveryId: string | null;
  errorCode?: string;
  errorMessage?: string;
}

// ─── 内部 admin client 工厂（fail-safe）───────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";

function tryCreateAdminClient() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

// ─── 核心发送函数 ──────────────────────────────────────────────────────────

/**
 * 发送一条通知，并在 notification_deliveries 留下完整的投递日志。
 * 此函数不会抛出异常，所有错误都通过返回值 / DB 记录处理。
 */
export async function sendNotification(params: SendParams): Promise<SendResult> {
  const db = tryCreateAdminClient();

  // ── 1. 创建 pending 记录 ─────────────────────────────────────────────
  let deliveryId: string | null = null;
  if (db) {
    try {
      const { data: row } = await db
        .from("notification_deliveries")
        .insert({
          channel:             params.channel,
          target_user_id:      params.targetUserId  ?? null,
          target_wecom_userid: params.targetWecomUserid ?? null,
          issue_id:            params.issueId    ?? null,
          reminder_id:         params.reminderId ?? null,
          trigger_source:      params.triggerSource,
          title:               params.title   ?? null,
          content:             params.content,
          status:              "pending",
          attempt_count:       1,
        })
        .select("id")
        .single();
      deliveryId = (row as { id: string } | null)?.id ?? null;
    } catch (e) {
      console.error("[notification-service] 创建投递记录失败:", e instanceof Error ? e.message : e);
    }
  }

  // ── 2. 检查必要配置 ──────────────────────────────────────────────────
  const configOk =
    params.channel === "wecom_bot"
      ? isWecomWebhookConfigured()
      : isWecomAppConfigured();

  if (!configOk) {
    const errResult = {
      code: "config_missing",
      message: params.channel === "wecom_bot"
        ? "WECOM_WEBHOOK_URL 未配置"
        : "WECOM_CORPID / WECOM_CORPSECRET / WECOM_AGENTID 未配置",
    };
    await updateDelivery(db, deliveryId, {
      status: "failed",
      errorCode: errResult.code,
      errorMessage: errResult.message,
    });
    await writeEventIfNeeded(db, params, deliveryId, false, errResult.code);
    return { success: false, deliveryId, ...errResult };
  }

  if (params.channel === "wecom_app" && !params.targetWecomUserid) {
    const errResult = { code: "invalid_userid", message: "targetWecomUserid 未提供" };
    await updateDelivery(db, deliveryId, {
      status: "failed",
      errorCode: errResult.code,
      errorMessage: errResult.message,
    });
    await writeEventIfNeeded(db, params, deliveryId, false, errResult.code);
    return { success: false, deliveryId, ...errResult };
  }

  // ── 2.5 工作时间检查 ─────────────────────────────────────────────────
  // Cron 类通知（trigger_source 以 "cron_" 开头）或测试消息按原定计划发送，
  // 不受工作时间限制。事件驱动型通知（如 issue_event.*）若在 09:30–18:30
  // 上海时间之外触发，则延迟至下一个上班时间再发送。
  const isCronOrTest =
    params.triggerSource === "manual_test" ||
    (typeof params.triggerSource === "string" && params.triggerSource.startsWith("cron_"));

  if (!isCronOrTest && !isWithinBusinessHours()) {
    const sendAfter = nextBusinessStart().toISOString();
    await updateDelivery(db, deliveryId, {
      status:          "pending",
      providerResponse: { deferred: true, send_after: sendAfter },
    });
    console.info(
      `[notification-service] 非工作时间，通知已延迟：` +
      `issue=${params.issueId?.slice(0, 8) ?? "—"} ` +
      `channel=${params.channel} send_after=${sendAfter}`
    );
    return { success: false, deliveryId, errorCode: "deferred", errorMessage: sendAfter };
  }

  // ── 3. 实际发送 ──────────────────────────────────────────────────────
  try {
    if (params.channel === "wecom_bot") {
      const plain = stripMarkdown(params.content);
      const result = await sendWecomWebhookText(plain);
      if (!result.ok) throw new Error(result.error);
    } else {
      await sendWecomWorkNotice(
        params.targetWecomUserid!,
        params.title ?? "",
        params.content
      );
    }

    // 成功
    await updateDelivery(db, deliveryId, {
      status: "success",
      sentAt: new Date().toISOString(),
      providerResponse: { ok: true },
    });
    await writeEventIfNeeded(db, params, deliveryId, true, undefined);
    return { success: true, deliveryId };
  } catch (err: unknown) {
    const normalized = normalizeNotificationError(err);
    await updateDelivery(db, deliveryId, {
      status: "failed",
      errorCode: normalized.code,
      errorMessage: normalized.message,
      providerResponse: normalized.providerResponse,
    });
    await writeEventIfNeeded(db, params, deliveryId, false, normalized.code);
    return {
      success: false,
      deliveryId,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    };
  }
}

// ─── 语义化包装函数 ────────────────────────────────────────────────────────

/** 工单事件通知（指派变更、状态变更等）→ wecom_app */
export async function sendIssueNotification(params: {
  targetWecomUserid: string;
  targetUserId?: string | null;
  issueId: string;
  title: string;
  content: string;
  triggerSource?: NotificationTriggerSource;
}): Promise<SendResult> {
  return sendNotification({
    channel:             "wecom_app",
    targetWecomUserid:   params.targetWecomUserid,
    targetUserId:        params.targetUserId,
    issueId:             params.issueId,
    triggerSource:       params.triggerSource ?? "issue_event",
    title:               params.title,
    content:             params.content,
  });
}

/** Reminder 催办通知 → wecom_app */
export async function sendReminderNotification(params: {
  targetWecomUserid: string;
  targetUserId?: string | null;
  issueId?: string | null;
  reminderId?: string | null;
  title: string;
  content: string;
  triggerSource?: NotificationTriggerSource;
}): Promise<SendResult> {
  return sendNotification({
    channel:             "wecom_app",
    targetWecomUserid:   params.targetWecomUserid,
    targetUserId:        params.targetUserId,
    issueId:             params.issueId,
    reminderId:          params.reminderId,
    triggerSource:       params.triggerSource ?? "cron_daily",
    title:               params.title,
    content:             params.content,
  });
}

/** 管理员摘要通知 → wecom_app */
export async function sendAdminDigest(params: {
  targetWecomUserid: string;
  targetUserId?: string | null;
  title: string;
  content: string;
  triggerSource: NotificationTriggerSource;
}): Promise<SendResult> {
  return sendNotification({
    channel:           "wecom_app",
    targetWecomUserid: params.targetWecomUserid,
    targetUserId:      params.targetUserId,
    triggerSource:     params.triggerSource,
    title:             params.title,
    content:           params.content,
  });
}

/** 群机器人 Webhook 汇总消息 → wecom_bot */
export async function sendGroupDigest(params: {
  content: string;
  issueId?: string | null;
  triggerSource: NotificationTriggerSource;
}): Promise<SendResult> {
  return sendNotification({
    channel:       "wecom_bot",
    issueId:       params.issueId,
    triggerSource: params.triggerSource,
    content:       params.content,
  });
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────

async function updateDelivery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any | null,
  deliveryId: string | null,
  patch: {
    status: "success" | "failed" | "pending";
    sentAt?: string;
    errorCode?: string;
    errorMessage?: string;
    providerResponse?: Record<string, unknown>;
  }
): Promise<void> {
  if (!db || !deliveryId) return;
  try {
    await db
      .from("notification_deliveries")
      .update({
        status:            patch.status,
        sent_at:           patch.sentAt ?? null,
        error_code:        patch.errorCode ?? null,
        error_message:     patch.errorMessage ?? null,
        provider_response: patch.providerResponse ?? {},
      })
      .eq("id", deliveryId);
  } catch (e) {
    console.error("[notification-service] 更新投递记录失败:", e instanceof Error ? e.message : e);
  }
}

async function writeEventIfNeeded(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any | null,
  params: SendParams,
  deliveryId: string | null,
  success: boolean,
  errorCode?: string
): Promise<void> {
  if (!db || !params.issueId) return;
  try {
    await writeIssueEvent(db, {
      issueId:   params.issueId,
      actorId:   params.targetUserId ?? null,
      eventType: success ? "notification_delivery_success" : "notification_delivery_failed",
      payload: {
        delivery_id:    deliveryId,
        channel:        params.channel,
        trigger_source: params.triggerSource,
        error_code:     errorCode ?? null,
      },
    });
  } catch (e) {
    console.error("[notification-service] 写 issue_events 失败:", e instanceof Error ? e.message : e);
  }
}
