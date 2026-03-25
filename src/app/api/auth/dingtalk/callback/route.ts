import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCorpUserDetail,
  getCorpUseridByUnionid,
  getUserTokenByAuthCode,
  getUserInfoByToken,
  isDingtalkScanLoginConfigured,
  verifySelfVerifyingState,
} from "@/lib/dingtalk";
import { getPublicAppUrl } from "@/lib/app-url";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";

function loginErrorRedirectUrl(base: string, message: string): string {
  const url = new URL("/login", base);
  url.searchParams.set("error", "dingtalk");
  url.searchParams.set("error_description", message);
  return url.toString();
}

function syntheticEmailForDingtalkUserid(userid: string): string {
  const safe = userid.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `dingtalk.${safe}@mgm-ding.placeholder`;
}

export async function GET(request: NextRequest) {
  const base = getPublicAppUrl() || request.nextUrl.origin;

  if (!isDingtalkScanLoginConfigured()) {
    return NextResponse.redirect(loginErrorRedirectUrl(base, "钉钉未配置"), 302);
  }

  const urlObj = new URL(request.url);
  const authCode = urlObj.searchParams.get("authCode");
  const state = urlObj.searchParams.get("state") || "";

  if (!authCode) {
    return NextResponse.redirect(loginErrorRedirectUrl(base, "缺少授权码"), 302);
  }

  const afterLogin = verifySelfVerifyingState(state);
  if (afterLogin === null) {
    console.warn("[dingtalk-callback] state 校验失败, state=", state.slice(0, 40));
    return NextResponse.redirect(
      loginErrorRedirectUrl(base, "状态校验失败，请重新扫码"),
      302
    );
  }

  let corpUserid: string;
  let displayName: string;
  let userEmail: string;

  try {
    const userToken = await getUserTokenByAuthCode(authCode);
    const userInfo = await getUserInfoByToken(userToken);
    const unionId = userInfo.unionId!;

    corpUserid = await getCorpUseridByUnionid(unionId);
    const detail = await getCorpUserDetail(corpUserid);
    displayName = (detail?.name ?? userInfo.nick ?? corpUserid).trim() || corpUserid;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[dingtalk-callback] 获取用户信息失败:", msg);
    return NextResponse.redirect(loginErrorRedirectUrl(base, msg), 302);
  }

  const admin = createAdminClient();
  let isFirstDingtalkRegistration = false;

  const { data: existingProfile, error: findErr } = await admin
    .from("users")
    .select("id, email")
    .eq("dingtalk_userid", corpUserid)
    .maybeSingle();

  if (findErr) {
    console.error("[dingtalk-callback] find user:", findErr.message);
    return NextResponse.redirect(loginErrorRedirectUrl(base, "查询用户失败"), 302);
  }

  if (existingProfile) {
    userEmail = existingProfile.email as string;
  } else {
    isFirstDingtalkRegistration = true;
    userEmail = syntheticEmailForDingtalkUserid(corpUserid);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password: randomUUID() + randomUUID(),
      email_confirm: true,
      user_metadata: { name: displayName },
    });
    if (createErr || !created.user) {
      console.error("[dingtalk-callback] createUser:", createErr?.message);
      return NextResponse.redirect(
        loginErrorRedirectUrl(base, createErr?.message ?? "创建用户失败"),
        302
      );
    }

    const { error: upErr } = await admin
      .from("users")
      .update({ dingtalk_userid: corpUserid, name: displayName })
      .eq("id", created.user.id);

    if (upErr) {
      console.error("[dingtalk-callback] update profile:", upErr.message);
      return NextResponse.redirect(loginErrorRedirectUrl(base, "同步钉钉账号失败"), 302);
    }
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userEmail,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("[dingtalk-callback] generateLink:", linkErr?.message);
    return NextResponse.redirect(
      loginErrorRedirectUrl(base, linkErr?.message ?? "签发登录链接失败"),
      302
    );
  }

  const redirectPath = afterLogin.startsWith("/") ? afterLogin : "/";
  const redirectTarget = new URL(redirectPath, base);
  const response = NextResponse.redirect(redirectTarget, 302);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const tokenHash = linkData.properties.hashed_token;
  const types = ["email", "magiclink"] as const;
  let lastOtpError: Error | null = null;
  for (const type of types) {
    const { error: otpErr } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!otpErr) {
      lastOtpError = null;
      break;
    }
    lastOtpError = otpErr;
  }
  if (lastOtpError) {
    console.error("[dingtalk-callback] verifyOtp:", lastOtpError.message);
    return NextResponse.redirect(loginErrorRedirectUrl(base, lastOtpError.message), 302);
  }

  if (isFirstDingtalkRegistration) {
    notifyNewMemberWelcome(corpUserid, displayName);
  }

  return response;
}
