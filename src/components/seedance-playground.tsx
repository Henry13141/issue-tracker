"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  ImageIcon,
  Loader2,
  Music4,
  Play,
  RefreshCw,
  Sparkles,
  Video,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type {
  SeedanceContentItem,
  SeedanceTaskListResult,
  SeedanceTaskSummary,
} from "@/lib/ark-seedance";
import { uploadToSignedUrl } from "@/lib/supabase/upload-to-signed-url";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type LocalAssetKind = "image" | "video" | "audio";
type UploadedLocalAsset = {
  kind: LocalAssetKind;
  filename: string;
  url: string;
};

type ApiResult = {
  task?: SeedanceTaskSummary;
  error?: string;
  details?: unknown;
};

type HistoryResult = SeedanceTaskListResult & {
  error?: string;
};

const DEFAULT_MODEL = "doubao-seedance-2-0-260128";
const RATIO_OPTIONS = ["16:9", "9:16", "1:1", "4:3"] as const;
const DURATION_OPTIONS = [5, 10, 15] as const;
const MAX_IMAGE_TOTAL_PIXELS = 36_000_000;

const ACCEPT_BY_KIND: Record<LocalAssetKind, string> = {
  image: "image/jpeg,image/jpg,image/png,image/webp,image/gif",
  video: "video/mp4,video/quicktime,video/webm,video/x-matroska",
  audio: "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/webm",
};
const KIND_ICON = {
  image: ImageIcon,
  video: Video,
  audio: Volume2,
} as const;

function splitMultilineUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function appendUrlLine(previous: string, url: string) {
  const lines = splitMultilineUrls(previous);
  if (lines.includes(url)) return previous;
  return lines.length > 0 ? `${lines.join("\n")}\n${url}` : url;
}

function removeUrlLine(previous: string, url: string) {
  return splitMultilineUrls(previous)
    .filter((line) => line !== url)
    .join("\n");
}

function buildContent(
  prompt: string,
  imageUrls: string[],
  videoUrls: string[],
  audioUrls: string[]
): SeedanceContentItem[] {
  return [
    { type: "text", text: prompt.trim() },
    ...imageUrls.map((url) => ({
      type: "image_url" as const,
      role: "reference_image" as const,
      image_url: { url },
    })),
    ...videoUrls.map((url) => ({
      type: "video_url" as const,
      role: "reference_video" as const,
      video_url: { url },
    })),
    ...audioUrls.map((url) => ({
      type: "audio_url" as const,
      role: "reference_audio" as const,
      audio_url: { url },
    })),
  ];
}

function statusLabel(status: string) {
  switch (status) {
    case "queued":
      return "排队中";
    case "running":
      return "生成中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status || "未知";
  }
}

