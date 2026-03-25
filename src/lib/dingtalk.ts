import { createHmac, randomBytes } from "node:crypto";

const WEBHOOK_URL = process.env.DINGTALK_WEBHOOK_URL;
const APP_KEY = process.env.DINGTALK_APP_KEY;
const APP_SECRET = process.env.DINGTALK_APP_SECRET;
const AGENT_ID = process.env.DINGTALK_AGENT_ID;

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function sendDingtalkMarkdown(title: string, markdown: string) {
  if (!WEBHOOK_URL) return;

  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: { title, text: markdown },
    }),
  });
}

export async function getAccessToken(): Promise<string> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("DINGTALK_APP_KEY / DINGTALK_APP_SECRET 未配置");
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const url = new URL("https://oapi.dingtalk.com/gettoken");
  url.searchParams.set("appkey", APP_KEY);
  url.searchParams.set("appsecret", APP_SECRET);
  const res = await fetch(url.toString());
  const json = (await res.json()) as { errcode: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (json.errcode !== 0 || !json.access_token) {
    throw new Error(json.errmsg ?? `钉钉 gettoken 失败 errcode=${json.errcode}`);
  }
  const ttl = (json.expires_in ?? 7200) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + ttl };
  return json.access_token;
}

/**
 * 发送钉钉工作通知到指定 userid（企业内部应用）
 * @param dingtalkUserid 钉钉通讯录中的 userid，多个用逗号分隔时只发第一个列表项由调用方控制
 */
export async function sendDingtalkWorkNotice(
  dingtalkUserid: string,
  title: string,
  markdown: string
): Promise<{ task_id: number }> {
  if (!AGENT_ID) {
    throw new Error("DINGTALK_AGENT_ID 未配置");
  }
  const accessToken = await getAccessToken();
  const agentIdNum = Number(AGENT_ID);
  if (Number.isNaN(agentIdNum)) {
    throw new Error("DINGTALK_AGENT_ID 必须是数字");
  }
  const msg = JSON.stringify({
    msgtype: "markdown",
    markdown: { title, text: markdown },
  });
  const body = new URLSearchParams();
  body.set("agent_id", String(agentIdNum));
  body.set("userid_list", dingtalkUserid);
  body.set("msg", msg);

  const url = `https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
  const json = (await res.json()) as { errcode: number; errmsg?: string; task_id?: number };
  if (json.errcode !== 0) {
    throw new Error(json.errmsg ?? `钉钉工作通知失败 errcode=${json.errcode}`);
  }
  if (json.task_id == null) {
    throw new Error("钉钉工作通知未返回 task_id");
  }
  return { task_id: json.task_id };
}

export type DingTalkWorkNoticeDelivery = {
  failed_user_id_list?: string[];
  forbidden_list?: string[];
  invalid_user_id_list?: string[];
  invalid_dept_id_list?: string[];
  read_user_id_list?: string[];
  unread_user_id_list?: string[];
};

/**
 * 查询异步工作通知投递结果（建议在发送后等待 1～3 秒再查，仅最近 24 小时内的 task 有效）
 */
export async function getDingTalkWorkNoticeSendResult(taskId: number): Promise<DingTalkWorkNoticeDelivery> {
  if (!AGENT_ID) {
    throw new Error("DINGTALK_AGENT_ID 未配置");
  }
  const accessToken = await getAccessToken();
  const agentIdNum = Number(AGENT_ID);
  const body = new URLSearchParams();
  body.set("agent_id", String(agentIdNum));
  body.set("task_id", String(taskId));

  const url = `https://oapi.dingtalk.com/topapi/message/corpconversation/getsendresult?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
  const json = (await res.json()) as {
    errcode: number;
    errmsg?: string;
    send_result?: DingTalkWorkNoticeDelivery;
  };
  if (json.errcode !== 0) {
    throw new Error(json.errmsg ?? `钉钉查询发送结果失败 errcode=${json.errcode}`);
  }
  return json.send_result ?? {};
}

export function isDingtalkAppConfigured(): boolean {
  return Boolean(APP_KEY && APP_SECRET && AGENT_ID);
}

