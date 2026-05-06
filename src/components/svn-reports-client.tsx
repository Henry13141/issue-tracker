"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SvnDailyReport } from "@/actions/svn-reports";
import { GitCommitHorizontal, Users, AlertCircle, FileCode, Map, Layers, Film, Bot, AlignLeft } from "lucide-react";

interface Props {
  reports: SvnDailyReport[];
  setupMissing?: boolean;
  errorMessage?: string;
}

export function SvnReportsClient({ reports, setupMissing, errorMessage }: Props) {
  const [selected, setSelected] = useState<string | null>(reports[0]?.id ?? null);

  if (reports.length === 0) {
    const title = setupMissing ? "研发日报表尚未初始化" : "暂无研发日报";
    const description = setupMissing
      ? "请先执行 Supabase 迁移 add_svn_daily_reports.sql，然后再运行 SVN 采集器"
      : errorMessage ?? "SVN 采集器首次运行后，日报将自动出现在此处";

    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 px-8 py-16 text-center text-muted-foreground">
        <GitCommitHorizontal className="mx-auto mb-3 h-8 w-8 opacity-40" />
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-md text-xs">{description}</p>
      </div>
    );
  }

  const current = reports.find((r) => r.id === selected) ?? reports[0];

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* 日期列表 */}
      <div className="w-full shrink-0 space-y-1 lg:w-52">
        {reports.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setSelected(r.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
              r.id === (selected ?? reports[0].id)
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 opacity-60" />
            <span className="min-w-0 flex-1 truncate">{r.report_date}</span>
            {r.generated_by === "ai" ? (
              <Bot className="h-3 w-3 shrink-0 opacity-50" />
            ) : (
              <AlignLeft className="h-3 w-3 shrink-0 opacity-50" />
            )}
          </button>
        ))}
      </div>

      {/* 日报详情 */}
      {current && <ReportDetail report={current} />}
    </div>
  );
}

function ReportDetail({ report }: { report: SvnDailyReport }) {
  const { stats } = report;

  return (
    <div className="min-w-0 flex-1 space-y-4">
      {/* 标题行 */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{report.title}</h2>
        <Badge
          variant="outline"
          className={cn(
            "text-xs",
            report.generated_by === "ai"
              ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-gray-200 bg-gray-50 text-gray-600",
          )}
        >
          {report.generated_by === "ai" ? "AI 生成" : "规则生成"}
        </Badge>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={<GitCommitHorizontal className="h-4 w-4" />}
          label="提交次数"
          value={stats.commitCount}
          color="text-foreground"
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="参与成员"
          value={stats.authorCount}
          color="text-foreground"
        />
        <StatCard
          icon={<AlertCircle className="h-4 w-4" />}
          label="缺少备注"
          value={stats.emptyMessageCount}
          color={stats.emptyMessageCount > 0 ? "text-amber-600" : "text-muted-foreground"}
          highlight={stats.emptyMessageCount > 0}
        />
        <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">涉及类型</p>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {stats.hasAnimationChange && <TypeTag icon={<Film className="h-2.5 w-2.5" />} label="动画" color="bg-purple-100 text-purple-700" />}
            {stats.hasBlueprintChange && <TypeTag icon={<Layers className="h-2.5 w-2.5" />} label="蓝图" color="bg-blue-100 text-blue-700" />}
            {stats.hasCodeChange && <TypeTag icon={<FileCode className="h-2.5 w-2.5" />} label="代码" color="bg-green-100 text-green-700" />}
            {stats.hasMapChange && <TypeTag icon={<Map className="h-2.5 w-2.5" />} label="地图" color="bg-amber-100 text-amber-700" />}
            {!stats.hasAnimationChange && !stats.hasBlueprintChange && !stats.hasCodeChange && !stats.hasMapChange && (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      {/* 参与成员标签 */}
      {report.authors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {report.authors.map((a) => (
            <Badge key={a} variant="secondary" className="text-xs">
              {a}
            </Badge>
          ))}
        </div>
      )}

      {/* 日报正文 */}
      <Card>
        <CardContent className="pt-5">
          <MarkdownPreview content={report.summary} />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        更新时间：{new Date(report.updated_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
      </p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border bg-card p-3", highlight && "border-amber-200 bg-amber-50/50")}>
      <div className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", highlight && "text-amber-600")}>
        {icon}
        {label}
      </div>
      <p className={cn("text-xl font-semibold tabular-nums", color)}>{value}</p>
    </div>
  );
}

function TypeTag({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium", color)}>
      {icon}
      {label}
    </span>
  );
}

// 轻量 Markdown 渲染（仅支持标题、列表、加粗、引用、普通段落）
function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(<h3 key={key++} className="mb-1 mt-4 text-sm font-semibold text-foreground first:mt-0">{line.slice(4)}</h3>);
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={key++} className="mb-1 mt-5 text-base font-semibold text-foreground first:mt-0">{line.slice(3)}</h2>);
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={key++} className="mb-1 mt-6 text-lg font-bold text-foreground first:mt-0">{line.slice(2)}</h1>);
    } else if (line.startsWith("> ")) {
      elements.push(
        <blockquote key={key++} className="my-2 border-l-2 border-muted-foreground/30 pl-3 text-sm italic text-muted-foreground">
          {line.slice(2)}
        </blockquote>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <li key={key++} className="ml-4 list-disc text-sm text-foreground">
          <InlineMarkdown text={line.slice(2)} />
        </li>,
      );
    } else if (/^\d+\. /.test(line)) {
      const text = line.replace(/^\d+\. /, "");
      elements.push(
        <li key={key++} className="ml-4 list-decimal text-sm text-foreground">
          <InlineMarkdown text={text} />
        </li>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(
        <p key={key++} className="text-sm text-foreground">
          <InlineMarkdown text={line} />
        </p>,
      );
    }
  }

  return <div className="leading-relaxed">{elements}</div>;
}

function InlineMarkdown({ text }: { text: string }) {
  // 处理 **加粗**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
