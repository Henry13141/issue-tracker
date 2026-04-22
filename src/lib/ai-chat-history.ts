/**
 * AI 对话历史
 *
 * 负责持久化 AI 助手的逐轮对话，以及为学习引擎提供批量读取接口。
 * 所有写操作使用 admin client（绕过 RLS），读操作使用普通 client（受 RLS 限制）。
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type ChatMessageRow = {
  id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type ConversationTurn = {
  user: string;
  assistant: string;
  created_at: string;
};

// 每次打开助手最多加载的历史条数
const MAX_LOAD = 40;

// 学习引擎分析的窗口（天）
const LEARNING_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// 读操作
// ---------------------------------------------------------------------------

/**
 * 加载当前用户最近的对话消息（用于在打开助手时恢复上下文）
 */
export async function loadRecentMessages(userId: string): Promise<ChatMessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_chat_messages")
    .select("id, user_id, role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_LOAD);

  if (error) {
    console.error("[ai-chat-history] loadRecentMessages error:", error.message);
    return [];
  }

  return ((data ?? []) as ChatMessageRow[]).reverse();
}

/**
 * 为学习引擎批量读取近 N 天内所有用户的对话（按用户分组）
 * 返回：userId → ConversationTurn[]
 */
export async function loadConversationsForLearning(): Promise<Map<string, ConversationTurn[]>> {
  const supabase = createAdminClient();
  const since = new Date();
  since.setDate(since.getDate() - LEARNING_WINDOW_DAYS);

  const { data, error } = await supabase
    .from("ai_chat_messages")
    .select("user_id, role, content, created_at")
    .gte("created_at", since.toISOString())
    .order("user_id")
    .order("created_at");

  if (error) {
    console.error("[ai-chat-history] loadConversationsForLearning error:", error.message);
    return new Map();
  }

  const rows = (data ?? []) as Pick<ChatMessageRow, "user_id" | "role" | "content" | "created_at">[];

  // 将 user/assistant 交替的行配对成 ConversationTurn
  const byUser = new Map<string, ConversationTurn[]>();

  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.role === "user" && i + 1 < rows.length && rows[i + 1].role === "assistant" && rows[i + 1].user_id === row.user_id) {
      const turn: ConversationTurn = {
        user:        row.content,
        assistant:   rows[i + 1].content,
        created_at:  row.created_at,
      };
      const arr = byUser.get(row.user_id) ?? [];
      arr.push(turn);
      byUser.set(row.user_id, arr);
      i += 2;
    } else {
      i++;
    }
  }

  return byUser;
}

// ---------------------------------------------------------------------------
// 写操作
// ---------------------------------------------------------------------------

/**
 * 保存一个完整对话轮次（用户消息 + 助手回复）
 * 使用 admin client 写入，不受 RLS 限制。
 */
export async function saveChatTurn(
  userId: string,
  userContent: string,
  assistantContent: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("ai_chat_messages").insert([
    { user_id: userId, role: "user",      content: userContent },
    { user_id: userId, role: "assistant", content: assistantContent },
  ]);
  if (error) {
    console.error("[ai-chat-history] saveChatTurn error:", error.message);
  }
}

/**
 * 清空某个用户的所有对话记录（用户主动"清空对话"时调用）
 */
export async function clearChatHistory(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("ai_chat_messages")
    .delete()
    .eq("user_id", userId);
  if (error) {
    console.error("[ai-chat-history] clearChatHistory error:", error.message);
  }
}

/**
 * 对话历史永久留存，不做定期清理。
 * 此函数保留为空实现，以兼容调用方（cron 学习任务等）。
 */
export async function pruneOldMessages(): Promise<void> {
  // 永久留存，不删除
}
