import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/dingtalk";

export const dynamic = "force-dynamic";

const AGENT_ID = process.env.DINGTALK_AGENT_ID!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

const USERS = [
  "0113566156491177224",   // 郝毅
  "1938652254845431",      // 方锐
  "01064659504226268137",  // 李梦威
  "224464334126278491",    // 李梦艳
];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (secret) {
    const header = request.headers.get("authorization");
    if (!vercelCron && header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!AGENT_ID) {
    return NextResponse.json({ error: "DINGTALK_AGENT_ID 未配置" }, { status: 503 });
  }

  const accessToken = await getAccessToken();
  const loginUrl = APP_URL ? `${APP_URL}/login` : "https://issue-tracker-nu-sandy.vercel.app/login";

  const msg = JSON.stringify({
    msgtype: "markdown",
    markdown: {
      title: "请注册米伽米工单管理系统",
      text: [
        "## 请注册米伽米工单管理系统",
        "",
        "各位同事好！",
        "",
        "我们启用了米伽米工单管理系统，用于管理日常工单与协同催办。**请在今天完成注册**，之后你会通过钉钉收到工单指派和进度提醒。",
        "",
        `### [点击这里注册](${loginUrl})`,
        "",
        "**请用电脑浏览器打开以上链接**",
        "",
        "- 注册时**姓名请填写真实姓名**，方便系统匹配",
        "- 注册完成后即可查看和更新问题",
        "",
        "如有疑问请联系郝毅。",
      ].join("\n"),
    },
  });

  const body = new URLSearchParams();
  body.set("agent_id", AGENT_ID);
  body.set("userid_list", USERS.join(","));
  body.set("msg", msg);

  const res = await fetch(
    `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: body.toString(),
    }
  );
  const json = await res.json();

  return NextResponse.json({
    ok: json.errcode === 0,
    task_id: json.task_id,
    errmsg: json.errmsg,
    notified: USERS.length,
  });
}
