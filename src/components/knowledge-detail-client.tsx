"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { KnowledgeArticleWithRelations, KnowledgeStatus, User } from "@/types";
import {
  updateKnowledgeStatus,
  submitForReview,
} from "@/actions/knowledge";
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
} from "@/components/knowledge-list-client";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { Edit, Send, CheckCircle2, Archive, XCircle, Pin } from "lucide-react";

interface Props {
  article: KnowledgeArticleWithRelations;
  currentUser: User;
}

const ADMIN_STATUS_OPTIONS: { value: KnowledgeStatus; label: string }[] = [
  { value: "approved", label: "标记为已确认" },
  { value: "deprecated", label: "标记为已废弃" },
  { value: "archived", label: "标记为已归档" },
  { value: "draft", label: "退回草稿" },
];

export function KnowledgeDetailClient({ article, currentUser }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [targetStatus, setTargetStatus] = useState<KnowledgeStatus>("approved");

  const isAdmin = currentUser.role === "admin";
  const isOwner =
    article.created_by === currentUser.id || article.owner_id === currentUser.id;
  const canEdit = isAdmin || (isOwner && ["draft", "reviewing"].includes(article.status));

  function handleSubmitReview() {
    startTransition(async () => {
      const result = await submitForReview(article.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("已提交审核");
      router.refresh();
    });
  }

  function handleStatusChange() {
    startTransition(async () => {
      const result = await updateKnowledgeStatus(article.id, targetStatus);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`状态已更新为「${STATUS_LABELS[targetStatus]}」`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* 元信息行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_BADGE_VARIANT[article.status]}>
          {STATUS_LABELS[article.status]}
        </Badge>
        <Badge variant="outline">{CATEGORY_LABELS[article.category] ?? article.category}</Badge>
        {article.module && <Badge variant="outline">{article.module}</Badge>}
        <span className="text-sm text-muted-foreground font-mono">{article.version}</span>
        {article.is_pinned && (
          <span className="flex items-center gap-1 text-xs text-amber-500">
            <Pin className="h-3 w-3" />置顶
          </span>
        )}
        {article.project_name && (
          <span className="text-sm text-muted-foreground">项目：{article.project_name}</span>
        )}
        {article.owner && (
          <span className="text-sm text-muted-foreground">负责人：{article.owner.name}</span>
        )}
        {article.approved_by && article.approver && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            由 {article.approver.name} 确认
          </span>
        )}
      </div>

      {/* 操作按钮区 */}
      <div className="flex flex-wrap gap-2">
        {/* 编辑 */}
        {canEdit && (
          <Link
            href={`/knowledge/${article.id}/edit`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            <Edit className="mr-1.5 h-4 w-4" />
            编辑
          </Link>
        )}

        {/* 提交审核（draft 状态 + 是 owner）*/}
        {(isOwner || isAdmin) && article.status === "draft" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSubmitReview}
            disabled={isPending}
          >
            <Send className="mr-1.5 h-4 w-4" />
            提交审核
          </Button>
        )}

        {/* admin 状态变更 */}
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Select value={targetStatus} onValueChange={(v) => setTargetStatus(v as KnowledgeStatus)}>
              <SelectTrigger className="h-8 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default" size="sm" disabled={isPending}>
                  {targetStatus === "approved" && <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  {targetStatus === "archived" && <Archive className="mr-1.5 h-4 w-4" />}
                  {targetStatus === "deprecated" && <XCircle className="mr-1.5 h-4 w-4" />}
                  执行
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认状态变更</AlertDialogTitle>
                  <AlertDialogDescription>
                    将知识「{article.title}」状态变更为「{STATUS_LABELS[targetStatus]}」？
                    {targetStatus === "approved" && " 确认后该知识将成为正式执行依据。"}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={handleStatusChange}>确认</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* 摘要 */}
      {article.summary && (
        <p className="rounded-md bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {article.summary}
        </p>
      )}

      {/* 时间信息 */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>创建：{new Date(article.created_at).toLocaleString("zh-CN")}</span>
        <span>更新：{new Date(article.updated_at).toLocaleString("zh-CN")}</span>
        {article.approved_at && (
          <span>确认：{new Date(article.approved_at).toLocaleString("zh-CN")}</span>
        )}
      </div>
    </div>
  );
}
