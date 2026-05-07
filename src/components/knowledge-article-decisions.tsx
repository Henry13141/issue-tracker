"use client";

import Link from "next/link";
import type { KnowledgeDecisionWithRelations } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, XCircle } from "lucide-react";

const STATUS_LABELS = {
  draft: "草稿",
  confirmed: "已确认",
  superseded: "已废止",
} as const;

const STATUS_BADGE_VARIANT = {
  draft: "secondary" as const,
  confirmed: "default" as const,
  superseded: "destructive" as const,
};

interface Props {
  decisions: KnowledgeDecisionWithRelations[];
}

export function KnowledgeArticleDecisions({ decisions }: Props) {
  if (decisions.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无关联决策记录</p>;
  }

  return (
    <div className="space-y-2">
      {decisions.map((d) => (
        <div key={d.id} className="rounded-md border px-4 py-3 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium line-clamp-1">{d.title}</span>
            <Badge variant={STATUS_BADGE_VARIANT[d.status]}>
              {STATUS_LABELS[d.status]}
              {d.status === "confirmed" && <CheckCircle2 className="ml-1 h-3 w-3" />}
              {d.status === "superseded" && <XCircle className="ml-1 h-3 w-3" />}
            </Badge>
            {(d.project_name || d.module) && (
              <span className="text-xs text-muted-foreground">
                {[d.project_name, d.module].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          <p className="text-muted-foreground line-clamp-2">{d.decision}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {d.decider && <span>决策人：{d.decider.name}</span>}
            {d.issue && (
              <Link href={`/issues/${d.issue.id}`} className="hover:underline">
                关联任务：{d.issue.title}
              </Link>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(d.updated_at).toLocaleDateString("zh-CN")}
            </span>
            <Link
              href={`/knowledge/decisions`}
              className="text-primary hover:underline ml-auto"
            >
              查看全部决策 →
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}
