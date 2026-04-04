"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createIssue } from "@/actions/issues";
import { createSignedUploadUrl, saveAttachmentMeta } from "@/actions/attachments";
import { uploadToSignedUrl } from "@/lib/supabase/upload-to-signed-url";
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
import { Paperclip, Plus, X } from "lucide-react";
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setPendingFiles([]);
  }

  async function uploadSubtaskAttachments(issueId: string, files: File[]) {
    if (files.length === 0) return { success: 0, failed: 0 };

    const tasks = files.map(async (file) => {
      const contentType = file.type || "application/octet-stream";
      const { signedUrl, storagePath } = await createSignedUploadUrl(
        issueId,
        file.name,
        contentType,
        file.size
      );
      const uploadRes = await uploadToSignedUrl(signedUrl, file, contentType);
      if (!uploadRes.ok) throw new Error(`上传失败 (${uploadRes.status})`);
      await saveAttachmentMeta({
        issueId,
        issueUpdateId: null,
        storagePath,
        filename: file.name,
        contentType,
        sizeBytes: file.size,
      });
    });

    const settled = await Promise.allSettled(tasks);
    const success = settled.filter((r) => r.status === "fulfilled").length;
    const failed = settled.length - success;
    return { success, failed };
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请先填写子任务标题，方便后续跟进");
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
          ? {
              id: parentIssue.assignee.id,
              name: parentIssue.assignee.name,
              avatar_url: parentIssue.assignee.avatar_url,
            }
          : null,
      });

      const filesToUpload = [...pendingFiles];
      const hasAttachments = filesToUpload.length > 0;

      if (hasAttachments) {
        toast.success(`子任务已创建，正在后台上传 ${filesToUpload.length} 个附件`);
      } else {
        toast.success("子任务已拆分就位，后续执行会更清晰");
      }

      setOpen(false);
      resetForm();
      router.refresh();

      if (hasAttachments) {
        void uploadSubtaskAttachments(id, filesToUpload)
          .then((uploaded) => {
            if (uploaded.failed === 0) {
              toast.success(`附件上传完成，共 ${uploaded.success} 个`);
            } else {
              toast.error(`附件上传完成：成功 ${uploaded.success}，失败 ${uploaded.failed}`);
            }
            router.refresh();
          })
          .catch(() => {
            toast.error("附件后台上传失败，请稍后重试");
          });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "创建暂时没成功，可以再试一次");
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
            <div className="space-y-2">
              <Label htmlFor="subtask-files">附件（可选）</Label>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="subtask-files"
                  className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs text-muted-foreground hover:bg-muted"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  选择附件
                </label>
                <input
                  id="subtask-files"
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (!files.length) return;
                    setPendingFiles((prev) => [...prev, ...files]);
                    e.currentTarget.value = "";
                  }}
                />
                {pendingFiles.length > 0 ? (
                  <span className="text-xs text-muted-foreground">已选 {pendingFiles.length} 个</span>
                ) : null}
              </div>
              {pendingFiles.length > 0 && (
                <div className="max-h-28 space-y-1 overflow-y-auto rounded-md border p-2">
                  {pendingFiles.map((f, i) => (
                    <div key={`${f.name}-${f.size}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="移除附件"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
