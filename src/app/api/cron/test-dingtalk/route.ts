import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeCronRequest } from "@/lib/cron-auth";
import {
  sendWecomWorkNotice,
  isWecomAppConfigured,
} from "@/lib/wecom";

/**
 * 手动验证企业微信「应用消息」是否打通。
 * - 查询参数 `userid` 可选；不传则从 `users.wecom_userid` 取第一条非空。
 * - 路径保留为 /api/cron/test-dingtalk 以兼容现有 vercel.json 配置（如有）。
 */
export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!isWecomAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "企业微信应用未配置：请设置 WECOM_CORPID、WECOM_CORPSECRET、WECOM_AGENTID",
      },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  let userid = url.searchParams.get("userid")?.trim() ?? "";

  if (!userid) {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY 未配置，无法从数据库读取 userid" },
        { status: 503 }
      );
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("users")
      .select("wecom_userid")
      .not("wecom_userid", "is", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = data as { wecom_userid: string | null } | null;
    if (!row?.wecom_userid) {
      return NextResponse.json(
        {
          error:
            "请使用 ?userid=企业微信通讯录userid，或先在「成员与企业微信」页为某位成员保存 userid",
        },
        { status: 400 }
      );
    }
    userid = row.wecom_userid;
  }

  try {
    const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    await sendWecomWorkNotice(
      userid,
      "应用消息测试",
      `## 企业微信应用消息测试\n\n来自 issue-tracker 的连通性测试（${ts}）。\n\n收到本条说明企业应用与消息推送配置正常。`
    );

    return NextResponse.json({
      ok: true,
      userid_sent: userid,
      hint: "企业微信侧已发送；请在企业微信「应用」或相关应用消息里查看（非普通单聊）。",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
