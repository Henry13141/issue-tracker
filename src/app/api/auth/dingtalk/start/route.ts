import { NextRequest, NextResponse } from "next/server";
import {
  generateSelfVerifyingState,
  isDingtalkScanLoginConfigured,
} from "@/lib/dingtalk";
import { getPublicAppUrl } from "@/lib/app-url";

export async function GET(request: NextRequest) {
  if (!isDingtalkScanLoginConfigured()) {
    return NextResponse.json(
      { error: "钉钉扫码登录未配置（需要 DINGTALK_APP_KEY / DINGTALK_APP_SECRET）" },
      { status: 503 }
    );
  }

  const base = getPublicAppUrl();
  if (!base) {
    return NextResponse.json(
      { error: "请配置 NEXT_PUBLIC_APP_URL（与钉钉开放平台回调域名一致，勿尾斜杠）" },
      { status: 503 }
    );
  }

  const appKey = process.env.DINGTALK_APP_KEY!.trim();
  const callbackUrl = `${base}/api/auth/dingtalk/callback`;

  let afterLogin = request.nextUrl.searchParams.get("redirect") || "/";
  if (!afterLogin.startsWith("/") || afterLogin.startsWith("//")) {
    afterLogin = "/";
  }

  const state = generateSelfVerifyingState(afterLogin);

  const dingUrl =
    `https://login.dingtalk.com/oauth2/auth` +
    `?redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&client_id=${encodeURIComponent(appKey)}` +
    `&scope=openid` +
    `&state=${encodeURIComponent(state)}` +
    `&prompt=consent`;

  return NextResponse.redirect(dingUrl, 302);
}
