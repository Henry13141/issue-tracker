import { createHmac, createHash, createDecipheriv, randomBytes } from "node:crypto";
import { fetch as undiciFetch, ProxyAgent } from "undici";

const CORPID = process.env.WECOM_CORPID?.trim();
const CORPSECRET = process.env.WECOM_CORPSECRET?.trim();
const AGENTID = process.env.WECOM_AGENTID?.trim();
const WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL?.trim();
const WECOM_PROXY_URL = process.env.WECOM_PROXY_URL?.trim();
const WECOM_API_BASE_URL = process.env.WECOM_API_BASE_URL?.trim().replace(/\/+$/, "");

const QYAPI_ORIGIN = "https://qyapi.weixin.qq.com";

let cachedToken: { token: string; expiresAt: number } | null = null;
let qyapiProxyAgent: ProxyAgent | undefined;

/**
 * 将 qyapi.weixin.qq.com URL 改写为反向代理 URL（如已配置 WECOM_API_BASE_URL）。
 * 例：https://qyapi.weixin.qq.com/cgi-bin/gettoken → https://hook.megami-tech.com/wecom-api/cgi-bin/gettoken
 */
function rewriteQyapiUrl(url: string): string {
  if (WECOM_API_BASE_URL && url.startsWith(QYAPI_ORIGIN)) {
    return url.replace(QYAPI_ORIGIN, WECOM_API_BASE_URL);
  }
  return url;
}

/**
 * 仅用于 https://qyapi.weixin.qq.com/...。
 * 优先使用 WECOM_API_BASE_URL（反向代理），其次 WECOM_PROXY_URL（HTTP 代理）。
 */
export async function wecomQyapiFetch(
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  const url = rewriteQyapiUrl(String(input));

  if (url !== String(input)) {
    return fetch(url, init);
  }

  if (WECOM_PROXY_URL) {
    if (!qyapiProxyAgent) {
      qyapiProxyAgent = new ProxyAgent(WECOM_PROXY_URL);
    }
    return undiciFetch(input, {
      ...(init as object),
      dispatcher: qyapiProxyAgent,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Response;
  }
  return fetch(input, init);
}

// ─── 群机器人 Webhook（群消息）────────────────────────────────────────────────

/** 向群机器人 Webhook 发送 Markdown 消息 */
export async function sendWecomMarkdown(content: string) {
  if (!WEBHOOK_URL) return;
  await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown: { content } }),
  });
}

/** 向群机器人 Webhook 发送纯文本（企业微信单条上限约 2048 字节） */
export async function sendWecomWebhookText(
  content: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!WEBHOOK_URL) {
    return { ok: false, error: "WECOM_WEBHOOK_URL 未配置" };
  }
  const trimmed = content.trim();
  if (!trimmed) {
    return { ok: false, error: "消息内容为空" };
  }
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content: trimmed } }),
  });
  let json: { errcode?: number; errmsg?: string } = {};
  try {
    json = (await res.json()) as { errcode?: number; errmsg?: string };
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  if (json.errcode !== undefined && json.errcode !== 0) {
    return { ok: false, error: json.errmsg ?? `errcode=${json.errcode}` };
  }
  return { ok: true };
}

// ─── Access Token ──────────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<string> {
  if (!CORPID || !CORPSECRET) {
    throw new Error("WECOM_CORPID / WECOM_CORPSECRET 未配置");
  }
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(CORPID)}&corpsecret=${encodeURIComponent(CORPSECRET)}`;
  const res = await wecomQyapiFetch(url);
  const json = (await res.json()) as {
    errcode: number;
    errmsg?: string;
    access_token?: string;
    expires_in?: number;
  };
  if (json.errcode !== 0 || !json.access_token) {
    throw new Error(json.errmsg ?? `企业微信 gettoken 失败 errcode=${json.errcode}`);
  }
  const ttl = (json.expires_in ?? 7200) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + ttl };
  return json.access_token;
}

// ─── 应用消息（工作通知）────────────────────────────────────────────────────────

/** 将 Markdown 语法转为纯文本（text 消息兼容个人微信） */
export function stripMarkdown(md: string): string {
  return md
    .replace(/^#{1,6}\s+/gm, "")       // ## 标题
    .replace(/\*\*(.+?)\*\*/g, "$1")    // **加粗**
    .replace(/\*(.+?)\*/g, "$1")        // *斜体*
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2") // [文字](链接)
    .replace(/^>\s?/gm, "")             // > 引用
    .replace(/`([^`]+)`/g, "$1");       // `代码`
}

