"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  User,
} from "@/types";
import {
  createKnowledgeArticle,
  updateKnowledgeArticle,
  type CreateKnowledgeArticleInput,
} from "@/actions/knowledge";
import { CATEGORY_LABELS } from "@/components/knowledge-list-client";

interface Props {
  article?: KnowledgeArticle;
  members: Pick<User, "id" | "name">[];
  defaultIssueId?: string;
}

export function KnowledgeArticleForm({ article, members, defaultIssueId: _ }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(article?.title ?? "");
  const [projectName, setProjectName] = useState(article?.project_name ?? "");
  const [category, setCategory] = useState<KnowledgeCategory>(
    article?.category ?? "troubleshooting"
  );
  const [module, setModule] = useState(article?.module ?? "");
  const [version, setVersion] = useState(article?.version ?? "v1.0");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [content, setContent] = useState(article?.content ?? "");
  const [ownerId, setOwnerId] = useState(article?.owner_id ?? "");  const [isPinned, setIsPinned] = useState(article?.is_pinned ?? false);
  const [isAiSearchable, setIsAiSearchable] = useState(article?.is_ai_searchable ?? true);
  const [changeNote, setChangeNote] = useState("");

  const isEdit = !!article;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!title.trim()) {
      toast.error("标题不能为空");
      return;
    }
    if (!content.trim()) {
      toast.error("正文不能为空");
      return;
    }

    const input: CreateKnowledgeArticleInput = {
      title,
      project_name: projectName || undefined,
      category,
      module: module || undefined,
      version: version || "v1.0",
      summary: summary || undefined,
      content,
      owner_id: ownerId || undefined,
      is_pinned: isPinned,
      is_ai_searchable: isAiSearchable,
    };

    startTransition(async () => {
      if (isEdit) {
        const result = await updateKnowledgeArticle(article.id, {
          ...input,
          change_note: changeNote || undefined,
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("保存成功");
        router.push(`/knowledge/${article.id}`);
      } else {
        const result = await createKnowledgeArticle(input);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("知识条目已创建");
        router.push(`/knowledge/${result.id}`);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_280px]">
        {/* 主区域 */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">标题 *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入知识条目标题"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="summary">摘要</Label>
            <Textarea
              id="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="一句话描述（50 字以内）"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">正文（Markdown）*</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="支持 Markdown 格式..."
              rows={18}
              className="font-mono text-sm"
              required
            />
          </div>

          {isEdit && article.status === "approved" && (
            <div className="space-y-2">
              <Label htmlFor="changeNote">变更说明</Label>
              <Input
                id="changeNote"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="请说明本次修改原因（修改 approved 知识将自动存档旧版本）"
              />
            </div>
          )}
        </div>

        {/* 侧边属性 */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">属性设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>分类 *</Label>
                <Select value={category} onValueChange={(v) => { if (v) setCategory(v as KnowledgeCategory); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                      <SelectItem key={k} value={k}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="project_name">所属项目</Label>
                <Input
                  id="project_name"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="项目名称"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="module">模块</Label>
                <Input
                  id="module"
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  placeholder="模块名称"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">版本号</Label>
                <Input
                  id="version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="v1.0"
                />
              </div>

              {members.length > 0 && (
                <div className="space-y-2">
                  <Label>负责人</Label>
                  <Select value={ownerId || "_none"} onValueChange={(v) => setOwnerId(v === null || v === "_none" ? "" : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="选择负责人" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">不设置</SelectItem>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_pinned"
                  checked={isPinned}
                  onCheckedChange={(c) => setIsPinned(!!c)}
                />
                <Label htmlFor="is_pinned" className="cursor-pointer">置顶</Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_ai_searchable"
                  checked={isAiSearchable}
                  onCheckedChange={(c) => setIsAiSearchable(!!c)}
                />
                <Label htmlFor="is_ai_searchable" className="cursor-pointer">允许 AI 检索</Label>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => router.back()}
              disabled={isPending}
            >
              取消
            </Button>
            <Button type="submit" className="flex-1" disabled={isPending}>
              {isPending ? "保存中..." : isEdit ? "保存修改" : "创建知识"}
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
