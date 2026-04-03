"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createIssue } from "@/actions/issues";
import type { IssueSummary, IssueWithRelations } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus } from "lucide-react";
import { toast } from "sonner";

export function CreateSubtaskDialog({
  parentIssue,
  onCreated,
}: {
  parentIssue: IssueWithRelations;
  onCreated: (child: IssueSummary) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setTitle("");
    setDescription("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请填写子任务标题");
      return;
    }
    setLoading(true);
    try {
      const id = await createIssue({
        title: title.trim(),
        description: description.trim() || null,
        priority: parentIssue.priority,
        assignee_id: parentIssue.assignee_id ?? null,
        reviewer_id: parentIssue.reviewer_id ?? null,
        category: parentIssue.category ?? null,
        module: parentIssue.module ?? null,
        source: parentIssue.source ?? "manual",
        parent_issue_id: parentIssue.id,
      });

      onCreated({
        id,
        title: title.trim(),
        description: description.trim() || null,
        status: "todo",
        priority: parentIssue.priority,
        assignee_id: parentIssue.assignee_id ?? null,
        due_date: null,
        assignee: parentIssue.assignee
          ? { id: parentIssue.assignee.id, name: parentIssue.assignee.name }
          : null,
      });

      toast.success("子任务已创建");
      setOpen(false);
      resetForm();
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="h-3.5 w-3.5" />
        新建子任务
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建子任务</DialogTitle>
            <p className="text-xs text-muted-foreground truncate">
              负责人将自动沿用父任务：{parentIssue.assignee?.name ?? "未分配"}
            </p>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subtask-title">任务名字</Label>
              <Input
                id="subtask-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简要描述子任务"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subtask-desc">详情</Label>
              <Textarea
                id="subtask-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="补充任务详情、备注或验收口径"
                rows={3}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "创建中…" : "创建子任务"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