function isTerminal(status: string | null | undefined) {
  return Boolean(status && ["succeeded", "failed", "cancelled"].includes(status));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function kindLabel(kind: LocalAssetKind) {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  return "音频";
}

async function loadImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("读取图片尺寸失败"));
      image.src = objectUrl;
    });
    return dimensions;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function downscaleImageIfNeeded(file: File): Promise<{ file: File; resized: boolean; width: number; height: number }> {
  const { width, height } = await loadImageDimensions(file);
  const totalPixels = width * height;
  if (totalPixels <= MAX_IMAGE_TOTAL_PIXELS) {
    return { file, resized: false, width, height };
  }

  const scale = Math.sqrt(MAX_IMAGE_TOTAL_PIXELS / totalPixels);
  const targetWidth = Math.max(1, Math.floor(width * scale));
  const targetHeight = Math.max(1, Math.floor(height * scale));

  const objectUrl = URL.createObjectURL(file);
  try {
    const resizedBlob = await new Promise<Blob>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("无法初始化图片缩放画布"));
          return;
        }
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("生成缩放图片失败"));
              return;
            }
            resolve(blob);
          },
          file.type === "image/png" ? "image/png" : "image/jpeg",
          0.92
        );
      };
      image.onerror = () => reject(new Error("图片缩放失败"));
      image.src = objectUrl;
    });

    const nextType = resizedBlob.type || (file.type === "image/png" ? "image/png" : "image/jpeg");
    const nextExt = nextType === "image/png" ? "png" : nextType === "image/webp" ? "webp" : "jpg";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const nextName = `${baseName}-scaled.${nextExt}`;

    return {
      file: new File([resizedBlob], nextName, { type: nextType }),
      resized: true,
      width: targetWidth,
      height: targetHeight,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function UploadEntry({
  kind,
  count,
  busy,
  onPick,
}: {
  kind: LocalAssetKind;
  count: number;
  busy: boolean;
  onPick: () => void;
}) {
  const Icon = KIND_ICON[kind];

  return (
    <button
      type="button"
      onClick={onPick}
      className="group rounded-2xl border border-border/70 bg-card/90 p-4 text-left transition hover:border-primary/30 hover:bg-muted/40"
    >
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <p className="text-sm font-medium">添加参考{kindLabel(kind)}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {count > 0 ? `已添加 ${count} 个${kindLabel(kind)}` : `上传本地${kindLabel(kind)}或回填公网 URL`}
      </p>
    </button>
  );
}

function UploadedAssetGallery({
  kind,
  assets,
  onRemove,
}: {
  kind: LocalAssetKind;
  assets: UploadedLocalAsset[];
  onRemove: (url: string) => void;
}) {
  if (assets.length === 0) return null;

  if (kind === "image") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {assets.map((asset) => (
          <div key={asset.url} className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="relative aspect-square bg-muted/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.filename} className="h-full w-full object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-white">
                <p className="truncate text-xs font-medium">{asset.filename}</p>
              </div>
              <div className="absolute right-2 top-2 flex gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                  title="打开原图"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(asset.url)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                  title="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {assets.map((asset) => {
        const Icon = kind === "video" ? Play : Music4;
        return (
          <div
            key={asset.url}
            className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-3 py-3 shadow-sm"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{asset.filename}</p>
                <p className="truncate text-xs text-muted-foreground">{asset.url}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={asset.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="打开文件"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                type="button"
                onClick={() => onRemove(asset.url)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="移除"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SeedancePlayground({
  configured,
}: {
  configured: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [imageUrls, setImageUrls] = useState("");
  const [videoUrls, setVideoUrls] = useState("");
  const [audioUrls, setAudioUrls] = useState("");
  const [ratio, setRatio] = useState<(typeof RATIO_OPTIONS)[number]>("16:9");
  const [duration, setDuration] = useState("5");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [task, setTask] = useState<SeedanceTaskSummary | null>(null);
  const [taskIdInput, setTaskIdInput] = useState("");
  const [historyItems, setHistoryItems] = useState<SeedanceTaskSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showManualUrls, setShowManualUrls] = useState(false);
  const [uploading, setUploading] = useState<Record<LocalAssetKind, boolean>>({
    image: false,
    video: false,
    audio: false,
  });
  const [uploadedAssets, setUploadedAssets] = useState<Record<LocalAssetKind, UploadedLocalAsset[]>>({
    image: [],
    video: [],
    audio: [],
  });
  const notifiedRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const parsedDuration = useMemo(() => Number(duration), [duration]);
  const shouldAutoPoll = Boolean(task?.taskId && !isTerminal(task.status));
  const referenceCount =
    splitMultilineUrls(imageUrls).length +
    splitMultilineUrls(videoUrls).length +
    splitMultilineUrls(audioUrls).length;

  async function parseResponse(response: Response) {
    const data = (await response.json().catch(() => ({}))) as ApiResult;
    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }
    if (!data.task) {
      throw new Error("服务端未返回任务信息");
    }
    return data.task;
  }

  async function refreshTask(targetTaskId?: string) {
    const nextTaskId = (targetTaskId ?? taskIdInput ?? task?.taskId ?? "").trim();
    if (!nextTaskId) {
      toast.error("请先输入任务 ID");
      return;
    }

    setRefreshing(true);
    try {
      const nextTask = await parseResponse(
        await fetch(`/api/seedance/tasks/${encodeURIComponent(nextTaskId)}`, {
          method: "GET",
          cache: "no-store",
        })
      );
      setTask(nextTask);
      setTaskIdInput(nextTask.taskId || nextTaskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询任务失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/seedance/tasks?pageNum=1&pageSize=12", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as HistoryResult;
      if (!response.ok) {
        throw new Error(payload.error || "查询历史任务失败");
      }
      setHistoryItems(payload.items ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询历史任务失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function uploadLocalFiles(kind: LocalAssetKind, files: FileList | null) {
    if (!files || files.length === 0) return;

    setUploading((prev) => ({ ...prev, [kind]: true }));
    try {
      for (const file of Array.from(files)) {
        let uploadFile = file;
        if (kind === "image") {
          const normalized = await downscaleImageIfNeeded(file);
          uploadFile = normalized.file;
          if (normalized.resized) {
            toast.info(`已自动缩放超大图片为 ${normalized.width} × ${normalized.height} 后上传`);
          }
        }

        const initResponse = await fetch("/api/seedance/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            filename: uploadFile.name,
            contentType: uploadFile.type || "application/octet-stream",
            sizeBytes: uploadFile.size,
          }),
        });
        if (!initResponse.ok) {
          const payload = (await initResponse.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || `上传失败 (${initResponse.status})`);
        }

        const payload = (await initResponse.json()) as { url?: string; signedUrl?: string };
        const publicUrl = payload.url?.trim();
        const signedUrl = payload.signedUrl?.trim();
        if (!signedUrl) throw new Error("服务端未返回上传地址");
        if (!publicUrl) throw new Error("服务端未返回素材 URL");

        const uploadResponse = await uploadToSignedUrl(
          signedUrl,
          uploadFile,
          uploadFile.type || "application/octet-stream"
        );
        if (!uploadResponse.ok) {
          throw new Error(`上传文件失败 (${uploadResponse.status})`);
        }

        setUploadedAssets((prev) => {
          const nextItems = prev[kind].some((item) => item.url === publicUrl)
            ? prev[kind]
            : [...prev[kind], { kind, filename: uploadFile.name, url: publicUrl }];
          return { ...prev, [kind]: nextItems };
        });

        if (kind === "image") {
          setImageUrls((prev) => appendUrlLine(prev, publicUrl));
        } else if (kind === "video") {
          setVideoUrls((prev) => appendUrlLine(prev, publicUrl));
        } else {
          setAudioUrls((prev) => appendUrlLine(prev, publicUrl));
        }
      }

      toast.success(`本地${kindLabel(kind)}已上传并回填 URL`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
      if (kind === "image" && imageInputRef.current) imageInputRef.current.value = "";
      if (kind === "video" && videoInputRef.current) videoInputRef.current.value = "";
      if (kind === "audio" && audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  function removeUploadedAsset(kind: LocalAssetKind, url: string) {
    setUploadedAssets((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((item) => item.url !== url),
    }));

    if (kind === "image") {
      setImageUrls((prev) => removeUrlLine(prev, url));
    } else if (kind === "video") {
      setVideoUrls((prev) => removeUrlLine(prev, url));
    } else {
      setAudioUrls((prev) => removeUrlLine(prev, url));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      toast.error("服务端还没有配置 ARK_API_KEY");
      return;
    }
    if (!prompt.trim()) {
      toast.error("请先填写提示词");
      return;
    }
    if (!Number.isFinite(parsedDuration) || parsedDuration < 5 || parsedDuration > 15) {
      toast.error("当前模型建议填写 5 到 15 秒");
      return;
    }

    const payload = {
      model: DEFAULT_MODEL,
      ratio,
      duration: parsedDuration,
      generate_audio: generateAudio,
      watermark,
      content: buildContent(
        prompt,
        splitMultilineUrls(imageUrls),
        splitMultilineUrls(videoUrls),
        splitMultilineUrls(audioUrls)
      ),
    };

    setSubmitting(true);
    try {
      const nextTask = await parseResponse(
        await fetch("/api/seedance/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      setTask(nextTask);
      setTaskIdInput(nextTask.taskId);
      notifiedRef.current = null;
      void loadHistory();
      toast.success(nextTask.taskId ? `任务已创建：${nextTask.taskId}` : "任务已提交");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setPrompt("");
    setImageUrls("");
    setVideoUrls("");
    setAudioUrls("");
    setUploadedAssets({ image: [], video: [], audio: [] });
    setTask(null);
    setTaskIdInput("");
    setRatio("16:9");
    setDuration("5");
    setGenerateAudio(true);
    setWatermark(false);
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  useEffect(() => {
    if (!shouldAutoPoll || !task?.taskId) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const nextTask = await parseResponse(
          await fetch(`/api/seedance/tasks/${encodeURIComponent(task.taskId)}`, {
            method: "GET",
            cache: "no-store",
          })
        );
        if (!cancelled) {
          setTask(nextTask);
          setTaskIdInput(nextTask.taskId);
          if (isTerminal(nextTask.status)) {
            void loadHistory();
          }
        }
      } catch {
        // 轮询失败时静默，保留手动刷新入口。
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shouldAutoPoll, task?.taskId]);

  useEffect(() => {
    if (!task || !isTerminal(task.status)) return;

    const key = `${task.taskId}:${task.status}`;
    if (notifiedRef.current === key) return;
    notifiedRef.current = key;

    if (task.status === "succeeded") {
      toast.success(task.videoUrls.length > 0 ? "视频已生成完成" : "任务完成，但暂未解析到视频地址");
    } else if (task.status === "failed") {
      toast.error(task.message || "视频生成失败");
    }
  }, [task]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_340px] xl:grid-cols-[minmax(0,1.2fr)_360px]">
      <div className="space-y-6">
        <Card className="overflow-hidden border-primary/10 bg-gradient-to-b from-white via-white to-violet-50/40 shadow-sm dark:from-card dark:via-card dark:to-card">
          <CardContent className="p-6 sm:p-7">
            <form className="space-y-6" onSubmit={handleSubmit}>
              {!configured ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                  当前服务端未配置 `ARK_API_KEY`，界面已就绪，但暂时不能实际提交任务。
                </div>
              ) : null}

              <input
                ref={imageInputRef}
                type="file"
                accept={ACCEPT_BY_KIND.image}
                multiple
                className="hidden"
                onChange={(event) => void uploadLocalFiles("image", event.target.files)}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept={ACCEPT_BY_KIND.video}
                multiple
                className="hidden"
                onChange={(event) => void uploadLocalFiles("video", event.target.files)}
              />
              <input
                ref={audioInputRef}
                type="file"
                accept={ACCEPT_BY_KIND.audio}
                multiple
                className="hidden"
                onChange={(event) => void uploadLocalFiles("audio", event.target.files)}
              />

              <div className="grid gap-3 sm:grid-cols-3">
                <UploadEntry
                  kind="image"
                  count={splitMultilineUrls(imageUrls).length}
                  busy={uploading.image}
                  onPick={() => imageInputRef.current?.click()}
                />
                <UploadEntry
                  kind="video"
                  count={splitMultilineUrls(videoUrls).length}
                  busy={uploading.video}
                  onPick={() => videoInputRef.current?.click()}
                />
                <UploadEntry
                  kind="audio"
                  count={splitMultilineUrls(audioUrls).length}
                  busy={uploading.audio}
                  onPick={() => audioInputRef.current?.click()}
                />
              </div>

              <div className="rounded-[28px] border border-border/70 bg-card/80 p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <Label htmlFor="seedance-prompt" className="text-sm font-medium">
                    创意提示词
                  </Label>
                </div>
                <Textarea
                  id="seedance-prompt"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  className="min-h-44 border-0 bg-transparent px-0 py-0 text-base shadow-none focus-visible:ring-0"
                  placeholder="一句话描述你想生成的画面、节奏和镜头语言。"
                />

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <div className="rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground">
                    参考生成
                  </div>
                  {RATIO_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRatio(option)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        ratio === option
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border bg-background/90 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      比例 {option}
                    </button>
                  ))}
                  {DURATION_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setDuration(String(option))}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        duration === String(option)
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border bg-background/90 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option} 秒
                    </button>
                  ))}
                  <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={generateAudio} onCheckedChange={(value) => setGenerateAudio(Boolean(value))} />
                    输出声音
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={watermark} onCheckedChange={(value) => setWatermark(Boolean(value))} />
                    保留水印
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  当前模型：`{DEFAULT_MODEL}`，已加载参考素材 {referenceCount} 个
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="outline" onClick={resetForm}>
                    清空画布
                  </Button>
                  <Button type="submit" size="lg" disabled={submitting || !configured}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {submitting ? "生成中..." : "开始生成视频"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">参考素材</CardTitle>
                <CardDescription className="mt-1">
                  主界面只保留素材工作区。需要时再展开手动编辑 URL。
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowManualUrls((value) => !value)}
              >
                {showManualUrls ? "收起 URL 编辑" : "手动编辑 URL"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  参考图片
                </div>
                <UploadedAssetGallery
                  kind="image"
                  assets={uploadedAssets.image}
                  onRemove={(url) => removeUploadedAsset("image", url)}
                />
                {uploadedAssets.image.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    还没有本地图片素材，可直接点击上方“添加参考图片”。
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Video className="h-4 w-4 text-primary" />
                  参考视频
                </div>
                <UploadedAssetGallery
                  kind="video"
                  assets={uploadedAssets.video}
                  onRemove={(url) => removeUploadedAsset("video", url)}
                />
                {uploadedAssets.video.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    还没有本地视频素材，可直接点击上方“添加参考视频”。
                  </div>
                ) : null}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Volume2 className="h-4 w-4 text-primary" />
                  参考音频
                </div>
                <UploadedAssetGallery
                  kind="audio"
                  assets={uploadedAssets.audio}
                  onRemove={(url) => removeUploadedAsset("audio", url)}
                />
                {uploadedAssets.audio.length === 0 ? (
                  <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                    还没有本地音频素材，可直接点击上方“添加参考音频”。
                  </div>
                ) : null}
              </div>
            </div>

            {showManualUrls ? (
              <div className="grid gap-4 border-t pt-4 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="seedance-images-manual">图片 URL</Label>
                  <Textarea
                    id="seedance-images-manual"
                    value={imageUrls}
                    onChange={(event) => setImageUrls(event.target.value)}
                    className="min-h-28 rounded-2xl"
                    placeholder="每行一个图片 URL"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seedance-videos-manual">视频 URL</Label>
                  <Textarea
                    id="seedance-videos-manual"
                    value={videoUrls}
                    onChange={(event) => setVideoUrls(event.target.value)}
                    className="min-h-28 rounded-2xl"
                    placeholder="每行一个视频 URL"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="seedance-audios-manual">音频 URL</Label>
                  <Textarea
                    id="seedance-audios-manual"
                    value={audioUrls}
                    onChange={(event) => setAudioUrls(event.target.value)}
                    className="min-h-28 rounded-2xl"
                    placeholder="每行一个音频 URL"
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardTitle>生成状态</CardTitle>
            <CardDescription>像参考界面一样，把结果查看和操作都放在右侧固定工作区。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={taskIdInput}
                onChange={(event) => setTaskIdInput(event.target.value)}
                placeholder="输入任务 ID"
                className="rounded-xl"
              />
              <Button type="button" variant="outline" onClick={() => void refreshTask()} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </div>

            {task ? (
              <div className="space-y-4 rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">任务 ID</p>
                    <p className="break-all font-mono text-xs">{task.taskId || "—"}</p>
                  </div>
                  {task.taskId ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(task.taskId);
                          toast.success("任务 ID 已复制");
                        } catch {
                          toast.error("复制失败");
                        }
                      }}
                      title="复制任务 ID"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">状态</p>
                    <p className="font-medium">{statusLabel(task.status)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">模型</p>
                    <p className="font-medium break-all">{task.model || DEFAULT_MODEL}</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">创建时间</p>
                    <p className="font-medium">{formatDateTime(task.createdAt)}</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">更新时间</p>
                    <p className="font-medium">{formatDateTime(task.updatedAt)}</p>
                  </div>
                </div>

                {task.message ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    {task.message}
                  </div>
                ) : null}

                {task.videoUrls.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">生成结果</p>
                    <video
                      className="aspect-video w-full rounded-2xl border bg-black"
                      src={task.videoUrls[0]}
                      controls
                      playsInline
                    />
                    <div className="space-y-2">
                      {task.videoUrls.map((url) => (
                        <div
                          key={url}
                          className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm"
                        >
                          <span className="line-clamp-2 break-all">{url}</span>
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
                          >
                            打开
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : shouldAutoPoll ? (
                  <div className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在轮询任务状态，生成完成后会自动显示视频地址。
                  </div>
                ) : null}

                <div className="space-y-2">
                  <p className="text-sm font-medium">原始返回</p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-muted/60 p-3 text-xs leading-relaxed">
                    {JSON.stringify(task.raw, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                先在左侧写好创意并提交一次，这里会显示任务状态和视频结果。
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>最近生成</CardTitle>
                <CardDescription>显示火山方舟里最近生成过的视频历史。</CardDescription>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadHistory()} disabled={historyLoading}>
                {historyLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                刷新
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {historyItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                暂时还没有可展示的历史视频。
              </div>
            ) : (
              historyItems.map((item) => (
                <div key={item.taskId} className="space-y-3 rounded-2xl border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.taskId}</p>
                      <p className="text-xs text-muted-foreground">
                        {statusLabel(item.status)} · {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTask(item);
                        setTaskIdInput(item.taskId);
                      }}
                    >
                      查看
                    </Button>
                  </div>

                  {item.videoUrls[0] ? (
                    <video
                      className="aspect-video w-full rounded-xl border bg-black"
                      src={item.videoUrls[0]}
                      controls
                      playsInline
                    />
                  ) : null}

                  {item.videoUrls[0] ? (
                    <a
                      href={item.videoUrls[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      打开视频
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <p className="text-xs text-muted-foreground">这个历史任务暂未解析到视频地址。</p>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardTitle>创作建议</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>优先把“镜头语言、主体、动作、氛围”写进主输入区，参考素材只负责约束风格和主体一致性。</p>
            <p>图片适合锁定主体外观，视频适合借动作节奏，音频适合给背景音乐和口播方向。</p>
            <p>当前界面聚焦空白创作流程，不再预置任何模板信息或示例素材。</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