/** 扫码登录需要 AppKey/AppSecret + 可公网/内网访问的站点根 URL（用于 redirect_uri） */
export function isDingtalkScanLoginConfigured(): boolean {
  return Boolean(APP_KEY && APP_SECRET);
}

/** 个人免登 / 扫码 SNS 签名：HmacSHA256(appSecret, timestamp) → Base64 → URL 编码（钉钉要求替换部分字符） */
export function computeDingtalkSnsSignature(timestamp: string, appSecret: string): string {
  const sig = createHmac("sha256", appSecret).update(timestamp, "utf8").digest("base64");
  return encodeURIComponent(sig)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/~/g, "%7E")
    .replace(/\//g, "%2F");
}

export type DingTalkSnsUserInfo = {
  nick?: string;
  unionid?: string;
  openid?: string;
  main_org_auth_high_level?: boolean;
};

/**
 * 新版 OAuth2：用 authCode 换取用户级 accessToken
 * POST https://api.dingtalk.com/v1.0/oauth2/userAccessToken
 */
export async function getUserTokenByAuthCode(authCode: string): Promise<string> {
  if (!APP_KEY || !APP_SECRET) {
    throw new Error("DINGTALK_APP_KEY / DINGTALK_APP_SECRET 未配置");
  }
  const res = await fetch("https://api.dingtalk.com/v1.0/oauth2/userAccessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: APP_KEY,
      clientSecret: APP_SECRET,
      code: authCode,
      grantType: "authorization_code",
    }),
  });
  const json = (await res.json()) as {
    accessToken?: string;
    code?: string;
    message?: string;
  };
  if (!json.accessToken) {
    throw new Error(json.message ?? `钉钉 userAccessToken 失败: ${json.code}`);
  }
  return json.accessToken;
}

export type DingTalkOAuth2UserInfo = {
  nick?: string;
  unionId?: string;
  openId?: string;
  avatarUrl?: string;
  mobile?: string;
  stateCode?: string;
};

/**
 * 新版 OAuth2：用用户级 accessToken 获取当前用户信息
 * GET https://api.dingtalk.com/v1.0/contact/users/me
 */
export async function getUserInfoByToken(userAccessToken: string): Promise<DingTalkOAuth2UserInfo> {
  const res = await fetch("https://api.dingtalk.com/v1.0/contact/users/me", {
    method: "GET",
    headers: { "x-acs-dingtalk-access-token": userAccessToken },
  });
  const json = (await res.json()) as DingTalkOAuth2UserInfo & { code?: string; message?: string };
  if (!json.unionId) {
    throw new Error(json.message ?? `钉钉获取用户信息失败: ${json.code}`);
  }
  return json;
}

/**
 * 用 unionid 换企业内 userid（与通讯录、工作通知一致）
 */
export async function getCorpUseridByUnionid(unionid: string): Promise<string> {
  const accessToken = await getAccessToken();
  const body = new URLSearchParams();
  body.set("unionid", unionid);
  const url = `https://oapi.dingtalk.com/topapi/user/getbyunionid?access_token=${encodeURIComponent(accessToken)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: body.toString(),
  });
  const json = (await res.json()) as {
    errcode?: number;
    errmsg?: string;
    result?: { userid?: string; contact_type?: number };
  };
  if (json.errcode !== 0 || !json.result?.userid) {
    throw new Error(json.errmsg ?? `钉钉 getbyunionid 失败 errcode=${json.errcode}`);
  }
  return json.result.userid;
}

/**
 * 读取通讯录姓名等（失败时返回 null，由调用方用 nick 兜底）
 */
export async function getCorpUserDetail(userid: string): Promise<{ name: string } | null> {
  try {
    const accessToken = await getAccessToken();
    const url = `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ userid, language: "zh_CN" }),
    });
    const json = (await res.json()) as {
      errcode?: number;
      errmsg?: string;
      result?: { name?: string };
    };
    if (json.errcode !== 0 || !json.result?.name) return null;
    return { name: json.result.name };
  } catch {
    return null;
  }
}

