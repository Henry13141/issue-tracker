import { NextRequest, NextResponse } from "next/server";
import {
  generateSelfVerifyingState,
  isWecomScanLoginConfigured,
  getWecomCorpId,
  getWecomAgentId,
} from "@/lib/wecom";
import { getPublicAppUrl } from "@/lib/app-url";

export async function GET(request: NextRequest) {
  if (!isWecomScanLoginConfigured()) {
    return NextResponse.json(
      { error: "企业微信扫码登录未配置（需要 WECOM_CORPID / WECOM_AGENTID）" },
      { status: 503 }
    );
  }

  const base = getPublicAppUrl();
  if (!base) {
    return NextResponse.json(
      { error: "请配置 NEXT_PUBLIC_APP_URL（与企业微信开放平台回调域名一致，勿尾斜杠）" },
      { status: 503 }
    );
  }

  const corpId = getWecomCorpId();
  const agentId = getWecomAgentId();
  const callbackUrl = `${base}/api/auth/wecom/callback`;

  let afterLogin = request.nextUrl.searchParams.get("redirect") || "/";
  if (!afterLogin.startsWith("/") || afterLogin.startsWith("//")) {
    afterLogin = "/";
  }

  const state = generateSelfVerifyingState(afterLogin);

  // 企业微信网页授权扫码登录 URL
  const wecomUrl =
    `https://open.work.weixin.qq.com/wwopen/sso/qrConnect` +
    `?appid=${encodeURIComponent(corpId)}` +
    `&agentid=${encodeURIComponent(agentId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&state=${encodeURIComponent(state)}`;

  return NextResponse.redirect(wecomUrl, 302);
}
