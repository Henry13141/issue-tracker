"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Sparkles,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Send,
  ShieldAlert,
  CircleDot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeAskResponse } from "@/types";

type HistoryItem = {
  id: string;
  question: string;
  response: KnowledgeAskResponse;
  askedAt: Date;
};

const CONFIDENCE_CONFIG = {
  high: { label: "高置信度", color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-950/30", icon: CheckCircle2 },
  medium: { label: "中置信度", color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", icon: CircleDot },
  low: { label: "低置信度", color: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30", icon: AlertTriangle },
} as const;

export default function KnowledgeAskClient() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<HistoryItem | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const q = question.trim();
    if (!q || loading) return;

    setLoading(true);
    setCurrent(null);

    try {
      const res = await fetch("/api/knowledge/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error((err as { error?: string }).error ?? "请求失败，请稍后重试");
        return;
      }

      const data: KnowledgeAskResponse = await res.json();
      const item: HistoryItem = {
        id: crypto.randomUUID(),
        question: q,
        response: data,
        askedAt: new Date(),
      };
      setCurrent(item);
      setHistory((prev) => [item, ...prev].slice(0, 20)); // 本次 session 最多保留 20 条
      setQuestion("");
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }, [question, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-6">
      {/* 输入区 */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <Textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="提问，例如：这个项目的 UI 规范是什么？（Ctrl+Enter 发送）"
            rows={3}
            className="resize-none"
            disabled={loading}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              回答基于已审批（approved）的知识条目，仅引用可信来源
            </p>
            <Button
              onClick={handleSubmit}
              disabled={!question.trim() || loading}
              size="sm"
              className="gap-1.5"
            >
              {loading ? (
                <>
                  <Sparkles className="h-4 w-4 animate-pulse" />
                  思考中…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  提问
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 加载态 */}
      {loading && (
        <Card>
          <CardContent className="p-5 space-y-3">
            {[
              "w-3/4", "w-full", "w-5/6", "w-2/3",
            ].map((w, i) => (
              <div key={i} className={cn("h-3 rounded-full bg-muted animate-pulse", w)} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* 当前答案 */}
      {!loading && current && (
        <AnswerCard item={current} isLatest />
      )}

      {/* 历史问答 */}
      {history.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
            本次会话历史
          </p>
          {history.slice(1).map((item) => (
            <CollapsedHistory
              key={item.id}
              item={item}
              expanded={expandedHistory.has(item.id)}
              onToggle={() =>
                setExpandedHistory((prev) => {
                  const next = new Set(prev);
                  next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                  return next;
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 答案卡片
// ---------------------------------------------------------------------------
function AnswerCard({ item, isLatest }: { item: HistoryItem; isLatest?: boolean }) {
  const { question, response, askedAt } = item;
  const conf = CONFIDENCE_CONFIG[response.confidence] ?? CONFIDENCE_CONFIG.low;
  const ConfIcon = conf.icon;

  return (
    <Card className={cn(isLatest && "border-primary/40")}>
      <CardHeader className="pb-2 pt-4 px-5">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-medium text-muted-foreground leading-relaxed">
            Q：{question}
          </CardTitle>
          <time className="shrink-0 text-xs text-muted-foreground">
            {askedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
          </time>
        </div>
      </CardHeader>

      <CardContent className="px-5 pb-5 space-y-4">
        {/* 无依据提示 */}
        {response.no_basis ? (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20 p-3">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800 dark:text-amber-400">{response.answer}</p>
          </div>
        ) : (
          <>
            {/* 置信度标签 */}
            <div className={cn("flex items-center gap-1.5 text-xs font-medium rounded-md px-2.5 py-1.5 w-fit", conf.bg, conf.color)}>
              <ConfIcon className="h-3.5 w-3.5" />
              {conf.label}
            </div>

            {/* 答案正文（Markdown 简单渲染） */}
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={response.answer} />
            </div>

            {/* 来源引用 */}
            {response.citations.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <BookOpen className="h-3.5 w-3.5" />
                  引用知识来源
                </p>
                <div className="flex flex-wrap gap-2">
                  {response.citations.map((c) => (
                    <Link
                      key={c.id}
                      href={`/knowledge/${c.id}`}
                      className="inline-flex items-center gap-1 text-xs rounded border border-border bg-muted/50 px-2 py-1 hover:bg-muted transition-colors"
                    >
                      {c.title}
                      <ExternalLink className="h-3 w-3 opacity-50" />
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* 风险提示 */}
            {response.risk_notes && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20 p-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
                <div>
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-400">风险提示</p>
                  <p className="mt-0.5 text-xs text-yellow-700 dark:text-yellow-500">{response.risk_notes}</p>
                </div>
              </div>
            )}

            {/* 可执行性标注 */}
            <div className="flex items-center gap-2">
              <Badge variant={response.actionable ? "default" : "secondary"} className="text-xs">
                {response.actionable ? "可直接执行" : "仅供参考"}
              </Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 折叠的历史记录行
// ---------------------------------------------------------------------------
function CollapsedHistory({
  item,
  expanded,
  onToggle,
}: {
  item: HistoryItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
      >
        <span className="text-muted-foreground truncate pr-4">{item.question}</span>
        <div className="flex items-center gap-2 shrink-0">
          {item.response.no_basis ? (
            <Badge variant="secondary" className="text-xs">无依据</Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              {CONFIDENCE_CONFIG[item.response.confidence]?.label ?? ""}
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {expanded && (
        <>
          <Separator />
          <div className="p-4">
            <AnswerCard item={item} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 极简 Markdown 渲染（不引入额外依赖）
// 支持：**加粗**、`行内代码`、代码块、有序/无序列表、段落
// ---------------------------------------------------------------------------
function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let codeBuffer: string[] = [];
  let inCode = false;

  const flushList = () => {
    if (!listBuffer.length) return;
    const items = listBuffer.map((l, i) => (
      <li key={i} dangerouslySetInnerHTML={{ __html: inlineFormat(l) }} />
    ));
    elements.push(
      listType === "ol" ? (
        <ol key={elements.length} className="list-decimal pl-5 space-y-0.5">{items}</ol>
      ) : (
        <ul key={elements.length} className="list-disc pl-5 space-y-0.5">{items}</ul>
      )
    );
    listBuffer = [];
    listType = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码块
    if (line.startsWith("```")) {
      if (inCode) {
        elements.push(
          <pre key={elements.length} className="rounded-md bg-muted px-3 py-2 text-xs overflow-x-auto">
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuffer.push(line); continue; }

    // 标题
    const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const cls = level === 1 ? "text-base font-semibold mt-3"
        : level === 2 ? "text-sm font-semibold mt-2"
        : "text-sm font-medium mt-1.5";
      elements.push(<p key={elements.length} className={cls} dangerouslySetInnerHTML={{ __html: inlineFormat(headingMatch[2]) }} />);
      continue;
    }

    // 无序列表
    const ulMatch = line.match(/^[-*+]\s+(.*)/);
    if (ulMatch) {
      if (listType === "ol") flushList();
      listType = "ul";
      listBuffer.push(ulMatch[1]);
      continue;
    }

    // 有序列表
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      if (listType === "ul") flushList();
      listType = "ol";
      listBuffer.push(olMatch[1]);
      continue;
    }

    flushList();

    // 空行
    if (!line.trim()) {
      elements.push(<div key={elements.length} className="h-1.5" />);
      continue;
    }

    // 普通段落
    elements.push(
      <p key={elements.length} className="text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
    );
  }

  flushList();
  if (codeBuffer.length) {
    elements.push(
      <pre key={elements.length} className="rounded-md bg-muted px-3 py-2 text-xs overflow-x-auto">
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
  }

  return <div className="space-y-1">{elements}</div>;
}

function inlineFormat(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-muted px-1 py-0.5 text-xs font-mono">$1</code>');
}
