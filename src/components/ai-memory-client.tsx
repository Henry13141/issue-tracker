"use client";

import { useState, useTransition } from "react";
import { BrainCircuit, RefreshCw, User, Boxes, Building2, GitBranch, Clock, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AIMemoryEntry, MemoryCategory } from "@/lib/ai-memory";
import { triggerOrganizationLearning } from "@/actions/ai";

// ---------------------------------------------------------------------------
// 分类元数据
// ---------------------------------------------------------------------------

const CATEGORY_META: Record<MemoryCategory, {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  description: string;
}> = {
  org_insight: {
    label: "组织洞察",
    icon: <Building2 className="h-4 w-4" />,
    color: "text-blue-600",
    bgColor: "bg-blue-50 dark:bg-blue-950/30",
    description: "对整体团队运转状况的综合分析",
  },
  process_pattern: {
    label: "协作规律",
    icon: <GitBranch className="h-4 w-4" />,
    color: "text-violet-600",
    bgColor: "bg-violet-50 dark:bg-violet-950/30",
    description: "工作节奏、状态流转等协作模式规律",
  },
  module_health: {
    label: "模块健康度",
    icon: <Boxes className="h-4 w-4" />,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/30",
    description: "各模块工单积压、风险和解决效率",
  },
  member_profile: {
    label: "成员画像",
    icon: <User className="h-4 w-4" />,
    color: "text-amber-600",
    bgColor: "bg-amber-50 dark:bg-amber-950/30",
    description: "每位成员的工作特点和当前状态",
  },
  conversation_insight: {
    label: "对话洞察",
    icon: <BrainCircuit className="h-4 w-4" />,
    color: "text-rose-600",
    bgColor: "bg-rose-50 dark:bg-rose-950/30",
    description: "从管理者与 AI 的对话中提炼的决策与关注重点",
  },
};

const CATEGORY_ORDER: MemoryCategory[] = [
  "org_insight",
  "process_pattern",
  "module_health",
  "member_profile",
];

// ---------------------------------------------------------------------------
// 单条记忆卡片
// ---------------------------------------------------------------------------

function MemoryCard({ entry }: { entry: AIMemoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[entry.category];
  const updatedAt = new Date(entry.updated_at).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const shortContent = entry.content.length > 200 ? entry.content.slice(0, 200) + "…" : entry.content;
  const needsExpand = entry.content.length > 200;

  return (
    <div className={cn("rounded-xl border p-4 transition-colors", meta.bgColor)}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={meta.color}>{meta.icon}</span>
          <span className="font-medium text-sm truncate">
            {entry.subject_label || "整体"}
          </span>
          {entry.version > 1 && (
            <span className="shrink-0 text-[10px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-full">
              v{entry.version}
            </span>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {updatedAt}
        </div>
      </div>

      <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap">
        {expanded ? entry.content : shortContent}
      </p>

      {needsExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={cn("mt-2 flex items-center gap-1 text-xs transition-colors", meta.color, "hover:opacity-70")}
        >
          {expanded ? <><ChevronUp className="h-3 w-3" /> 收起</> : <><ChevronDown className="h-3 w-3" /> 展开全文</>}
        </button>
      )}

      {entry.period_start && entry.period_end && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          覆盖周期：{entry.period_start} ～ {entry.period_end}
        </p>
      )}
    </div>
  );
}

// triggerLearning 已替换为直接调用 Server Action（见下方 handleRunLearning）

// ---------------------------------------------------------------------------
// 主客户端组件
// ---------------------------------------------------------------------------

export function AIMemoryClient({ initialMemories }: { initialMemories: AIMemoryEntry[] }) {
  const [memories, setMemories]             = useState(initialMemories);
  const [isPending, startTransition]        = useTransition();
  const [lastRunResult, setLastRunResult]   = useState<string | null>(null);

  const byCategory = CATEGORY_ORDER.reduce((acc, cat) => {
    acc[cat] = memories.filter((m) => m.category === cat);
    return acc;
  }, {} as Record<MemoryCategory, AIMemoryEntry[]>);

  const totalCount = memories.length;
  const lastUpdated = memories.length > 0
    ? new Date(memories[0].updated_at).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const handleRunLearning = () => {
    startTransition(async () => {
      try {
        setLastRunResult(null);
        const result = await triggerOrganizationLearning();

        if (result.ok) {
          const { learned } = result;
          setLastRunResult(
            `✓ 学习完成！更新了：组织洞察 ${learned.org_insight ? "✓" : "✗"} | 协作规律 ${learned.process_pattern ? "✓" : "✗"} | 模块 ${learned.module_health} 个 | 成员 ${learned.member_profiles} 个`
          );
          // 刷新记忆列表
          const res = await fetch("/api/ai-memory-list");
          if (res.ok) {
            const data = await res.json() as { memories: AIMemoryEntry[] };
            setMemories(data.memories);
          } else {
            window.location.reload();
          }
        } else {
          setLastRunResult(`✗ 学习失败：${result.error ?? "未知错误"}`);
        }
      } catch {
        setLastRunResult("✗ 请求失败，请检查网络或配置");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-100 to-violet-100">
                <BrainCircuit className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  已积累 <span className="text-blue-600 font-semibold">{totalCount}</span> 条组织记忆
                </p>
                <p className="text-xs text-muted-foreground">
                  {lastUpdated ? `最近更新：${lastUpdated}` : "尚未学习，点击右侧按钮开始"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunLearning}
              disabled={isPending}
              className={cn(
                "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all",
                isPending
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : "bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
              )}
            >
              <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
              {isPending ? "学习中…" : "立即运行学习"}
            </button>
          </div>

          {lastRunResult && (
            <div className={cn(
              "mt-3 rounded-lg px-3 py-2 text-xs",
              lastRunResult.startsWith("✓")
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            )}>
              {lastRunResult}
            </div>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            <Sparkles className="inline h-3 w-3 mr-1" />
            每日凌晨 2 点自动运行 · 分析过去 30 天全量平台数据 · 随着数据积累 AI 会越来越了解你的公司
          </p>
        </CardContent>
      </Card>

      {/* 无记忆状态 */}
      {totalCount === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/20 py-16 text-center">
          <BrainCircuit className="mb-4 h-12 w-12 text-muted-foreground/30" />
          <p className="text-base font-medium text-muted-foreground">AI 尚未学习</p>
          <p className="mt-1 text-sm text-muted-foreground/70 max-w-sm">
            点击上方「立即运行学习」按钮，AI 将分析过去30天的全量平台数据，
            生成关于团队、成员和协作规律的初始认知。
          </p>
        </div>
      )}

      {/* 按分类展示记忆 */}
      {CATEGORY_ORDER.map((cat) => {
        const entries = byCategory[cat];
        if (entries.length === 0) return null;
        const meta = CATEGORY_META[cat];
        return (
          <section key={cat}>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <span className={meta.color}>{meta.icon}</span>
                  {meta.label}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {entries.length} 条
                  </span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{meta.description}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <div className={cn(
                  "grid gap-3",
                  cat === "member_profile" ? "sm:grid-cols-2" : "grid-cols-1"
                )}>
                  {entries.map((entry) => (
                    <MemoryCard key={entry.id} entry={entry} />
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>
        );
      })}
    </div>
  );
}
