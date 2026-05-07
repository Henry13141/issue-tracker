"use client";

import type { KnowledgeVersion } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Clock, GitCommitHorizontal } from "lucide-react";

interface Props {
  versions: KnowledgeVersion[];
  currentVersion: string;
}

export function KnowledgeVersionHistory({ versions, currentVersion }: Props) {
  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">暂无版本历史（仅在修改已确认知识时自动存档）</p>
    );
  }

  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <Card key={v.id} className="overflow-hidden">
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-medium">{v.version}</span>
                  {v.version === currentVersion && (
                    <Badge variant="default" className="text-xs">当前版本</Badge>
                  )}
                  {v.creator && (
                    <span className="text-xs text-muted-foreground">by {v.creator.name}</span>
                  )}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(v.created_at).toLocaleString("zh-CN")}
                  </span>
                </div>
                {v.change_note && (
                  <p className="mt-1 text-sm text-muted-foreground">{v.change_note}</p>
                )}
                {v.summary && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{v.summary}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
