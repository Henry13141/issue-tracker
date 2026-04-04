"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createIssue } from "@/actions/issues";
import { createSignedUploadUrl, saveAttachmentMeta } from "@/actions/attachments";
import { uploadToSignedUrl } from "@/lib/supabase/upload-to-signed-url";
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
import { CalendarIcon, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { ISSUE_CATEGORIES, ISSUE_MODULES, ISSUE_PRIORITY_LABELS, ISSUE_SOURCE_LABELS } from "@/lib/constants";
import { suggestCategoryAndModule, suggestPriority } from "@/actions/ai";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { formatDateOnly } from "@/lib/dates";

type SubtaskDraft = {
  title: string;
  description: string;
};

export function IssueFormDialog({
  members,
  currentUser,
}: {
  members: User[];
  currentUser: User;
}) {
  const router      = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]           = useState(false);
  const [loading, setLoading]     = useState(false);
  const [title, setTitle]         = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority]   = useState<IssuePriority>("medium");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [reviewerId, setReviewerId] = useState<string>("");
  const [category, setCategory]   = useState("__none__");
  const [module, setModule]       = useState("__none__");
  const [source, setSource]       = useState("manual");
  const [dueDate, setDueDate]     = useState<Date | undefined>(undefined);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiPrioritySuggesting, setAiPrioritySuggesting] = useState(false);
  const isMember = currentUser.role === "member";

  const defaultReviewer = useMemo(() => {
    const scored = members
      .filter((m) => m.role === "admin")
      .map((m) => {
        const name = m.name.trim().toLowerCase();
        const email = m.email.trim().toLowerCase();
        let score = 0;
        if (name === "郝毅") score += 100;
        else if (name.includes("郝毅")) score += 80;
        if (email.startsWith("haoyi@")) score += 60;
        else if (email.includes("haoyi")) score += 40;
        return { member: m, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0]?.member ?? null;
  }, [members]);
  const assigneeName = useMemo(
    () => members.find((m) => m.id === assigneeId)?.name ?? null,
    [members, assigneeId]
  );
  const reviewerName = useMemo(
    () => members.find((m) => m.id === reviewerId)?.name ?? null,
    [members, reviewerId]
  );
  const categoryLabel = category !== "__none__" ? category : "未设置";
  const moduleLabel = module !== "__none__" ? module : "未设置";
  const sourceLabel = ISSUE_SOURCE_LABELS[source] ?? source ?? "手动录入";

  useEffect(() => {
    if (!reviewerId && defaultReviewer?.id) {
      setReviewerId(defaultReviewer.id);
    }
  }, [defaultReviewer?.id, reviewerId]);

  function formatDueStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

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

  function addSubtaskDraft() {
    if (!subtaskTitle.trim()) {
      toast.error("请先填写子任务名字，方便后续跟进");
      return;
    }
    setSubtasks((prev) => [
      ...prev,
      {
        title: subtaskTitle.trim(),
        description: subtaskDescription.trim(),
      },
    ]);
    setSubtaskTitle("");
    setSubtaskDescription("");
  }

  function removeSubtaskDraft(idx: number) {
    setSubtasks((prev) => prev.filter((_, i) => i !== idx));
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setPriority("medium");
    if (isMember) {
      setAssigneeId(currentUser.id);
      setReviewerId(defaultReviewer?.id ?? "");
    } else {
      setAssigneeId("");
      setReviewerId(defaultReviewer?.id ?? "");
    }
    setCategory("__none__");
    setModule("__none__");
    setSource("manual");
    setDueDate(undefined);
    setPendingFiles([]);
    setSubtaskTitle("");
    setSubtaskDescription("");
    setSubtasks([]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("标题是协作的起点，请先填写一个简要标题");
      return;
    }
    setLoading(true);
    try {
      const id = await createIssue({
        title:       title.trim(),
        description: description.trim() || null,
        priority,
        assignee_id: assigneeId && assigneeId !== "__none__" ? assigneeId : null,
        reviewer_id: reviewerId && reviewerId !== "__none__" ? reviewerId : null,
        due_date:    dueDate ? formatDueStr(dueDate) : null,
        category:    category === "__none__" ? null : category,
        module:      module === "__none__" ? null : module,
        source:      source || "manual",
      });

      const subtaskResults = await Promise.allSettled(
        subtasks.map((subtask) =>
          createIssue({
            title: subtask.title,
            description: subtask.description || null,
            priority,
            assignee_id: assigneeId && assigneeId !== "__none__" ? assigneeId : null,
            reviewer_id: reviewerId && reviewerId !== "__none__" ? reviewerId : null,
            category: category === "__none__" ? null : category,
            module: module === "__none__" ? null : module,
            source: source || "manual",
            parent_issue_id: id,
          })
        )
      );

      for (const file of pendingFiles) {
        try {
          if (file.size <= 0) {
            throw new Error(`${file.name} 是空文件，请重新打包后再上传`);
          }
          const { signedUrl, storagePath } = await createSignedUploadUrl(
            id,
            file.name,
            file.type || "application/octet-stream",
            file.size
          );
          const res = await uploadToSignedUrl(
            signedUrl,
            file,
            file.type || "application/octet-stream",
          );
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

      const failedSubtasks = subtaskResults.filter((result) => result.status === "rejected").length;
      if (failedSubtasks > 0) {
        toast.warning(`主任务已创建，但有 ${failedSubtasks} 个子任务未能同步创建，可稍后在详情页补充`);
      } else if (subtasks.length > 0) {
        toast.success(`问题已录入系统，${subtasks.length} 个子任务也一起就位了，相关同事会收到通知`);
      } else {
        toast.success(
          isMember
            ? "问题已录入系统，任务由你负责，审核人将收到知悉"
            : "问题已录入系统，接下来可以分配负责人继续推进"
        );
      }
      setOpen(false);
      resetForm();
      router.push(`/issues/${id}`);
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "这次没有创建成功，内容不会丢失，可以再试一次");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          resetForm();
          setOpen(true);
        }}
      >
        新建问题
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>新建问题</DialogTitle>
            <p className="text-xs text-muted-foreground">
              每一个问题的录入都在帮团队把事情往前推
            </p>
          </DialogHeader>
          <form onSubmit={onSubmit} className="max-h-[calc(88vh-88px)] overflow-y-auto px-6 pb-6">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
              <div className="space-y-5">
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
                    rows={5}
                  />
                </div>
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <Label className="text-sm font-medium">子任务</Label>
                      <p className="text-xs text-muted-foreground">
                        可在创建主任务时一起补充子任务，负责人将自动沿用主任务负责人
                      </p>
                    </div>
                    {subtasks.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        共 {subtasks.length} 项
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Input
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      placeholder="子任务名字"
                    />
                    <Textarea
                      value={subtaskDescription}
                      onChange={(e) => setSubtaskDescription(e.target.value)}
                      placeholder="子任务详情（可选）"
                      rows={2}
                    />
                    <div className="flex justify-end">
                      <Button type="button" variant="outline" size="sm" onClick={addSubtaskDraft}>
                        添加子任务
                      </Button>
                    </div>
                  </div>
                  {subtasks.length > 0 && (
                    <div className="rounded-md border bg-background">
                      {subtasks.map((subtask, idx) => (
                        <div
                          key={`${subtask.title}-${idx}`}
                          className="flex items-start gap-3 border-b px-3 py-2.5 last:border-b-0"
                        >
                          <span className="mt-0.5 text-base leading-none text-muted-foreground">•</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{subtask.title}</p>
                            {subtask.description && (
                              <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                {subtask.description}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeSubtaskDraft(idx)}
                            aria-label="删除子任务"
                          >
                            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">优先级 / 截止日期</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                      disabled={aiPrioritySuggesting || (!title.trim() && !description.trim())}
                      onClick={async () => {
                        setAiPrioritySuggesting(true);
                        try {
                          const result = await suggestPriority(title.trim(), description.trim());
                          if (result) {
                            setPriority(result.priority);
                            if (result.suggestedDueDays != null && !dueDate) {
                              const d = new Date();
                              d.setDate(d.getDate() + result.suggestedDueDays);
                              setDueDate(d);
                            }
                            toast.success(`AI 建议优先级为「${ISSUE_PRIORITY_LABELS[result.priority]}」— ${result.reason}`);
                          } else {
                            toast.info("AI 这次没有把握，你可以根据实际情况手动设置");
                          }
                        } catch {
                          toast.error("AI 推荐暂时不可用，手动设置也很快");
                        } finally {
                          setAiPrioritySuggesting(false);
                        }
                      }}
                    >
                      {aiPrioritySuggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI 推荐优先级
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="space-y-2">
                      <Label>优先级</Label>
                      <Select value={priority} onValueChange={(v) => setPriority(v as IssuePriority)}>
                        <SelectTrigger>
                          <SelectValue>{ISSUE_PRIORITY_LABELS[priority]}</SelectValue>
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
                      <Label>截止日期（可选）</Label>
                      <Popover>
                        <PopoverTrigger
                          className={cn(
                            buttonVariants({ variant: "outline" }),
                            "w-full justify-start text-left font-normal",
                            !dueDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dueDate ? formatDateOnly(formatDueStr(dueDate)) : "选择日期"}
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={dueDate} onSelect={setDueDate} />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>负责人</Label>
                  {isMember ? (
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                      {currentUser.name}
                    </div>
                  ) : (
                    <Select
                      value={assigneeId || "__none__"}
                      onValueChange={(v) => setAssigneeId(v ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="未分配">
                          {assigneeId && assigneeId !== "__none__" ? assigneeName ?? "未分配" : "未分配"}
                        </SelectValue>
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
                  )}
                </div>

                <div className="space-y-2">
                  <Label>审核人</Label>
                  {isMember ? (
                    <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                      {defaultReviewer?.name ?? "郝毅"}
                    </div>
                  ) : (
                    <Select
                      value={reviewerId || "__none__"}
                      onValueChange={(v) => setReviewerId(v ?? "")}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="请选择审核人">
                          {reviewerId && reviewerId !== "__none__" ? reviewerName ?? "未指定" : "未指定"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">未指定</SelectItem>
                        {members.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">
                      {isMember ? "任务类型（分类与模块）" : "分类 / 模块"}
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                      disabled={aiSuggesting || !title.trim()}
                      onClick={async () => {
                        setAiSuggesting(true);
                        try {
                          const result = await suggestCategoryAndModule(title.trim());
                          if (result) {
                            if (result.category) setCategory(result.category);
                            if (result.module) setModule(result.module);
                            toast.success("AI 已帮你匹配了分类和模块，确认后可以直接使用");
                          } else {
                            toast.info("AI 这次没有把握，你可以手动选择分类和模块");
                          }
                        } catch {
                          toast.error("AI 推荐暂时不可用，手动选择也很快");
                        } finally {
                          setAiSuggesting(false);
                        }
                      }}
                    >
                      {aiSuggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      AI 推荐
                    </Button>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="space-y-2">
                      <Label>分类（可选）</Label>
                      <Select value={category} onValueChange={(v) => setCategory(v ?? "__none__")}>
                        <SelectTrigger>
                          <SelectValue placeholder="请选择分类">{categoryLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">未设置</SelectItem>
                          {ISSUE_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>模块（可选）</Label>
                      <Select value={module} onValueChange={(v) => setModule(v ?? "__none__")}>
                        <SelectTrigger>
                          <SelectValue placeholder="请选择模块">{moduleLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">未设置</SelectItem>
                          {ISSUE_MODULES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {!isMember ? (
                  <div className="space-y-2">
                    <Label>来源</Label>
                    <Select value={source} onValueChange={(v) => setSource(v ?? "manual")}>
                      <SelectTrigger>
                        <SelectValue>{sourceLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">手动录入</SelectItem>
                        <SelectItem value="import">Excel 导入</SelectItem>
                        <SelectItem value="webhook">Webhook</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

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
              </div>
            </div>

            {(assigneeId && assigneeId !== "__none__") && (
              <p className="mt-4 text-xs text-muted-foreground">
                提交后，{assigneeName ?? "负责人"}会收到通知
                {reviewerId && reviewerId !== "__none__" ? `，${reviewerName ?? "审核人"}也会同步知悉` : ""}
              </p>
            )}
            <DialogFooter className="mt-4">
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
