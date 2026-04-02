import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";

function isLocalDevRequest(request: NextRequest): boolean {
  const host = request.nextUrl.hostname;
  return process.env.NODE_ENV !== "production" && (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1"
  );
}

function normalizeRedirectPath(input: unknown): string {
  const v = typeof input === "string" ? input : "/";
  if (!v.startsWith("/") || v.startsWith("//")) return "/";
  return v;
}

export async function POST(request: NextRequest) {
  if (!isLocalDevRequest(request)) {
    return NextResponse.json({ error: "仅本地开发环境允许使用调试登录" }, { status: 403 });
  }

  let body: { userId?: string; redirect?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "请选择调试用户" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile, error: profileErr } = await admin
    .from("users")
    .select("email")
    .eq("id", userId)
    .single();

  if (profileErr || !profile?.email) {
    return NextResponse.json({ error: "调试用户不存在或邮箱缺失" }, { status: 404 });
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email as string,
  });

  if (linkErr || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: linkErr?.message ?? "签发调试登录链接失败" }, { status: 500 });
  }

  const response = NextResponse.json({
    ok: true,
    redirect: normalizeRedirectPath(body.redirect),
  });

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
      cookieEncoding: "raw",
    }
  );

  const tokenHash = linkData.properties.hashed_token;
  const types = ["email", "magiclink"] as const;
  let lastOtpError: Error | null = null;

  for (const type of types) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) {
      lastOtpError = null;
      break;
    }
    lastOtpError = error;
  }

  if (lastOtpError) {
    return NextResponse.json({ error: lastOtpError.message }, { status: 500 });
  }

  return response;
}
