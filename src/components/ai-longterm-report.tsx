"use client";

import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, AlertCircle, ChevronDown, ChevronUp, Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateLongTermReport } from "@/actions/ai";
import type { LongTermReport } from "@/actions/ai";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type ReportSection = {
  key: keyof Omit<LongTermReport, "dataContext" | "generatedAt">;
  title: string;
  icon: string;
  accent: string;
  headerColor: string;
};

const SECTIONS: ReportSection[] = [
  {
    key: "executiveSummary",
    title: "执行摘要",
    icon: "📋",
    accent: "border-blue-200 bg-blue-50/40",
    headerColor: "text-blue-800",
  },
  {
    key: "projectHealth",
    title: "项目健康度评估",
    icon: "🏥",
    accent: "border-green-200 bg-green-50/40",
    headerColor: "text-green-800",
  },
  {
    key: "bottlenecks",
    title: "瓶颈与系统性风险",
    icon: "⚠️",
    accent: "border-orange-200 bg-orange-50/40",
    headerColor: "text-orange-800",
  },
  {
    key: "teamEffectiveness",
    title: "团队效能分析",
    icon: "👥",
    accent: "border-purple-200 bg-purple-50/40",
    headerColor: "text-purple-800",
  },
  {
    key: "trendTrajectory",
    title: "趋势与轨迹判断",
    icon: "📈",
    accent: "border-teal-200 bg-teal-50/40",
    headerColor: "text-teal-800",
  },
  {
    key: "recommendations",
    title: "核心建议",
    icon: "✅",
    accent: "border-emerald-200 bg-emerald-50/60",
    headerColor: "text-emerald-800",
  },
];

function SectionCard({ section, content }: { section: ReportSection; content: string }) {
  const lines = content.split("\n").filter(Boolean);
  return (
    <div className={cn("rounded-lg border p-4 space-y-2", section.accent)}>
      <h3 className={cn("text-sm font-semibold", section.headerColor)}>
        <span className="mr-2">{section.icon}</span>
        {section.title}
      </h3>
      <div className="space-y-1.5 text-sm text-foreground/85 leading-relaxed">
        {lines.map((line, i) => (
          <p key={i} className={line.startsWith("•") ? "pl-3 border-l-2 border-emerald-400 ml-1" : ""}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function DataContextPanel({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-muted-foreground/30">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          查看本次分析使用的原始数据摘要
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <pre className="border-t px-4 py-3 text-[11px] text-muted-foreground leading-relaxed overflow-x-auto whitespace-pre-wrap font-mono max-h-96">
          {content}
        </pre>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      {SECTIONS.map((s, i) => (
        <div key={s.key} className="rounded-lg border p-4 space-y-2.5">
          <div className="h-4 w-36 rounded bg-muted/60" />
          <div className="space-y-1.5">
            <div className="h-3.5 rounded bg-muted/50" style={{ width: `${85 - i * 5}%` }} />
            <div className="h-3.5 rounded bg-muted/40" style={{ width: `${72 - i * 3}%` }} />
            <div className="h-3.5 rounded bg-muted/30" style={{ width: `${60 + i * 2}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AILongTermReport() {
  const [mounted, setMounted]   = useState(false);
  const [report, setReport]     = useState<LongTermReport | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="h-48 rounded-xl border border-dashed border-muted-foreground/20 animate-pulse" />;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateLongTermReport();
      if (!result) {
        setError("AI 报告生成失败，请稍后重试。如果 AI 服务未配置，请联系管理员。");
      } else {
        setReport(result);
        setCollapsed(false);
      }
    } catch {
      setError("生成过程中发生错误，请检查网络后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 头部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5 text-blue-500" />
            AI 30天深度工作分析
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            基于工单吞吐量、生命周期、成员效能、状态流转、交接行为等多维数据生成的纵向分析报告
          </p>
          {report && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              上次生成：{formatDateTime(report.generatedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {report && !loading && (
            <button
              onClick={() => setCollapsed(v => !v)}
              className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              {collapsed ? "展开报告" : "收起报告"}
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={loading}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all",
              "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed",
              "shadow-sm hover:shadow-md"
            )}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            {loading ? "AI 深度分析中…（约30-60秒）" : report ? "重新生成报告" : "生成30天深度报告"}
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <Card>
          <CardContent className="pt-6">
            <LoadingSkeleton />
          </CardContent>
        </Card>
      )}

      {/* 报告内容 */}
      {report && !loading && !collapsed && (
        <div className="space-y-4">
          {SECTIONS.map(section => {
            const content = report[section.key];
            if (!content) return null;
            return <SectionCard key={section.key} section={section} content={content} />;
          })}

          {/* 原始数据 */}
          <DataContextPanel content={report.dataContext} />
        </div>
      )}

      {/* 空状态 */}
      {!report && !loading && !error && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="font-medium text-muted-foreground">点击上方按钮生成报告</h3>
            <p className="mt-1 text-sm text-muted-foreground/70 max-w-md">
              系统将采集过去30天的工单吞吐、生命周期、成员行为、状态流转、模块分布等数据，
              由 AI 进行深度分析，生成包含执行摘要、瓶颈识别、团队效能和行动建议的完整报告。
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              {["30天工单趋势", "生命周期分析", "成员效能对比", "状态流转图谱", "交接行为分析", "模块健康度"].map(tag => (
                <span key={tag} className="rounded-full border px-2.5 py-0.5 bg-muted/30">{tag}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}