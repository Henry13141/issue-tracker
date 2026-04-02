/**
 * Webhook relay:
 *   POST /relay/wecom         -> Redis queue -> worker forwards to WECOM_WEBHOOK_URL (group robot)
 *   POST /relay/wecom-private -> send WeCom app message directly to WECOM_PRIVATE_USERID
 */
import http from "node:http";
import Redis from "ioredis";

const PORT = parseInt(process.env.PORT || "9000", 10);
const REDIS_URL = process.env.REDIS_URL || "";
const WECOM_WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL || "";
const QUEUE_KEY = "webhook:queue:wecom";

// 企业微信应用消息
const WECOM_CORPID = process.env.WECOM_CORPID || "";
const WECOM_CORPSECRET = process.env.WECOM_CORPSECRET || "";
const WECOM_AGENTID = process.env.WECOM_AGENTID || "";
const WECOM_PRIVATE_USERID = process.env.WECOM_PRIVATE_USERID || "";

let wecomTokenCache = null; // { token, expiresAt }

async function getWecomAccessToken() {
  if (wecomTokenCache && wecomTokenCache.expiresAt > Date.now() + 60_000) {
    return wecomTokenCache.token;
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(WECOM_CORPID)}&corpsecret=${encodeURIComponent(WECOM_CORPSECRET)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (j.errcode !== 0) throw new Error(`gettoken failed: ${j.errmsg}`);
  wecomTokenCache = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

async function sendWecomPrivateMessage(text) {
  if (!WECOM_CORPID || !WECOM_CORPSECRET || !WECOM_AGENTID || !WECOM_PRIVATE_USERID) {
    throw new Error("企业微信应用消息环境变量未配置");
  }
  const token = await getWecomAccessToken();
  const r = await fetch(
    `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        touser: WECOM_PRIVATE_USERID,
        msgtype: "text",
        agentid: Number(WECOM_AGENTID),
        text: { content: text },
      }),
    }
  );
  const j = await r.json();
  if (j.errcode !== 0) throw new Error(`message/send failed: ${j.errmsg}`);
}

if (!REDIS_URL) {
  console.error("[webhook-relay] REDIS_URL is required");
  process.exit(1);
}

const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

async function forwardWithRetry(bodyString) {
  if (!WECOM_WEBHOOK_URL) {
    console.error("[webhook-relay] WECOM_WEBHOOK_URL not set; drop message");
    return { ok: false, error: "no_target" };
  }
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(WECOM_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyString,
      });
      if (r.ok) return { ok: true, status: r.status };
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((res) => setTimeout(res, 2 ** i * 1000));
  }
  console.error("[webhook-relay] forward failed after retries", lastErr);
  return { ok: false, error: String(lastErr) };
}

async function workerLoop() {
  for (;;) {
    const item = await redis.brpop(QUEUE_KEY, 0);
    if (!item) continue;
    const payload = item[1];
    await forwardWithRetry(payload);
  }
}

workerLoop().catch((e) => {
  console.error("[webhook-relay] worker fatal", e);
  process.exit(1);
});

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "webhook-relay" }));
    return;
  }

  if (req.method === "POST" && req.url === "/relay/wecom") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    await redis.lpush(QUEUE_KEY, raw.length ? raw : "{}");
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, queued: true }));
    return;
  }

  // 接收 Uptime Kuma Webhook，通过企业微信应用消息发私信给 WECOM_PRIVATE_USERID
  if (req.method === "POST" && req.url === "/relay/wecom-private") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* ignore */ }

    // Uptime Kuma webhook 格式
    const monitorName = body.monitor?.name ?? body.monitorName ?? "未知服务";
    const status = body.heartbeat?.status === 1 ? "✅ 恢复正常" : "🔴 服务故障";
    const msg = body.heartbeat?.status === 1
      ? body.heartbeat?.msg ?? "服务已恢复"
      : body.heartbeat?.msg ?? "服务不可达";
    const text = `【Uptime Kuma 告警】\n${status}\n服务：${monitorName}\n详情：${msg}`;

    try {
      await sendWecomPrivateMessage(text);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      console.error("[webhook-relay] wecom-private failed", e.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("[webhook-relay] listening on", PORT);
});
