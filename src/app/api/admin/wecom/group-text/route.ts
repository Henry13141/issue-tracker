import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPublicAppUrl } from "@/lib/app-url";
import { isWecomWebhookConfigured, sendWecomWebhookText } from "@/lib/wecom";

function buildOnboardingGroupText(): string {
  const base = getPublicAppUrl();
  const loginUrl = base ? `${base}/login` : "（请联系管理员获取登录地址，需配置 NEXT_PUBLIC_APP_URL）";
  return [
    "各位同事好，",
    "",
    "公司已启用米伽米问题追踪系统，用来记录问题、指派负责人和跟进进度，后面相关提醒也会走企业微信。",
    "",
    "请大家抽空完成首次进入：",
    "",
    `1、用电脑浏览器打开：${loginUrl}`,
    "2、点击「企业微信扫码登录」，用企业微信扫码",
    "3、第一次扫码会自动开通账号，之后才能正常收到指派和催办消息",
    "",
    "如有打不开、扫不了码等情况，直接在群里联系管理员。",
    "",
    "谢谢配合。",
  ].join("\n");
}

/**
 * POST /api/admin/wecom/group-text
 * 通过 WECOM_WEBHOOK_URL 向工作群发送纯文字（仅管理员）。
 *
 * Body JSON（可选）：
 * - { "preset": "onboarding" }  默认，发送登录引导
 * - { "text": "自定义全文" }     自定义内容
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "仅管理员可发送" }, { status: 403 });
  }

  if (!isWecomWebhookConfigured()) {
    return NextResponse.json({ error: "未配置 WECOM_WEBHOOK_URL" }, { status: 503 });
  }

  let text = buildOnboardingGroupText();
  try {
    const body = (await request.json()) as { preset?: string; text?: string };
    if (typeof body.text === "string" && body.text.trim()) {
      text = body.text.trim();
    } else if (body.preset && body.preset !== "onboarding") {
      return NextResponse.json({ error: "未知 preset" }, { status: 400 });
    }
  } catch {
    /* 无 body 时用默认 onboarding */
  }

  const result = await sendWecomWebhookText(text);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
