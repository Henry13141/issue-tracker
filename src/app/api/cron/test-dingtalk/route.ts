import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendDingtalkWorkNotice,
  getDingTalkWorkNoticeSendResult,
  isDingtalkAppConfigured,
} from "@/lib/dingtalk";

export const dynamic = "force-dynamic";

function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (!secret) return true;
  const header = request.headers.get("authorization");
  return vercelCron || header === `Bearer ${secret}`;
}

/**
 * 手动验证钉钉「工作通知」是否打通。
 * - 查询参数 `userid` 可选；不传则从 `users.dingtalk_userid` 取第一条非空。
 * - 鉴权与 daily-reminder 一致：若配置了 CRON_SECRET 则需 Bearer。
 */
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isDingtalkAppConfigured()) {
    return NextResponse.json(
      {
        error:
          "钉钉企业应用未配置：请设置 DINGTALK_APP_KEY、DINGTALK_APP_SECRET、DINGTALK_AGENT_ID",
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
      .select("dingtalk_userid")
      .not("dingtalk_userid", "is", null)
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const row = data as { dingtalk_userid: string | null } | null;
    if (!row?.dingtalk_userid) {
      return NextResponse.json(
        {
          error:
            "请使用 ?userid=钉钉通讯录userid，或先在「成员与钉钉」页为某位成员保存 userid",
        },
        { status: 400 }
      );
    }
    userid = row.dingtalk_userid;
  }

  try {
    const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    const { task_id } = await sendDingtalkWorkNotice(
      userid,
      "工作通知测试",
      `## 钉钉工作通知测试\n\n来自 issue-tracker 的连通性测试（${ts}）。\n\n收到本条说明企业应用与工作通知配置正常。`
    );
    await new Promise((r) => setTimeout(r, 2500));
    const send_result = await getDingTalkWorkNoticeSendResult(task_id);
    const invalid = send_result.invalid_user_id_list ?? [];
    const failed = send_result.failed_user_id_list ?? [];
    const forbidden = send_result.forbidden_list ?? [];
    const looksUndelivered =
      invalid.length > 0 || failed.length > 0 || (forbidden?.length ?? 0) > 0;

    return NextResponse.json({
      ok: !looksUndelivered,
      task_id,
      userid_sent: userid,
      send_result,
      hint: looksUndelivered
        ? "钉钉未向该 userid 投递：请核对管理后台「通讯录」里的 UserID 是否与填写一致；并检查本企业应用在开放平台「可见范围」是否包含该成员（或设为全公司可见）。"
        : "钉钉侧显示已投递；请在钉钉「工作通知」或应用消息里查看（非普通单聊）。",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
