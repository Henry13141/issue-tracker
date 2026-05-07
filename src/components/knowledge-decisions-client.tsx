"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  KnowledgeDecisionWithRelations,
  KnowledgeDecisionStatus,
  User,
} from "@/types";
import {
  createKnowledgeDecision,
  updateKnowledgeDecision,
  type CreateKnowledgeDecisionInput,
} from "@/actions/knowledge-decisions";
import { PlusCircle, Clock, CheckCircle2, XCircle } from "lucide-react";

const DECISION_STATUS_LABELS: Record<KnowledgeDecisionStatus, string> = {
  draft: "草稿",
  confirmed: "已确认",
  superseded: "已废止",
};

const DECISION_STATUS_BADGE: Record<KnowledgeDecisionStatus, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  confirmed: "default",
  superseded: "destructive",
};

interface Props {
  decisions: KnowledgeDecisionWithRelations[];
  total: number;
  currentUser: User;
}

type DecisionFormData = {
  title: string;
  project_name: string;
  module: string;
  background: string;
  decision: string;
  reason: string;
  impact: string;
  article_id: string;
  issue_id: string;
};

const EMPTY_FORM: DecisionFormData = {
  title: "",
  project_name: "",
  module: "",
  background: "",
  decision: "",
  reason: "",
  impact: "",
  article_id: "",
  issue_id: "",
};

export function KnowledgeDecisionsClient({ decisions, total, currentUser }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<DecisionFormData>(EMPTY_FORM);

  function setField(key: keyof DecisionFormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleCreate() {
    if (!form.title.trim()) {
      toast.error("请填写决策标题");
      return;
    }
    if (!form.decision.trim()) {
      toast.error("请填写决策内容");
      return;
    }

    const input: CreateKnowledgeDecisionInput = {
      title: form.title.trim(),
      project_name: form.project_name || undefined,
      module: form.module || undefined,
      background: form.background || undefined,
      decision: form.decision.trim(),
      reason: form.reason || undefined,
      impact: form.impact || undefined,
      article_id: form.article_id.trim() || undefined,
      issue_id: form.issue_id.trim() || undefined,
    };

    startTransition(async () => {
      const result = await createKnowledgeDecision(input);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("决策记录已创建");
      setForm(EMPTY_FORM);
      setCreateOpen(false);
      router.refresh();
    });
  }

  function handleConfirm(id: string) {
    startTransition(async () => {
      const result = await updateKnowledgeDecision(id, { status: "confirmed" });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("决策已确认");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">共 {total} 条决策记录</p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <PlusCircle className="mr-1.5 h-4 w-4" />
                新建决策
              </Button>
            }
          />
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>新建决策记录</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="d-title">决策标题 *</Label>
                  <Input
                    id="d-title"
                    value={form.title}
                    onChange={(e) => setField("title", e.target.value)}
                    placeholder="简洁描述决策主题"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="d-project">所属项目</Label>
                  <Input
                    id="d-project"
                    value={form.project_name}
                    onChange={(e) => setField("project_name", e.target.value)}
                    placeholder="项目名称"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="d-module">模块</Label>
                  <Input
                    id="d-module"
                    value={form.module}
                    onChange={(e) => setField("module", e.target.value)}
                    placeholder="模块名称"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-background">背景</Label>
                <Textarea
                  id="d-background"
                  value={form.background}
                  onChange={(e) => setField("background", e.target.value)}
                  placeholder="为什么需要做这个决策"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-decision">决策内容 *</Label>
                <Textarea
                  id="d-decision"
                  value={form.decision}
                  onChange={(e) => setField("decision", e.target.value)}
                  placeholder="具体决策结论"
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-reason">决策原因</Label>
                <Textarea
                  id="d-reason"
                  value={form.reason}
                  onChange={(e) => setField("reason", e.target.value)}
                  placeholder="为什么选择这个方案"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-impact">影响范围</Label>
                <Input
                  id="d-impact"
                  value={form.impact}
                  onChange={(e) => setField("impact", e.target.value)}
                  placeholder="影响哪些系统/流程/团队"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="d-article-id">关联知识条目 ID</Label>
                  <Input
                    id="d-article-id"
                    value={form.article_id}
                    onChange={(e) => setField("article_id", e.target.value)}
                    placeholder="粘贴知识条目 UUID（可选）"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="d-issue-id">关联 Issue ID</Label>
                  <Input
                    id="d-issue-id"
                    value={form.issue_id}
                    onChange={(e) => setField("issue_id", e.target.value)}
                    placeholder="粘贴 Issue UUID（可选）"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button>
                <Button onClick={handleCreate} disabled={isPending}>创建</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {decisions.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-muted-foreground">
          <p>暂无决策记录</p>
        </div>
      ) : (
        <div className="space-y-3">
          {decisions.map((d) => (
            <DecisionCard
              key={d.id}
              decision={d}
              currentUser={currentUser}
              isPending={isPending}
              onConfirm={() => handleConfirm(d.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  decision,
  currentUser,
  isPending,
  onConfirm,
}: {
  decision: KnowledgeDecisionWithRelations;
  currentUser: User;
  isPending: boolean;
  onConfirm: () => void;
}) {
  const isAdmin = currentUser.role === "admin";
  const isOwner = decision.created_by === currentUser.id;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="font-medium leading-snug">{decision.title}</h3>
              {(decision.project_name || decision.module) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[decision.project_name, decision.module].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <Badge variant={DECISION_STATUS_BADGE[decision.status]}>
              {DECISION_STATUS_LABELS[decision.status]}
              {decision.status === "confirmed" && <CheckCircle2 className="ml-1 h-3 w-3" />}
              {decision.status === "superseded" && <XCircle className="ml-1 h-3 w-3" />}
            </Badge>
          </div>

          {decision.background && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">背景：</span>
              {decision.background}
            </p>
          )}
          <p className="text-sm">
            <span className="font-medium">决策：</span>
            {decision.decision}
          </p>
          {decision.reason && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">原因：</span>
              {decision.reason}
            </p>
          )}
          {decision.impact && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">影响：</span>
              {decision.impact}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground">
            {decision.creator && <span>创建：{decision.creator.name}</span>}
            {decision.decider && <span>决策人：{decision.decider.name}</span>}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {new Date(decision.updated_at).toLocaleDateString("zh-CN")}
            </span>
            {(isAdmin || isOwner) && decision.status === "draft" && (
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-6 text-xs"
                disabled={isPending}
                onClick={onConfirm}
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                确认决策
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export { DECISION_STATUS_LABELS, DECISION_STATUS_BADGE };
