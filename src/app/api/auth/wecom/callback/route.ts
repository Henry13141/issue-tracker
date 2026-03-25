import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getUserInfoByCode,
  getUserDetailByUserid,
  isWecomScanLoginConfigured,
  verifySelfVerifyingState,
} from "@/lib/wecom";
import { getPublicAppUrl } from "@/lib/app-url";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";

function loginErrorRedirectUrl(base: string, message: string): string {
  const url = new URL("/login", base);
  url.searchParams.set("error", "wecom");
  url.searchParams.set("error_description", message);
  return url.toString();
}

function syntheticEmailForWecomUserid(userid: string): string {
  const safe = userid.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `wecom.${safe}@mgm-wecom.placeholder`;
}

export async function GET(request: NextRequest) {
  const base = getPublicAppUrl() || request.nextUrl.origin;

  if (!isWecomScanLoginConfigured()) {
    return NextResponse.redirect(loginErrorRedirectUrl(base, "企业微信未配置"), 302);
  }

  const urlObj = new URL(request.url);
  const code = urlObj.searchParams.get("code");
  const state = urlObj.searchParams.get("state") || "";

  if (!code) {
    return NextResponse.redirect(loginErrorRedirectUrl(base, "缺少授权码"), 302);
  }

  const afterLogin = verifySelfVerifyingState(state);
  if (afterLogin === null) {
    console.warn("[wecom-callback] state 校验失败, state=", state.slice(0, 40));
    return NextResponse.redirect(
      loginErrorRedirectUrl(base, "状态校验失败，请重新扫码"),
      302
    );
  }

  let corpUserid: string;
  let displayName: string;
  let userEmail: string;

  try {
    const userInfo = await getUserInfoByCode(code);
    corpUserid = userInfo.UserId!;
    const detail = await getUserDetailByUserid(corpUserid);
    displayName = (detail?.name ?? corpUserid).trim() || corpUserid;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[wecom-callback] 获取用户信息失败:", msg);
    return NextResponse.redirect(loginErrorRedirectUrl(base, msg), 302);
  }

  const admin = createAdminClient();
  let isFirstWecomRegistration = false;

  const { data: existingProfile, error: findErr } = await admin
    .from("users")
    .select("id, email")
    .eq("wecom_userid", corpUserid)
    .maybeSingle();

  if (findErr) {
    console.error("[wecom-callback] find user:", findErr.message);
    return NextResponse.redirect(loginErrorRedirectUrl(base, "查询用户失败"), 302);
  }

  if (existingProfile) {
    userEmail = existingProfile.email as string;
  } else {
    isFirstWecomRegistration = true;
    userEmail = syntheticEmailForWecomUserid(corpUserid);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: userEmail,
      password: randomUUID() + randomUUID(),
      email_confirm: true,
      user_metadata: { name: displayName },
    });
    if (createErr || !created.user) {
      console.error("[wecom-callback] createUser:", createErr?.message);
      return NextResponse.redirect(
        loginErrorRedirectUrl(base, createErr?.message ?? "创建用户失败"),
        302
      );
    }

    const { error: upErr } = await admin
      .from("users")
      .update({ wecom_userid: corpUserid, name: displayName })
      .eq("id", created.user.id);

    if (upErr) {
      console.error("[wecom-callback] update profile:", upErr.message);
      return NextResponse.redirect(loginErrorRedirectUrl(base, "同步企业微信账号失败"), 302);
    }
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userEmail,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    console.error("[wecom-callback] generateLink:", linkErr?.message);
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
    console.error("[wecom-callback] verifyOtp:", lastOtpError.message);
    return NextResponse.redirect(loginErrorRedirectUrl(base, lastOtpError.message), 302);
  }

  if (isFirstWecomRegistration) {
    notifyNewMemberWelcome(corpUserid, displayName);
  }

  return response;
}
