import { after, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  type AIChatMessage,
  WECOM_INTERNAL_ASSISTANT_SYSTEM_PROMPT,
  chatCompletionFromMessages,
  isAIConfigured,
} from "@/lib/ai";
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
import {
  cancelIssueDraft,
  continueIssueDraftFlow,
  hasActiveIssueDraft,
  startIssueDraftFlow,
} from "@/lib/wecom-issue-intake";
import type { IssuePriority, IssueStatus } from "@/types";

export const dynamic = "force-dynamic";

const HELP_MESSAGE = [
  "## 米伽米问题助手",
  "",
  "1. 直接发文本给我，我会结合最近对话调用 Kimi 回答问题。",
  "2. 在与我的单聊中发送“新建问题”，我会追问必要信息并直接帮你建单。",
  "3. 在与我的单聊中发送 Excel 文件（.xlsx/.xls），我会自动解析并导入为新问题。",
  "4. 发送“取消新建问题”可以退出当前建单流程。",
  "5. 发送“清空上下文”或“重置对话”可以清掉当前记忆。",
  "",
  "支持的表头：标题/问题、描述/情况说明、优先级、状态/完成情况、负责人、截止日期。",
].join("\n");

const KIMI_TIMEOUT_MS = 20_000;
const WECOM_REPLY_LIMIT = 1500;
const MAX_CONTEXT_TURNS = 5;
const MAX_CONTEXT_MESSAGES = MAX_CONTEXT_TURNS * 2;
const HELP_COMMAND_RE = /^(帮助|help)$/i;
const RESET_CONTEXT_RE = /^(清空上下文|重置对话|清除记忆|reset)$/i;
const CREATE_ISSUE_COMMAND_RE = /^(?:新建问题|创建问题|提问题|报问题)(?:[：:]\s*(.+))?$/i;
const CANCEL_CREATE_ISSUE_RE = /^(?:取消新建问题|取消创建问题|退出新建问题|退出创建问题|放弃新建问题)$/i;
const GROUP_ONLY_NOTICE = "当前群聊消息只做单轮回复，不保留上下文记忆。若需要连续对话，请与我单聊。";

type ConversationRole = "user" | "assistant";
type ConversationScope = "single" | "group";
type KimiReplyResult = { reply: string; fromModel: boolean };

type ConversationRow = {
  id: string;
  role: ConversationRole;
  content: string;
};

