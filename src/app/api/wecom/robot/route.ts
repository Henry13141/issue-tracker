import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isWecomAppConfigured,
  verifyWecomSignature,
  decryptWecomMessage,
  extractXmlField,
  downloadRobotMedia,
  sendWecomWorkNotice,
} from "@/lib/wecom";
import { parseExcelBuffer } from "@/lib/parse-excel";
import { getIssueDetailUrl } from "@/lib/app-url";
import type { IssuePriority, IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* 查找发送者对应的系统用户                                             */
/* ------------------------------------------------------------------ */
async function findCreatorId(wecomUserid: string): Promise<string | null> {
  if (!wecomUserid) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("wecom_userid", wecomUserid)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function getFirstAdminId(): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/* ------------------------------------------------------------------ */
/* 回复消息给发送者                                                     */
/* ------------------------------------------------------------------ */
async function replyMarkdown(touser: string, content: string) {
  try {
    await sendWecomWorkNotice(touser, "", content);
  } catch (e) {
    console.error("[wecom-robot] reply failed:", e);
  }
}

/* ------------------------------------------------------------------ */
/* 导入 Excel                                                         */
/* ------------------------------------------------------------------ */
async function importExcel(
  mediaId: string,
  creatorId: string
): Promise<{ count: number; titles: string[] }> {
  const buf = await downloadRobotMedia(mediaId);

  const rows = parseExcelBuffer(buf);
  if (rows.length === 0) throw new Error("未找到有效数据（需要包含「标题」或「问题」列）");

  const supabase = createAdminClient();
  const needsLookup = rows.some((r) => r.assignee_name?.trim());
  let memberMap: Map<string, string> | undefined;
  if (needsLookup) {
    const { data: members } = await supabase.from("users").select("id, name");
    memberMap = new Map((members ?? []).map((m) => [m.name as string, m.id as string]));
  }

  const VALID_P: IssuePriority[] = ["low", "medium", "high", "urgent"];
  const VALID_S: IssueStatus[] = ["todo", "in_progress", "blocked", "pending_review", "resolved", "closed"];

  const inserts = rows.map((r) => ({
    title: r.title.trim(),
    description: r.description?.trim() || null,
    priority: (VALID_P.includes(r.priority) ? r.priority : "medium") as IssuePriority,
    status: (VALID_S.includes(r.status) ? r.status : "todo") as IssueStatus,
    assignee_id: (r.assignee_name && memberMap?.get(r.assignee_name.trim())) || null,
    due_date: r.due_date || null,
    creator_id: creatorId,
  }));

  const { data: inserted, error } = await supabase.from("issues").insert(inserts).select("id, title");
  if (error) throw new Error(error.message);

  return {
    count: inserted?.length ?? inserts.length,
    titles: (inserted ?? []).map((i) => i.title as string),
  };
}

/* ------------------------------------------------------------------ */
/* GET：企业微信服务器验证                                             */
/* ------------------------------------------------------------------ */
export async function GET(request: Request) {
  if (!isWecomAppConfigured()) {
    return new Response("企业微信应用未配置", { status: 503 });
  }

  const url = new URL(request.url);
  const msgSignature = url.searchParams.get("msg_signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const echostr = url.searchParams.get("echostr") ?? "";

  if (!verifyWecomSignature(timestamp, nonce, msgSignature, echostr)) {
    return new Response("签名验证失败", { status: 403 });
  }

  try {
    const plainEchostr = decryptWecomMessage(echostr);
    return new Response(plainEchostr, { status: 200 });
  } catch (e) {
    console.error("[wecom-robot] echostr 解密失败:", e);
    return new Response("解密失败", { status: 500 });
  }
}

/* ------------------------------------------------------------------ */
/* POST：接收企业微信消息                                              */
/* ------------------------------------------------------------------ */
export async function POST(request: Request) {
  if (!isWecomAppConfigured()) {
    return NextResponse.json({ error: "企业微信应用未配置" }, { status: 503 });
  }

  const url = new URL(request.url);
  const msgSignature = url.searchParams.get("msg_signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";

  // 读取 XML 消息体
  const rawBody = await request.text();

  // 提取加密消息体并验签
  const encrypt = extractXmlField(rawBody, "Encrypt");
  if (!encrypt) {
    return new Response("", { status: 200 });
  }

  if (!verifyWecomSignature(timestamp, nonce, msgSignature, encrypt)) {
    console.warn("[wecom-robot] 消息签名验证失败");
    return new Response("", { status: 200 });
  }

  let msgXml: string;
  try {
    msgXml = decryptWecomMessage(encrypt);
  } catch (e) {
    console.error("[wecom-robot] 消息解密失败:", e);
    return new Response("", { status: 200 });
  }

  const msgType = extractXmlField(msgXml, "MsgType");
  const fromUser = extractXmlField(msgXml, "FromUserName");

  if (msgType === "text") {
    const content = extractXmlField(msgXml, "Content").trim();
    if (/帮助|help|你好/i.test(content)) {
      await replyMarkdown(
        fromUser,
        [
          "## 米伽米工单机器人",
          "",
          "**导入问题**：在与我的单聊中发送 Excel 文件（.xlsx/.xls），我会自动解析并导入为新问题。",
          "",
          "**支持的表头**：标题/问题、描述/情况说明、优先级、状态/完成情况、负责人、截止日期。",
        ].join("\n")
      );
    } else {
      await replyMarkdown(
        fromUser,
        `收到！回复"帮助"查看我能做什么。\n\n导入问题：请在单聊中直接发送 Excel 文件给我。`
      );
    }
    return new Response("", { status: 200 });
  }

  if (msgType === "file") {
    const mediaId = extractXmlField(msgXml, "MediaId");
    const fileName = extractXmlField(msgXml, "FileName") || "文件";

    if (!mediaId) {
      await replyMarkdown(fromUser, "未获取到文件 media_id，请重新发送。");
      return new Response("", { status: 200 });
    }

    const isExcel = /\.(xlsx?|csv)$/i.test(fileName);
    if (!isExcel) {
      await replyMarkdown(fromUser, `仅支持 .xlsx / .xls 文件，收到的是「${fileName}」。`);
      return new Response("", { status: 200 });
    }

    let creatorId = await findCreatorId(fromUser);
    if (!creatorId) {
      creatorId = await getFirstAdminId();
    }
    if (!creatorId) {
      await replyMarkdown(fromUser, "系统中没有找到你的账号，也没有管理员账号，无法导入。");
      return new Response("", { status: 200 });
    }

    try {
      const { count, titles } = await importExcel(mediaId, creatorId);
      const preview = titles.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join("\n");
      const more = count > 5 ? `\n…共 ${count} 条` : "";
      const detailHint = getIssueDetailUrl("") ? "\n\n在系统中查看：" + getIssueDetailUrl("").replace(/\/$/, "") : "";
      await replyMarkdown(
        fromUser,
        [
          `## 导入成功`,
          "",
          `从 **${fileName}** 解析并创建了 **${count}** 条问题：`,
          "",
          preview + more,
          detailHint,
        ].join("\n")
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[wecom-robot] import failed:", msg);
      await replyMarkdown(fromUser, `导入失败：${msg}`);
    }

    return new Response("", { status: 200 });
  }

  // 其他消息类型忽略
  return new Response("", { status: 200 });
}
