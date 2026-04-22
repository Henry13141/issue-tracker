"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { Bot, Send, Loader2, ChevronDown, Sparkles, BrainCircuit, History } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatWithAssistant, getChatHistory, clearMyChatHistory } from "@/actions/ai";
import type { AssistantMessage } from "@/actions/ai";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

type Message = AssistantMessage & {
  id: string;
  error?: boolean;
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function uid() {
  return Math.random().toString(36).slice(2);
}

// ---------------------------------------------------------------------------
// 气泡组件
// ---------------------------------------------------------------------------

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex gap-2 items-end", isUser && "flex-row-reverse")}>
      {!isUser && (
        <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 shadow-sm">
          <BrainCircuit className="h-3.5 w-3.5 text-white" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser
            ? "rounded-br-sm bg-blue-600 text-white"
            : msg.error
              ? "rounded-bl-sm bg-red-50 text-red-700 border border-red-200"
              : "rounded-bl-sm bg-muted text-foreground",
        )}
      >
        {msg.content.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < msg.content.split("\n").length - 1 && <br />}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 推荐问题
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS = [
  "团队目前整体状态怎么样？",
  "哪个模块最需要关注？",
  "最近谁最活跃？谁需要支持？",
  "有什么协作规律值得我关注？",
  "这周我应该优先处理什么？",
];

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------

export function AIAssistant() {
  const [open, setOpen]                     = useState(false);
  const [messages, setMessages]             = useState<Message[]>([]);
  const [input, setInput]                   = useState("");
  const [isPending, startTransition]        = useTransition();
  const [historyLoaded, setHistoryLoaded]   = useState(false);
  const [restoredCount, setRestoredCount]   = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // 首次打开时，从服务器加载历史对话
  useEffect(() => {
    if (!open || historyLoaded) return;
    setHistoryLoaded(true);

    getChatHistory().then((rows) => {
      if (rows.length > 0 && messages.length === 0) {
        setMessages(rows.map((r) => ({ id: r.id, role: r.role, content: r.content })));
        setRestoredCount(rows.length);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 滚动到底部
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  // 聚焦输入框
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isPending) return;

    const userMsg: Message = { id: uid(), role: "user", content: trimmed };
    const history = messages.map((m) => ({ role: m.role, content: m.content })) as AssistantMessage[];

    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    startTransition(async () => {
      const result = await chatWithAssistant(trimmed, history);

      const replyMsg: Message = {
        id:      uid(),
        role:    "assistant",
        content: result.error ? (result.error || "出了点问题，请稍后重试") : result.reply,
        error:   !!result.error,
      };
      setMessages((prev) => [...prev, replyMsg]);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* ── 悬浮按钮 ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="AI 助手"
        className={cn(
          "fixed bottom-5 right-5 z-50 flex h-13 w-13 items-center justify-center rounded-full shadow-lg transition-all duration-200",
          "bg-gradient-to-br from-blue-500 to-violet-600 text-white",
          "hover:scale-105 hover:shadow-xl active:scale-95",
          open && "scale-90 opacity-0 pointer-events-none",
        )}
      >
        <Bot className="h-6 w-6" />
        {messages.length === 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-[9px] font-bold text-white shadow">
            AI
          </span>
        )}
      </button>

      {/* ── 对话面板 ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-border/60 bg-background",
          "w-[min(380px,calc(100vw-2.5rem))] transition-all duration-300",
          open
            ? "h-[min(600px,calc(100dvh-5rem))] opacity-100 scale-100"
            : "h-0 opacity-0 scale-95 pointer-events-none",
        )}
      >
        {/* 顶栏 */}
        <div className="flex shrink-0 items-center gap-2.5 border-b bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <BrainCircuit className="h-4 w-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white leading-none">AI 管理助理</p>
            <p className="mt-0.5 text-[11px] text-white/70 truncate">
              {messages.length === 0
                ? "了解你的团队，随时为你解答"
                : restoredCount > 0
                  ? `已恢复历史 · ${messages.length} 条对话`
                  : `${messages.length} 条对话`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <a
              href="/dashboard/ai-memory"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              title="查看 AI 记忆"
            >
              <Sparkles className="h-3.5 w-3.5" />
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
              aria-label="关闭"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 消息区域 */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
          {messages.length === 0 ? (
            /* 欢迎界面 */
            <div className="flex h-full flex-col items-center justify-center text-center px-2">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-violet-100">
                <BrainCircuit className="h-7 w-7 text-blue-600" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">你好，我是你的 AI 管理助理</p>
              <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                我在持续学习你的团队、项目和协作规律。
                <br />随着数据积累，我会越来越了解这家公司。
              </p>
              <div className="w-full space-y-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="w-full rounded-xl border border-border/80 bg-muted/50 px-3.5 py-2 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
              {isPending && (
                <div className="flex gap-2 items-end">
                  <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600">
                    <BrainCircuit className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {/* 清空按钮（有对话时显示） */}
        {messages.length > 0 && (
          <div className="flex items-center justify-between px-4 pt-1 pb-0">
            {restoredCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <History className="h-3 w-3" />
                已恢复 {restoredCount} 条历史
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setRestoredCount(0);
                clearMyChatHistory().catch(console.error);
              }}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              清空对话
            </button>
          </div>
        )}

        {/* 输入区域 */}
        <div className="shrink-0 border-t bg-muted/30 px-3 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="问我任何关于团队和项目的问题…"
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400",
                "placeholder:text-muted-foreground/60",
                "max-h-28 min-h-[2.5rem] overflow-y-auto leading-5",
              )}
              style={{ height: "auto" }}
              onInput={(e) => {
                const target = e.currentTarget;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 112)}px`;
              }}
              disabled={isPending}
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isPending}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                input.trim() && !isPending
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
              aria-label="发送"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground/50">
            Enter 发送 · Shift+Enter 换行
          </p>
        </div>
      </div>
    </>
  );
}