function extractGroupMentionContent(content: string): string | null {
  const hasMention = /(^|\s)@\S+/.test(content);
  if (!hasMention) return null;

  const normalized = content
    .replace(/(^|\s)@\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function clampReply(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.length <= WECOM_REPLY_LIMIT) return trimmed;
  return `${trimmed.slice(0, WECOM_REPLY_LIMIT)}\n\n[内容较长，已截断]`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getConversationAdminClient() {
  try {
    return createAdminClient();
  } catch (error) {
    console.error("[wecom-robot] create admin client failed:", error);
    return null;
  }
}

async function loadConversationHistory(wecomUserid: string): Promise<AIChatMessage[]> {
  const supabase = getConversationAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wecom_robot_messages")
    .select("role, content")
    .eq("wecom_userid", wecomUserid)
    .order("created_at", { ascending: false })
    .limit(MAX_CONTEXT_MESSAGES);

  if (error) {
    console.error("[wecom-robot] load history failed:", error.message);
    return [];
  }

  return ((data ?? []) as Array<{ role: ConversationRole; content: string }>)
    .reverse()
    .map((item) => ({ role: item.role, content: item.content }));
}

async function pruneConversationHistory(wecomUserid: string) {
  const supabase = getConversationAdminClient();
  if (!supabase) return;

  const { data, error } = await supabase
    .from("wecom_robot_messages")
    .select("id")
    .eq("wecom_userid", wecomUserid)
    .order("created_at", { ascending: false })
    .range(MAX_CONTEXT_MESSAGES, MAX_CONTEXT_MESSAGES + 200);

  if (error) {
    console.error("[wecom-robot] prune history query failed:", error.message);
    return;
  }

  const ids = ((data ?? []) as ConversationRow[]).map((item) => item.id);
  if (ids.length === 0) return;

  const { error: deleteError } = await supabase
    .from("wecom_robot_messages")
    .delete()
    .in("id", ids);

  if (deleteError) {
    console.error("[wecom-robot] prune history delete failed:", deleteError.message);
  }
}

async function saveConversationTurn(wecomUserid: string, userContent: string, assistantContent: string) {
  const supabase = getConversationAdminClient();
  if (!supabase) return;

  const { error } = await supabase.from("wecom_robot_messages").insert([
    { wecom_userid: wecomUserid, role: "user", content: userContent },
    { wecom_userid: wecomUserid, role: "assistant", content: assistantContent },
  ]);

  if (error) {
    console.error("[wecom-robot] save history failed:", error.message);
    return;
  }

  await pruneConversationHistory(wecomUserid);
}

async function clearConversationHistory(wecomUserid: string): Promise<boolean> {
  const supabase = getConversationAdminClient();
  if (!supabase) return false;

  const { error } = await supabase
    .from("wecom_robot_messages")
    .delete()
    .eq("wecom_userid", wecomUserid);

  if (error) {
    console.error("[wecom-robot] clear history failed:", error.message);
    return false;
  }

  return true;
}

function extractConversationScope(msgXml: string): ConversationScope {
  const chatType =
    extractXmlField(msgXml, "ChatType") ||
    extractXmlField(msgXml, "chattype");
  const chatId =
    extractXmlField(msgXml, "ChatId") ||
    extractXmlField(msgXml, "chatid");

  if (chatType.toLowerCase() === "group" || Boolean(chatId)) {
    return "group";
  }

  return "single";
}

async function buildKimiReply(
  wecomUserid: string,
  content: string,
  conversationScope: ConversationScope
): Promise<KimiReplyResult> {
  if (!content.trim()) {
    return {
      reply: `没有识别到有效文本内容。发送“帮助”可查看我支持的能力。`,
      fromModel: false,
    };
  }

  if (!isAIConfigured()) {
    return {
      reply: "当前未配置 MOONSHOT_API_KEY，暂时无法调用 Kimi。发送“帮助”可查看其他可用能力。",
      fromModel: false,
    };
  }

  const history = conversationScope === "single"
    ? await loadConversationHistory(wecomUserid)
    : [];
  const messages: AIChatMessage[] = [
    { role: "system", content: WECOM_INTERNAL_ASSISTANT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content },
  ];

  const result = await withTimeout(
    chatCompletionFromMessages(messages, {
      maxTokens: 700,
      disableThinking: true,
    }),
    KIMI_TIMEOUT_MS
  );

  if (!result) {
    return {
      reply: "这次没有成功从 Kimi 获取回复，可能是超时或服务暂时不可用，请稍后再试。",
      fromModel: false,
    };
  }

  const reply = clampReply(result);
  if (!reply) {
    return {
      reply: "Kimi 这次没有返回可发送的内容，请换个问法再试一次。",
      fromModel: false,
    };
  }

  return { reply, fromModel: true };
}

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

function getMessageIdentifier(msgXml: string) {
  return extractXmlField(msgXml, "MsgId")
    || extractXmlField(msgXml, "Msgid")
    || `${extractXmlField(msgXml, "FromUserName")}:${extractXmlField(msgXml, "CreateTime")}`;
}

async function processIncomingMessage(msgXml: string) {
  const msgType = extractXmlField(msgXml, "MsgType");
  const fromUser = extractXmlField(msgXml, "FromUserName");
  const conversationScope = extractConversationScope(msgXml);
  const contextEnabled = conversationScope === "single";
  const messageId = getMessageIdentifier(msgXml);

  console.info("[wecom-robot] processing message", {
    fromUser,
    msgType,
    conversationScope,
    messageId,
  });

  if (msgType === "text") {
    const rawContent = extractXmlField(msgXml, "Content").trim();
    const content = contextEnabled
      ? rawContent
      : extractGroupMentionContent(rawContent);

    if (!contextEnabled && content === null) {
      return;
    }

    if (!content) {
      await replyMarkdown(fromUser, `请在 @我 后输入问题。\n\n${GROUP_ONLY_NOTICE}`);
      return;
    }

    if (HELP_COMMAND_RE.test(content)) {
      await replyMarkdown(
        fromUser,
        contextEnabled ? HELP_MESSAGE : `${HELP_MESSAGE}\n\n${GROUP_ONLY_NOTICE}`
      );
      return;
    }

    if (RESET_CONTEXT_RE.test(content)) {
      if (!contextEnabled) {
        await replyMarkdown(fromUser, GROUP_ONLY_NOTICE);
      } else {
        const cleared = await clearConversationHistory(fromUser);
        const cancelledDraft = await cancelIssueDraft(fromUser);
        await replyMarkdown(
          fromUser,
          cleared
            ? cancelledDraft
              ? "已清空当前上下文记忆，并取消了正在进行的新建问题。接下来我会把你的下一条消息当作新对话来处理。"
              : "已清空当前上下文记忆。接下来我会把你的下一条消息当作新对话来处理。"
            : "清空上下文失败，请稍后再试。"
        );
      }
      return;
    }

    const createIssueMatch = CREATE_ISSUE_COMMAND_RE.exec(content);
    if (!contextEnabled && createIssueMatch) {
      await replyMarkdown(fromUser, `新建问题目前只支持与我单聊。\n\n${GROUP_ONLY_NOTICE}`);
      return;
    }

    if (contextEnabled && CANCEL_CREATE_ISSUE_RE.test(content)) {
      const cancelled = await cancelIssueDraft(fromUser);
      await replyMarkdown(
        fromUser,
        cancelled
          ? "好的，已取消这次新建问题。你之后再发“新建问题”就可以重新开始。"
          : "当前没有进行中的新建问题。你直接发“新建问题”即可开始。"
      );
      return;
    }

    if (contextEnabled && createIssueMatch) {
      const initialInput = createIssueMatch[1]?.trim() || undefined;
      const reply = await startIssueDraftFlow(fromUser, initialInput);
      await replyMarkdown(fromUser, reply);
      return;
    }

    if (contextEnabled && await hasActiveIssueDraft(fromUser)) {
      const reply = await continueIssueDraftFlow(fromUser, content);
      await replyMarkdown(fromUser, reply);
      return;
    }

    const { reply, fromModel } = await buildKimiReply(fromUser, content, conversationScope);
    const finalReply = contextEnabled ? reply : `${reply}\n\n${GROUP_ONLY_NOTICE}`;
    if (fromModel && contextEnabled) {
      await saveConversationTurn(fromUser, content, reply);
    }
    await replyMarkdown(fromUser, finalReply);
    return;
  }

  if (msgType === "file") {
    const mediaId = extractXmlField(msgXml, "MediaId");
    const fileName = extractXmlField(msgXml, "FileName") || "文件";

    if (!mediaId) {
      await replyMarkdown(fromUser, "未获取到文件 media_id，请重新发送。");
      return;
    }

    const isExcel = /\.(xlsx?|csv)$/i.test(fileName);
    if (!isExcel) {
      await replyMarkdown(fromUser, `仅支持 .xlsx / .xls 文件，收到的是「${fileName}」。`);
      return;
    }

    let creatorId = await findCreatorId(fromUser);
    if (!creatorId) {
      creatorId = await getFirstAdminId();
    }
    if (!creatorId) {
      await replyMarkdown(fromUser, "系统中没有找到你的账号，也没有管理员账号，无法导入。");
      return;
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
  const VALID_S: IssueStatus[] = ["todo", "in_progress", "blocked", "pending_review", "pending_rework", "resolved", "closed"];

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

  const messageId = getMessageIdentifier(msgXml);
  after(async () => {
    try {
      await processIncomingMessage(msgXml);
      console.info("[wecom-robot] processed message", { messageId });
    } catch (error) {
      console.error("[wecom-robot] process message failed:", {
        messageId,
        error,
      });
    }
  });

  return new Response("", { status: 200 });
}