/**
 * 向企业微信成员发送应用消息（text 类型，兼容个人微信 / 微信插件）
 * @param wecomUserid 企业微信通讯录 userid，多人用 | 分隔
 */
export async function sendWecomWorkNotice(
  wecomUserid: string,
  title: string,
  markdown: string
): Promise<void> {
  if (!AGENTID) throw new Error("WECOM_AGENTID 未配置");
  const agentid = Number(AGENTID);
  if (Number.isNaN(agentid)) throw new Error("WECOM_AGENTID 必须是数字");
  const accessToken = await getAccessToken();

  const plain = stripMarkdown(markdown);
  const content = title ? `【${title}】\n\n${plain}` : plain;

  const res = await wecomQyapiFetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: wecomUserid,
        msgtype: "text",
        agentid,
        text: { content },
      }),
    }
  );
  const json = (await res.json()) as { errcode: number; errmsg?: string };
  if (json.errcode !== 0) {
    throw new Error(json.errmsg ?? `企业微信发送消息失败 errcode=${json.errcode}`);
  }
}

// 企业微信应用消息没有异步 task_id 投递查询；失败直接抛出，成功即已投递
export async function sendWecomWorkNoticeAndLog(
  wecomUserid: string,
  title: string,
  markdown: string,
  context: string
): Promise<void> {
  try {
    await sendWecomWorkNotice(wecomUserid, title, markdown);
    if (process.env.WECOM_LOG_SUCCESSFUL_DELIVERY === "1") {
      console.info(
        JSON.stringify({ scope: "wecom_work_notice_delivery", context, ok: true })
      );
    }
  } catch (e) {
    console.warn(
      JSON.stringify({
        scope: "wecom_work_notice_delivery",
        context,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    );
    throw e;
  }
}

// ─── 配置检查 ─────────────────────────────────────────────────────────────────

export function isWecomAppConfigured(): boolean {
  return Boolean(CORPID && CORPSECRET && AGENTID);
}

export function isWecomWebhookConfigured(): boolean {
  return Boolean(WEBHOOK_URL);
}

/** 扫码登录需要 CORPID + AGENTID */
export function isWecomScanLoginConfigured(): boolean {
  return Boolean(CORPID && AGENTID);
}

export function getWecomCorpId(): string {
  return CORPID ?? "";
}

export function getWecomAgentId(): string {
  return AGENTID ?? "";
}

// ─── OAuth 扫码登录 State（自校验，避免 Cookie 丢失）─────────────────────────

/**
 * 生成自校验 OAuth state（HMAC-SHA256 with WECOM_CORPSECRET）
 * 格式：{timestamp}.{nonce}.{afterLogin_base64url}.{hmac}
 */
export function generateSelfVerifyingState(afterLogin = "/"): string {
  const ts = Date.now().toString();
  const nonce = randomBytes(16).toString("hex");
  const payload64 = Buffer.from(afterLogin, "utf8").toString("base64url");
  const sig = createHmac("sha256", CORPSECRET || "")
    .update(`${ts}.${nonce}.${payload64}`)
    .digest("hex");
  return `${ts}.${nonce}.${payload64}.${sig}`;
}

/** 校验 state 签名与有效期（10 分钟），返回 afterLogin 路径；失败返回 null */
export function verifySelfVerifyingState(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 4) return null;
  const [ts, nonce, payload64, sig] = parts;
  const age = Date.now() - parseInt(ts, 10);
  if (Number.isNaN(age) || age < 0 || age > 600_000) return null;
  const expected = createHmac("sha256", CORPSECRET || "")
    .update(`${ts}.${nonce}.${payload64}`)
    .digest("hex");
  if (sig !== expected) return null;
  try {
    return Buffer.from(payload64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

// ─── OAuth：通过 code 获取用户信息 ────────────────────────────────────────────

export type WecomUserInfo = {
  UserId?: string;
  OpenId?: string;
  DeviceId?: string;
};

/** 用 code 换取企业内部用户信息（需配置 WECOM_CORPID + WECOM_CORPSECRET + WECOM_AGENTID） */
export async function getUserInfoByCode(code: string): Promise<WecomUserInfo> {
  const accessToken = await getAccessToken();
  const res = await wecomQyapiFetch(
    `https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${encodeURIComponent(accessToken)}&code=${encodeURIComponent(code)}`
  );
  const json = (await res.json()) as WecomUserInfo & { errcode?: number; errmsg?: string };
  if (json.errcode !== undefined && json.errcode !== 0) {
    throw new Error(json.errmsg ?? `企业微信获取用户信息失败 errcode=${json.errcode}`);
  }
  if (!json.UserId) {
    throw new Error("未获取到企业内 UserId，该用户可能为企业外部联系人");
  }
  return json;
}

export type WecomUserDetail = {
  name?: string;
  userid?: string;
  avatar?: string;
};

/** 通过 userid 获取成员详细信息（如姓名） */
export async function getUserDetailByUserid(userid: string): Promise<WecomUserDetail | null> {
  try {
    const accessToken = await getAccessToken();
    const res = await wecomQyapiFetch(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${encodeURIComponent(accessToken)}&userid=${encodeURIComponent(userid)}`
    );
    const json = (await res.json()) as WecomUserDetail & { errcode?: number; errmsg?: string };
    if (json.errcode !== undefined && json.errcode !== 0) return null;
    return json;
  } catch {
    return null;
  }
}

// ─── 机器人回调验签与 AES 解密 ────────────────────────────────────────────────

const WECOM_TOKEN = process.env.WECOM_TOKEN;
const WECOM_AES_KEY = process.env.WECOM_ENCODING_AES_KEY;

/** SHA1 验签：sort([token, timestamp, nonce, ...extras]).join('') */
export function verifyWecomSignature(
  timestamp: string,
  nonce: string,
  signature: string,
  ...extras: string[]
): boolean {
  if (!WECOM_TOKEN) return false;
  const parts = [WECOM_TOKEN, timestamp, nonce, ...extras].sort().join("");
  const expected = createHash("sha1").update(parts).digest("hex");
  return expected === signature;
}

/** AES-256-CBC 解密企业微信消息体，返回 XML 字符串 */
export function decryptWecomMessage(encrypted: string): string {
  if (!WECOM_AES_KEY) throw new Error("WECOM_ENCODING_AES_KEY 未配置");
  const key = Buffer.from(WECOM_AES_KEY + "=", "base64");
  const iv = key.slice(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const buf = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]);
  // PKCS7 去填充
  const padLen = buf[buf.length - 1];
  const unpadded = buf.slice(0, buf.length - padLen);
  // 跳过 16 字节随机串，读 4 字节消息长度
  const msgLen = unpadded.readUInt32BE(16);
  return unpadded.slice(20, 20 + msgLen).toString("utf8");
}

/** 简单提取 CDATA XML 标签值 */
export function extractXmlField(xml: string, tag: string): string {
  const m = xml.match(
    new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([^<]*)<\\/${tag}>`)
  );
  return m ? (m[1] ?? m[2] ?? "") : "";
}

/** 通过 media_id 下载机器人收到的文件，返回临时下载 URL */
export async function downloadRobotMedia(mediaId: string): Promise<ArrayBuffer> {
  const accessToken = await getAccessToken();
  const res = await wecomQyapiFetch(
    `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(accessToken)}&media_id=${encodeURIComponent(mediaId)}`
  );
  if (!res.ok) throw new Error(`企业微信下载媒体文件失败 HTTP ${res.status}`);
  return res.arrayBuffer();
}
