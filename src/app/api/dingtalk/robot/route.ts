import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getDingtalkAppSecret,
  isDingtalkAppConfigured,
  downloadRobotFile,
} from "@/lib/dingtalk";
import { parseExcelBuffer } from "@/lib/parse-excel";
import { getIssueDetailUrl } from "@/lib/app-url";
import type { IssuePriority, IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* 签名校验                                                           */
/* ------------------------------------------------------------------ */
function verifySign(timestamp: string, sign: string): boolean {
  const secret = getDingtalkAppSecret();
  if (!secret) return false;
  const now = Date.now();
  const ts = Number(timestamp);
  if (Math.abs(now - ts) > 3600_000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}\n${secret}`)
    .digest("base64");
  return expected === sign;
}

/* ------------------------------------------------------------------ */
/* 通过 sessionWebhook 回复消息                                        */
/* ------------------------------------------------------------------ */
async function reply(sessionWebhook: string, markdown: { title: string; text: string }) {
  await fetch(sessionWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "markdown", markdown }),
  });
}

async function replyText(sessionWebhook: string, content: string) {
  await fetch(sessionWebhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "text", text: { content } }),
  });
}

/* ------------------------------------------------------------------ */
/* 查找发送者对应的系统用户                                             */
/* ------------------------------------------------------------------ */
async function findCreatorId(senderStaffId: string): Promise<string | null> {
  if (!senderStaffId) return null;
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("dingtalk_userid", senderStaffId)
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
/* 导入 Excel                                                         */
/* ------------------------------------------------------------------ */
async function importExcel(
  downloadCode: string,
  creatorId: string
): Promise<{ count: number; titles: string[] }> {
  const downloadUrl = await downloadRobotFile(downloadCode);
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`下载文件失败 HTTP ${res.status}`);
  const buf = await res.arrayBuffer();

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
/* POST handler                                                        */
/* ------------------------------------------------------------------ */
export async function POST(request: Request) {
  if (!isDingtalkAppConfigured()) {
    return NextResponse.json({ msgtype: "text", text: { content: "钉钉企业应用未配置" } });
  }

  const timestamp = request.headers.get("timestamp") ?? "";
  const sign = request.headers.get("sign") ?? "";
  if (!verifySign(timestamp, sign)) {
    return NextResponse.json({ error: "签名校验失败" }, { status: 403 });
  }

  const body = await request.json();
  const {
    msgtype,
    text,
    content,
    senderStaffId,
    sessionWebhook,
    senderNick,
    conversationType,
  } = body as {
    msgtype: string;
    text?: { content?: string };
    content?: { downloadCode?: string; fileName?: string };
    senderStaffId?: string;
    sessionWebhook?: string;
    senderNick?: string;
    conversationType?: string;
  };

  if (!sessionWebhook) {
    return NextResponse.json({ msgtype: "text", text: { content: "缺少 sessionWebhook" } });
  }

  if (msgtype === "text") {
    const txt = (text?.content ?? "").trim();
    if (/帮助|help|你好/i.test(txt)) {
      await reply(sessionWebhook, {
        title: "机器人帮助",
        text: [
          "## 米伽米工单机器人",
          "",
          "**导入问题**：在与我的单聊中发送 Excel 文件（.xlsx/.xls），我会自动解析并导入为新问题。",
          "",
          "**支持的表头**：标题/问题、描述/情况说明、优先级、状态/完成情况、负责人、截止日期。",
          "",
          "> 注意：群聊中 @我 仅支持文本消息；**发送文件请用单聊**。",
        ].join("\n"),
      });
    } else {
      await replyText(
        sessionWebhook,
        `收到！回复"帮助"查看我能做什么。\n\n导入问题：请在单聊中直接发送 Excel 文件给我。`
      );
    }
    return NextResponse.json({ msgtype: "empty" });
  }

  if (msgtype === "file") {
    if (conversationType === "2") {
      await replyText(sessionWebhook, "群聊中不支持接收文件，请在与我的单聊中发送 Excel。");
      return NextResponse.json({ msgtype: "empty" });
    }

    const downloadCode = content?.downloadCode;
    const fileName = content?.fileName ?? "";
    if (!downloadCode) {
      await replyText(sessionWebhook, "未获取到文件下载码，请重新发送。");
      return NextResponse.json({ msgtype: "empty" });
    }

    const isExcel = /\.(xlsx?|csv)$/i.test(fileName);
    if (!isExcel) {
      await replyText(sessionWebhook, `仅支持 .xlsx / .xls 文件，收到的是「${fileName}」。`);
      return NextResponse.json({ msgtype: "empty" });
    }

    let creatorId = await findCreatorId(senderStaffId ?? "");
    if (!creatorId) {
      creatorId = await getFirstAdminId();
    }
    if (!creatorId) {
      await replyText(sessionWebhook, "系统中没有找到你的账号，也没有管理员账号，无法导入。");
      return NextResponse.json({ msgtype: "empty" });
    }

    try {
      const { count, titles } = await importExcel(downloadCode, creatorId);
      const preview = titles.slice(0, 5).map((t, i) => `${i + 1}. ${t}`).join("\n");
      const more = count > 5 ? `\n…共 ${count} 条` : "";
      const detailHint = getIssueDetailUrl("") ? "\n\n在系统中查看：" + getIssueDetailUrl("").replace(/\/$/, "") : "";
      await reply(sessionWebhook, {
        title: `导入成功 ${count} 条`,
        text: [
          `## 导入成功`,
          "",
          `从 **${fileName}** 解析并创建了 **${count}** 条问题：`,
          "",
          preview + more,
          "",
          `创建人：${senderNick ?? "机器人"}`,
          detailHint,
        ].join("\n"),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[dingtalk-robot] import failed:", msg);
      await replyText(sessionWebhook, `导入失败：${msg}`);
    }

    return NextResponse.json({ msgtype: "empty" });
  }

  await replyText(
    sessionWebhook,
    `暂不支持此消息类型（${msgtype}）。\n\n导入问题请在单聊中发送 Excel 文件；回复"帮助"查看更多。`
  );
  return NextResponse.json({ msgtype: "empty" });
}
