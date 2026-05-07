"use client";

import { useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import type { KnowledgeArticleWithRelations, KnowledgeCategory, KnowledgeStatus } from "@/types";
import { PlusCircle, Search, Pin, BookOpen, Clock } from "lucide-react";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  project_overview: "项目概览",
  gameplay_rule: "玩法规则",
  numeric_system: "数值体系",
  ui_spec: "UI规范",
  technical_spec: "技术规范",
  hardware_protocol: "硬件协议",
  decision_record: "决策记录",
  test_acceptance: "验收标准",
  troubleshooting: "问题复盘",
  operation_guide: "操作指南",
  finance_ops: "财务行政",
  ai_workflow: "AI工作流",
};

const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  draft: "草稿",
  reviewing: "审核中",
  approved: "已确认",
  deprecated: "已废弃",
  archived: "已归档",
};

const STATUS_BADGE_VARIANT: Record<KnowledgeStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  reviewing: "outline",
  approved: "default",
  deprecated: "destructive",
  archived: "secondary",
};

export { CATEGORY_LABELS, STATUS_LABELS, STATUS_BADGE_VARIANT };

interface Props {
  initialArticles: KnowledgeArticleWithRelations[];
  total: number;
  currentPage: number;
  projects: string[];
  modules: string[];
}

export function KnowledgeListClient({
  initialArticles,
  total,
  currentPage,
  projects,
  modules,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(searchParams.get("q") ?? "");

  // searchParams.get() 返回 string | null，Select 的 defaultValue 需要 string
  const sp = (key: string, fallback = "all") => searchParams.get(key) ?? fallback;

  const buildUrl = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === "" || v === "all") {
          params.delete(k);
        } else {
          params.set(k, v);
          if (k !== "page") params.delete("page");
        }
      });
      return `/knowledge?${params.toString()}`;
    },
    [searchParams]
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      router.push(buildUrl({ q: q || null }));
    });
  }

  function handleFilter(key: string, value: string | null) {
    startTransition(() => {
      router.push(buildUrl({ [key]: value === "all" || value === null ? null : value }));
    });
  }

  const pageSize = 20;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-4">
      {/* 快捷状态 Tabs */}
      <div className="flex gap-0.5 border-b">
        {[
          { label: "全部", value: null },
          { label: "待确认", value: "reviewing" },
          { label: "已确认", value: "approved" },
          { label: "草稿", value: "draft" },
        ].map((tab) => {
          const activeStatus = searchParams.get("status");
          const isActive = tab.value === null ? !activeStatus : activeStatus === tab.value;
          return (
            <button
              key={tab.label}
              onClick={() => handleFilter("status", tab.value)}
              className={cn(
                "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              disabled={isPending}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 搜索 + 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <form onSubmit={handleSearch} className="flex flex-1 items-center gap-2 min-w-[200px]">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索标题或摘要..."
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
            搜索
          </Button>
        </form>

        <Select
          defaultValue={sp("category")}
          onValueChange={(v) => handleFilter("category", v)}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="全部分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          defaultValue={sp("status")}
          onValueChange={(v) => handleFilter("status", v)}
        >
          <SelectTrigger className="w-28">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {modules.length > 0 && (
          <Select
            defaultValue={sp("module")}
            onValueChange={(v) => handleFilter("module", v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部模块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {projects.length > 0 && (
          <Select
            defaultValue={sp("project_name")}
            onValueChange={(v) => handleFilter("project_name", v)}
          >
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部项目" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部项目</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Link href="/knowledge/new" className={cn(buttonVariants({ size: "sm" }), "ml-auto")}>
          <PlusCircle className="mr-1.5 h-4 w-4" />
          新建知识
        </Link>
      </div>

      {/* 统计 */}
      <p className="text-sm text-muted-foreground">共 {total} 条知识</p>

      {/* 列表 */}
      {initialArticles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BookOpen className="mb-3 h-10 w-10 opacity-30" />
          <p>暂无知识条目</p>
        </div>
      ) : (
        <div className="space-y-2">
          {initialArticles.map((article) => (
            <ArticleRow key={article.id} article={article} />
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1 || isPending}
            onClick={() => startTransition(() => router.push(buildUrl({ page: String(currentPage - 1) })))}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages || isPending}
            onClick={() => startTransition(() => router.push(buildUrl({ page: String(currentPage + 1) })))}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

function ArticleRow({ article }: { article: KnowledgeArticleWithRelations }) {
  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {article.is_pinned && (
            <Pin className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/knowledge/${article.id}`}
                className="font-medium hover:underline line-clamp-1"
              >
                {article.title}
              </Link>
              <Badge variant={STATUS_BADGE_VARIANT[article.status]} className="text-xs">
                {STATUS_LABELS[article.status]}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {CATEGORY_LABELS[article.category] ?? article.category}
              </Badge>
              {article.module && (
                <span className="text-xs text-muted-foreground">{article.module}</span>
              )}
              <span className="text-xs text-muted-foreground font-mono">{article.version}</span>
            </div>
            {article.summary && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{article.summary}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {article.owner && <span>负责人：{article.owner.name}</span>}
              {typeof article.linked_issue_count === "number" && article.linked_issue_count > 0 && (
                <span>关联任务：{article.linked_issue_count}</span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {new Date(article.updated_at).toLocaleDateString("zh-CN")}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// 让页面组件可以使用 toast
export { toast };
