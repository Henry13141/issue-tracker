"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createIssue } from "@/actions/issues";
import { createSignedUploadUrl, saveAttachmentMeta } from "@/actions/attachments";
import type { IssuePriority, User } from "@/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Paperclip, X } from "lucide-react";
import { toast } from "sonner";

export function IssueFormDialog({ members }: { members: User[] }) {
  const router      = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [title, setTitle]         = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority]   = useState<IssuePriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [category, setCategory]   = useState("");
  const [module, setModule]       = useState("");
  const [source, setSource]       = useState("manual");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    setPendingFiles((prev) => [
      ...prev,
      ...Array.from(files).filter((f) => f.size <= 20 * 1024 * 1024),
    ]);
  }

  function removeFile(idx: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setAssigneeId("");
    setCategory("");
    setModule("");
    setSource("manual");
    setPendingFiles([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("请填写标题");
      return;
    }
    setLoading(true);
    try {
      const id = await createIssue({
        title:       title.trim(),
        description: description.trim() || null,
        priority,
        assignee_id: assigneeId && assigneeId !== "__none__" ? assigneeId : null,
        due_date:    null,
        category:    category.trim() || null,
        module:      module.trim()   || null,
        source:      source || "manual",
      });

      for (const file of pendingFiles) {
        try {
          const { signedUrl, storagePath } = await createSignedUploadUrl(
            id,
            file.name,
            file.type || "application/octet-stream",
            file.size
          );
          const res = await fetch(signedUrl, {
            method:  "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body:    file,
          });
          if (res.ok) {
            await saveAttachmentMeta({
              issueId:     id,
              storagePath,
              filename:    file.name,
              contentType: file.type || "application/octet-stream",
              sizeBytes:   file.size,
            });
          }
        } catch {
          // 单个文件失败不影响创建
        }
      }

      toast.success("已创建问题");
      setOpen(false);
      resetForm();
      router.push(`/issues/${id}`);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        新建问题
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>新建问题</DialogTitle>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ititle">标题</Label>
              <Input
                id="ititle"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简要描述问题"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="idesc">描述</Label>
              <Textarea
                id="idesc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="复现步骤、期望行为等"
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>优先级</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="urgent">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>负责人</Label>
                <Select
                  value={assigneeId || "__none__"}
                  onValueChange={(v) => setAssigneeId(v ?? "")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="未分配" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">未分配</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="icategory">分类（可选）</Label>
                <Input
                  id="icategory"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="如「前端」「后端」"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="imodule">模块（可选）</Label>
                <Input
                  id="imodule"
                  value={module}
                  onChange={(e) => setModule(e.target.value)}
                  placeholder="如「登录」「报表」"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>来源</Label>
              <Select value={source} onValueChange={(v) => setSource(v ?? "manual")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">手动录入</SelectItem>
                  <SelectItem value="import">Excel 导入</SelectItem>
                  <SelectItem value="webhook">Webhook</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-3.5 w-3.5" />
                添加附件（可选）
              </Button>
              {pendingFiles.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingFiles.map((f, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs"
                    >
                      {f.name}
                      <button type="button" onClick={() => removeFile(i)}>
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "提交中…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