/**
 * 生成自校验 OAuth state（不依赖 Cookie，避免 307 重定向 Set-Cookie 丢失问题）。
 * 格式：{timestamp}.{nonce}.{afterLogin_base64url}.{hmac}
 */
export function generateSelfVerifyingState(afterLogin = "/"): string {
  const ts = Date.now().toString();
  const nonce = randomBytes(16).toString("hex");
  const payload64 = Buffer.from(afterLogin, "utf8").toString("base64url");
  const sig = createHmac("sha256", APP_SECRET || "")
    .update(`${ts}.${nonce}.${payload64}`)
    .digest("hex");
  return `${ts}.${nonce}.${payload64}.${sig}`;
}

/**
 * 校验 state 签名、有效期（10 分钟），返回 afterLogin 路径。
 * 失败返回 null。
 */
export function verifySelfVerifyingState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [ts, nonce, payload64, sig] = parts;

  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > 600_000) return null;

  const expected = createHmac("sha256", APP_SECRET || "")
    .update(`${ts}.${nonce}.${payload64}`)
    .digest("hex");
  if (sig !== expected) return null;

  try {
    return Buffer.from(payload64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

export function getDingtalkAppSecret(): string {
  return APP_SECRET ?? "";
}

export function getDingtalkRobotCode(): string {
  return (process.env.DINGTALK_ROBOT_CODE ?? APP_KEY ?? "").trim();
}

/**
 * 用 downloadCode 换取文件临时下载链接（企业内部应用机器人）
 */
export async function downloadRobotFile(downloadCode: string): Promise<string> {
  const accessToken = await getAccessToken();
  const robotCode = getDingtalkRobotCode();
  if (!robotCode) throw new Error("DINGTALK_ROBOT_CODE / DINGTALK_APP_KEY 未配置");

  const res = await fetch("https://api.dingtalk.com/v1.0/robot/messageFiles/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": accessToken,
    },
    body: JSON.stringify({ downloadCode, robotCode }),
  });
  const json = (await res.json()) as { downloadUrl?: string; code?: string; message?: string };
  if (!json.downloadUrl) {
    throw new Error(json.message ?? `下载机器人文件失败`);
  }
  return json.downloadUrl;
}

export function isDingtalkWebhookConfigured(): boolean {
  return Boolean(WEBHOOK_URL);
}

/** 钉钉建议异步任务在发送后等待 1～3 秒再查投递结果 */
export function dingtalkDeliveryPollDelayMs(): number {
  const n = Number(process.env.DINGTALK_DELIVERY_POLL_DELAY_MS);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

function deliveryHasProblems(result: DingTalkWorkNoticeDelivery): boolean {
  return (
    (result.failed_user_id_list?.length ?? 0) > 0 ||
    (result.invalid_user_id_list?.length ?? 0) > 0 ||
    (result.forbidden_list?.length ?? 0) > 0
  );
}

/**
 * 查询工作通知投递结果并打结构化日志（供 Vercel / 自建日志采集）
 */
export async function logDingTalkWorkNoticeDelivery(taskId: number, context: string): Promise<void> {
  try {
    const result = await getDingTalkWorkNoticeSendResult(taskId);
    const payload = {
      scope: "dingtalk_work_notice_delivery",
      context,
      task_id: taskId,
      result,
      ok: !deliveryHasProblems(result),
    };
    if (deliveryHasProblems(result)) {
      console.warn(JSON.stringify(payload));
    } else if (process.env.DINGTALK_LOG_SUCCESSFUL_DELIVERY === "1") {
      console.info(JSON.stringify(payload));
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        scope: "dingtalk_work_notice_delivery",
        context,
        task_id: taskId,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    );
  }
}

export async function sendDingtalkWorkNoticeAndLogDelivery(
  dingtalkUserid: string,
  title: string,
  markdown: string,
  context: string
): Promise<void> {
  const { task_id } = await sendDingtalkWorkNotice(dingtalkUserid, title, markdown);
  await new Promise((r) => setTimeout(r, dingtalkDeliveryPollDelayMs()));
  await logDingTalkWorkNoticeDelivery(task_id, context);
}
