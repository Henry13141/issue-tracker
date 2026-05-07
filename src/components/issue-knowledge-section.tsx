"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { KnowledgeIssueLinkWithRelations, KnowledgeRelationType, User } from "@/types";
import {
  addKnowledgeIssueLink,
  removeKnowledgeIssueLink,
  generateKnowledgeDraftFromIssue,
} from "@/actions/knowledge";
import { BookOpen, PlusCircle, Trash2, Sparkles, ExternalLink } from "lucide-react";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
} from "@/components/knowledge-list-client";

const RELATION_TYPE_LABELS: Record<KnowledgeRelationType, string> = {
  spec_for: "执行依据",
  acceptance_for: "验收标准",
  reference: "参考资料",
  implements: "实现内容",
  blocks: "阻塞关联",
  result_from: "产出知识",
};

// 分组展示顺序
const GROUP_ORDER: KnowledgeRelationType[] = [
  "spec_for",
  "acceptance_for",
  "reference",
  "implements",
  "result_from",
  "blocks",
];

interface Props {
  issueId: string;
  initialLinks: KnowledgeIssueLinkWithRelations[];
  currentUser: User;
  issueStatus?: string;
}

export function IssueKnowledgeSection({ issueId, initialLinks, currentUser, issueStatus }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isGenerating, setIsGenerating] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [articleId, setArticleId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeRelationType>("reference");

  const grouped = GROUP_ORDER.reduce<Record<KnowledgeRelationType, KnowledgeIssueLinkWithRelations[]>>(
    (acc, rt) => {
      acc[rt] = initialLinks.filter((l) => l.relation_type === rt);
      return acc;
    },
    {} as Record<KnowledgeRelationType, KnowledgeIssueLinkWithRelations[]>
  );

  const hasLinks = initialLinks.length > 0;
  const isClosed = issueStatus === "closed" || issueStatus === "resolved";

  function handleAdd() {
    if (!articleId.trim()) {
      toast.error("请输入知识条目 ID");
      return;
    }

    startTransition(async () => {
      const result = await addKnowledgeIssueLink(articleId.trim(), issueId, relationType);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("关联已添加");
      setArticleId("");
      setAddOpen(false);
      router.refresh();
    });
  }

  function handleRemove(linkId: string) {
    startTransition(async () => {
      const result = await removeKnowledgeIssueLink(linkId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("关联已移除");
      router.refresh();
    });
  }

  function handleGenerateDraft() {
    setIsGenerating(true);
    startTransition(async () => {
      const result = await generateKnowledgeDraftFromIssue(issueId);
      setIsGenerating(false);
      if ("error" in result) {
        toast.error(`生成失败：${result.error}`);
        return;
      }
      toast.success("知识草稿已生成，可在知识库查看", {
        action: {
          label: "查看",
          onClick: () => router.push(`/knowledge/${result.id}`),
        },
      });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            关联知识
            {hasLinks && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {initialLinks.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {isClosed && (
              <Button
                variant="outline"
                size="sm"
                disabled={isPending || isGenerating}
                onClick={handleGenerateDraft}
              >
                <Sparkles className="mr-1.5 h-4 w-4" />
                {isGenerating ? "生成中..." : "生成知识草稿"}
              </Button>
            )}
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger
                render={
                  <Button variant="outline" size="sm">
                    <PlusCircle className="mr-1.5 h-4 w-4" />
                    关联知识
                  </Button>
                }
              />
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>关联知识条目</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label htmlFor="article-id">知识条目 ID（UUID）</Label>
                    <Input
                      id="article-id"
                      value={articleId}
                      onChange={(e) => setArticleId(e.target.value)}
                      placeholder="粘贴知识条目 ID..."
                    />
                    <p className="text-xs text-muted-foreground">
                      可在{" "}
                      <Link href="/knowledge" target="_blank" className="underline">
                        项目知识库
                      </Link>{" "}
                      中找到知识条目 ID
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>关联类型</Label>
                    <Select value={relationType} onValueChange={(v) => setRelationType(v as KnowledgeRelationType)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RELATION_TYPE_LABELS).map(([k, label]) => (
                          <SelectItem key={k} value={k}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setAddOpen(false)}>取消</Button>
                    <Button onClick={handleAdd} disabled={isPending}>添加</Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!hasLinks ? (
          <p className="text-sm text-muted-foreground">暂无关联知识</p>
        ) : (
          <div className="space-y-4">
            {GROUP_ORDER.map((rt) => {
              const items = grouped[rt];
              if (!items.length) return null;
              return (
                <div key={rt}>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {RELATION_TYPE_LABELS[rt]}
                  </p>
                  <div className="space-y-1">
                    {items.map((link) => (
                      <div
                        key={link.id}
                        className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                      >
                        {link.article ? (
                          <>
                            <Link
                              href={`/knowledge/${link.article.id}`}
                              className="flex-1 hover:underline line-clamp-1 font-medium"
                            >
                              {link.article.title}
                            </Link>
                            <Badge
                              variant={STATUS_BADGE_VARIANT[link.article.status as keyof typeof STATUS_BADGE_VARIANT] ?? "outline"}
                              className="text-xs shrink-0"
                            >
                              {STATUS_LABELS[link.article.status as keyof typeof STATUS_LABELS] ?? link.article.status}
                            </Badge>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {CATEGORY_LABELS[link.article.category as keyof typeof CATEGORY_LABELS] ?? link.article.category}
                            </Badge>
                            <Link href={`/knowledge/${link.article.id}`} target="_blank">
                              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                            </Link>
                          </>
                        ) : (
                          <span className="flex-1 text-muted-foreground">{link.article_id}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={isPending}
                          onClick={() => handleRemove(link.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
