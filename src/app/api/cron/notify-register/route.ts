import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/wecom";

export const dynamic = "force-dynamic";

const AGENTID = process.env.WECOM_AGENTID!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

// 替换为企业微信通讯录中的实际 userid
const USERS = [
  "HaoYi",        // 郝毅（占位，请替换为企业微信通讯录 userid）
  "FangRui",      // 方锐
  "LiMengwei",    // 李梦威
  "LiMengyan",    // 李梦艳
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

  if (!AGENTID) {
    return NextResponse.json({ error: "WECOM_AGENTID 未配置" }, { status: 503 });
  }

  const accessToken = await getAccessToken();
  const loginUrl = APP_URL ? `${APP_URL}/login` : "https://issue-tracker-nu-sandy.vercel.app/login";

  const content = [
    "## 请注册米伽米问题追踪系统",
    "",
    "各位同事好！",
    "",
    "我们启用了米伽米问题追踪系统，用于管理日常问题和协同催办。**请在今天完成注册**，之后你会通过企业微信收到问题指派和进度提醒。",
    "",
    `### [点击这里注册](${loginUrl})`,
    "",
    "**请用电脑浏览器打开以上链接**",
    "",
    "- 注册时**姓名请填写真实姓名**，方便系统匹配",
    "- 注册完成后即可查看和更新问题",
    "- 收到提醒后请及时帮忙处理问题，有阻塞可在系统里直接说明",
    "",
    "如有疑问请联系郝毅。",
  ].join("\n");

  const res = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: USERS.join("|"),
        msgtype: "markdown",
        agentid: Number(AGENTID),
        markdown: { content },
      }),
    }
  );
  const json = await res.json();

  return NextResponse.json({
    ok: json.errcode === 0,
    errmsg: json.errmsg,
    notified: USERS.length,
  });
}
