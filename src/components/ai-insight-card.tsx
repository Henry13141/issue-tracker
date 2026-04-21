"use client";

import { useState, useEffect } from "react";
import { Sparkles, RefreshCw, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateWorkInsightReport } from "@/actions/ai";
import type { WorkInsightReport } from "@/actions/ai";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Section = {
  key: keyof Omit<WorkInsightReport, "generatedAt">;
  label: string;
  icon: string;
  color: string;
};

const SECTIONS: Section[] = [
  { key: "summary",        label: "整体状态总结",   icon: "📊", color: "text-blue-700" },
  { key: "riskAnalysis",   label: "风险问题分析",   icon: "⚠️", color: "text-orange-700" },
  { key: "memberInsights", label: "成员工作洞察",   icon: "👥", color: "text-purple-700" },
  { key: "trendInsights",  label: "趋势规律洞察",   icon: "📈", color: "text-emerald-700" },
  { key: "actionItems",    label: "今日行动建议",   icon: "✅", color: "text-green-700" },
];

function InsightSection({ section, value }: { section: Section; value: string }) {
  const lines = value.split("\n").filter(Boolean);
  return (
    <div className="space-y-1.5">
      <h3 className={cn("text-xs font-semibold uppercase tracking-wider", section.color)}>
        <span className="mr-1.5">{section.icon}</span>
        {section.label}
      </h3>
      <div className="space-y-1 text-sm text-foreground/85 leading-relaxed">
        {lines.map((line, i) => (
          <p key={i} className={line.startsWith("•") ? "pl-2" : ""}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

export function AIInsightCard() {
  const [mounted, setMounted] = useState(false);
  const [report, setReport] = useState<WorkInsightReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return <div className="h-28 rounded-xl border-2 border-dashed border-muted-foreground/20" />;

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const result = await generateWorkInsightReport();
      if (!result) {
        setError("AI 分析生成失败，请稍后重试");
      } else {
        setReport(result);
        setExpanded(true);
      }
    } catch {
      setError("生成过程中发生错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className={cn(
      "border-2 transition-colors",
      report ? "border-blue-200 bg-blue-50/30" : "border-dashed border-muted-foreground/30"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-blue-500" />
            AI 工作情况分析
            {report && (
              <span className="text-xs font-normal text-muted-foreground">
                · 生成于 {formatDateTime(report.generatedAt)}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {report && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {expanded ? "收起" : "展开"}
              </button>
            )}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed",
                "shadow-sm hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              )}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              {loading ? "AI 分析中…" : report ? "重新分析" : "生成 AI 分析"}
            </button>
          </div>
        </div>
        {!report && !loading && !error && (
          <p className="text-xs text-muted-foreground">
            综合今日工单数据、成员负载、风险分布与7天趋势，由 AI 生成当前工作状态分析与行动建议。
          </p>
        )}
      </CardHeader>

      {(error || (report && expanded)) && (
        <CardContent className="pt-0">
          {error && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {report && expanded && (
            <div className="space-y-5 divide-y divide-border/60">
              {SECTIONS.map((section, i) => {
                const value = report[section.key];
                if (!value) return null;
                return (
                  <div key={section.key} className={cn(i > 0 && "pt-4")}>
                    <InsightSection section={section} value={value} />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}

      {loading && (
        <CardContent className="pt-0">
          <div className="space-y-3 animate-pulse">
            {[80, 60, 90, 70, 75].map((w, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-24 rounded bg-blue-200/60" />
                <div className={`h-4 rounded bg-muted/60`} style={{ width: `${w}%` }} />
                {i === 0 && <div className="h-4 w-1/2 rounded bg-muted/40" />}
              </div>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
