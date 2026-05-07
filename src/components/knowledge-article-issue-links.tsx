"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import type { KnowledgeIssueLinkWithRelations, KnowledgeRelationType } from "@/types";
import {
  addKnowledgeIssueLink,
  removeKnowledgeIssueLink,
} from "@/actions/knowledge";
import { PlusCircle, Trash2, ExternalLink } from "lucide-react";
import { ISSUE_STATUS_LABELS } from "@/lib/constants";

const RELATION_TYPE_LABELS: Record<KnowledgeRelationType, string> = {
  reference: "参考资料",
  spec_for: "执行依据",
  acceptance_for: "验收标准",
  implements: "实现内容",
  blocks: "阻塞关联",
  result_from: "产出知识",
};

interface Props {
  articleId: string;
  links: KnowledgeIssueLinkWithRelations[];
  canEdit: boolean;
}

export function KnowledgeArticleIssueLinks({ articleId, links, canEdit }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [issueId, setIssueId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeRelationType>("reference");

  function handleAdd() {
    if (!issueId.trim()) {
      toast.error("请输入 Issue ID");
      return;
    }

    startTransition(async () => {
      const result = await addKnowledgeIssueLink(articleId, issueId.trim(), relationType);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("关联已添加");
      setIssueId("");
      setOpen(false);
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

  const grouped = links.reduce<Record<KnowledgeRelationType, KnowledgeIssueLinkWithRelations[]>>(
    (acc, link) => {
      const rt = link.relation_type as KnowledgeRelationType;
      if (!acc[rt]) acc[rt] = [];
      acc[rt].push(link);
      return acc;
    },
    {} as Record<KnowledgeRelationType, KnowledgeIssueLinkWithRelations[]>
  );

  return (
    <div className="space-y-3">
      {links.length === 0 && (
        <p className="text-sm text-muted-foreground">暂无关联任务</p>
      )}

      {(Object.keys(grouped) as KnowledgeRelationType[]).map((rt) => (
        <div key={rt}>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {RELATION_TYPE_LABELS[rt]}
          </p>
          <div className="space-y-1">
            {grouped[rt].map((link) => (
              <div key={link.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                {link.issue ? (
                  <>
                    <Link
                      href={`/issues/${link.issue.id}`}
                      className="flex-1 text-sm hover:underline line-clamp-1"
                    >
                      {link.issue.title}
                    </Link>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {ISSUE_STATUS_LABELS[link.issue.status] ?? link.issue.status}
                    </Badge>
                    <Link href={`/issues/${link.issue.id}`} target="_blank">
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                    </Link>
                  </>
                ) : (
                  <span className="flex-1 text-sm text-muted-foreground">{link.issue_id}</span>
                )}
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={isPending}
                    onClick={() => handleRemove(link.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button variant="outline" size="sm">
                <PlusCircle className="mr-1.5 h-4 w-4" />
                添加关联任务
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>添加关联任务</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="issue-id">Issue ID（UUID）</Label>
                <Input
                  id="issue-id"
                  value={issueId}
                  onChange={(e) => setIssueId(e.target.value)}
                  placeholder="粘贴 Issue ID..."
                />
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
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
                <Button onClick={handleAdd} disabled={isPending}>添加</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export { RELATION_TYPE_LABELS };
