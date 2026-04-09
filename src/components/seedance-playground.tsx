"use client";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
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
import {
  canUseSeedanceWebSearch,
  DEFAULT_SEEDANCE_MODEL,
  nextPollDelayMs,
  SEEDANCE_REFERENCE_LIMITS,
  SEEDANCE_MODEL_IDS,
  SEEDANCE_POLL_429_BACKOFF_MAX_MS,
  SEEDANCE_POLL_INTERVAL_MS,
  SEEDANCE_POLL_JITTER_MS,
  SEEDANCE_20_DURATION,
  SEEDANCE_RATIO_OPTIONS,
  SEEDANCE_RESOLUTION_OPTIONS,
  isValidSeedance20DurationValue,
  validateSeedanceReferenceCounts,
  type SeedanceModelId,
  type SeedanceRatio,
  type SeedanceResolution,
} from "@/lib/seedance-params";
import {
  EMPTY_PROMPT_DRAFT,
  normalizeSeedanceReferenceMentions,
  type PromptBuilderMode,
  type PromptDraft,
  type ReferenceAssetCounts,
} from "@/lib/seedance-prompt-builder";
import {
  estimateSeedance20CostFromOutputOnly,
  estimateSeedance20TaskCostFromUsage,
  getSeedanceUnitPriceYuanPerMillionTokens,
} from "@/lib/seedance-pricing";
import { uploadToSignedUrl } from "@/lib/supabase/upload-to-signed-url";
import { SeedancePromptDialog } from "@/components/seedance-prompt-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { SEEDANCE_PROFILE_MISSING_MESSAGE } from "@/lib/seedance-auth-messages";

type LocalAssetKind = "image" | "video" | "audio";
type ImageInputMode = "multimodal" | "first_frame" | "first_last_frame";
type AssetUploadStatus = "uploading" | "uploaded" | "failed";
type AssetCardItem = {
  id: string;
  kind: LocalAssetKind;
  filename: string;
  url: string;
  status: AssetUploadStatus;
  errorMessage?: string;
};
type PromptSelectionRange = {
  start: number;
  end: number;
};
type PromptReferenceOption = {
  id: string;
  kind: LocalAssetKind;
  label: string;
  filename: string;
  snippet: string;
  searchText: string;
  url: string;
};
type PromptReferenceMention = {
  start: number;
  end: number;
  query: string;
};
type SignedUploadItem = {
  url: string;
  signedUrl: string;
  filename: string;
  storagePath?: string;
};

type ApiResult = {
  task?: SeedanceTaskSummary;
  error?: string;
  details?: unknown;
  prompt?: string | null;
};

type HistoryResult = SeedanceTaskListResult & {
  error?: string;
  prompts?: Record<string, string>;
};

const MAX_IMAGE_TOTAL_PIXELS = 36_000_000;
const LOCAL_PROMPT_STORAGE_KEY = "seedance_prompt_history";

const SEEDANCE_MODEL_OPTIONS: { id: SeedanceModelId; label: string }[] = [
  { id: SEEDANCE_MODEL_IDS.standard, label: "Seedance 2.0" },
  { id: SEEDANCE_MODEL_IDS.fast, label: "Seedance 2.0 Fast" },
];

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
const UPLOAD_CONCURRENCY = 3;

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

function referenceLabel(kind: LocalAssetKind, index: number) {
  if (kind === "image") return `图片${index + 1}`;
  if (kind === "video") return `视频${index + 1}`;
  return `音频${index + 1}`;
}

function referencePromptSnippet(kind: LocalAssetKind, index: number) {
  if (kind === "image") return `主体外观参考${referenceLabel(kind, index)}`;
  if (kind === "video") return `动作参考${referenceLabel(kind, index)}`;
  return `节奏参考${referenceLabel(kind, index)}`;
}

function buildPromptReferenceOptions(assetCards: Record<LocalAssetKind, AssetCardItem[]>) {
  const options: PromptReferenceOption[] = [];

  for (const kind of ["image", "video", "audio"] as const) {
    let uploadedIndex = 0;
    for (const item of assetCards[kind]) {
      if (item.status !== "uploaded" || !item.url) continue;
      const label = referenceLabel(kind, uploadedIndex);
      const snippet = referencePromptSnippet(kind, uploadedIndex);
      options.push({
        id: item.id,
        kind,
        label,
        filename: item.filename,
        snippet,
        url: item.url,
        searchText: `${label} ${kindLabel(kind)} ${item.filename} ${snippet}`.toLowerCase(),
      });
      uploadedIndex += 1;
    }
  }

  return options;
}

function getPromptReferenceMention(value: string, cursor: number): PromptReferenceMention | null {
  const prefix = value.slice(0, cursor);
  const atIndex = prefix.lastIndexOf("@");
  if (atIndex < 0) return null;

  const previousChar = atIndex > 0 ? prefix[atIndex - 1] : "";
  if (previousChar && !/[\s([{'"“‘，。；、：:]/.test(previousChar)) {
    return null;
  }

  const query = prefix.slice(atIndex + 1);
  if (!query || /[\s\r\n]/.test(query)) {
    return query === "" ? { start: atIndex, end: cursor, query } : null;
  }

  return { start: atIndex, end: cursor, query };
}


function imageModeLabel(mode: ImageInputMode) {
  if (mode === "first_frame") return "首帧图生视频";
  if (mode === "first_last_frame") return "首尾帧生视频";
  return "多模态参考";
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await worker(items[current], current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );

  return results;
}

function buildContent(
  prompt: string,
  imageMode: ImageInputMode,
  imageUrls: string[],
  videoUrls: string[],
  audioUrls: string[]
): SeedanceContentItem[] {
  const trimmedPrompt = normalizeSeedanceReferenceMentions(prompt).trim();
  const imageItems: SeedanceContentItem[] =
    imageMode === "first_frame"
      ? imageUrls.slice(0, 1).map((url) => ({
          type: "image_url" as const,
          role: "first_frame" as const,
          image_url: { url },
        }))
      : imageMode === "first_last_frame"
        ? imageUrls.slice(0, 2).map((url, index) => ({
            type: "image_url" as const,
            role: index === 0 ? ("first_frame" as const) : ("last_frame" as const),
            image_url: { url },
          }))
        : imageUrls.map((url) => ({
            type: "image_url" as const,
            role: "reference_image" as const,
            image_url: { url },
          }));
  return [
    ...(trimmedPrompt ? [{ type: "text" as const, text: trimmedPrompt }] : []),
    ...imageItems,
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

function uploadStatusLabel(status: AssetUploadStatus) {
  if (status === "uploading") return "上传中";
  if (status === "uploaded") return "已完成";
  return "失败";
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function referenceLimit(kind: LocalAssetKind) {
  if (kind === "image") return SEEDANCE_REFERENCE_LIMITS.images;
  if (kind === "video") return SEEDANCE_REFERENCE_LIMITS.videos;
  return SEEDANCE_REFERENCE_LIMITS.audios;
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
      className="group w-full rounded-2xl border border-border/70 bg-card/90 p-5 text-left transition hover:border-primary/30 hover:bg-muted/40"
    >
      <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/8 text-primary">
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </div>
      <p className="text-base font-semibold tracking-tight">添加参考{kindLabel(kind)}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {count > 0 ? `已添加 ${count} 个${kindLabel(kind)}` : `上传本地${kindLabel(kind)}或回填公网 URL`}
      </p>
    </button>
  );
}

function UploadedAssetGallery({
  kind,
  items,
  onRemove,
  onInsertReference,
}: {
  kind: LocalAssetKind;
  items: AssetCardItem[];
  onRemove: (id: string) => void;
  onInsertReference: (snippet: string) => void;
}) {
  if (items.length === 0) return null;

  const uploadedNumberMap = new Map<string, number>();
  let uploadedCount = 0;
  for (const item of items) {
    if (item.status === "uploaded" && item.url) {
      uploadedNumberMap.set(item.id, uploadedCount);
      uploadedCount += 1;
    }
  }

  if (kind === "image") {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((asset) => {
          const uploadedIndex = uploadedNumberMap.get(asset.id);
          return (
          <div key={asset.id} className="group overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="relative aspect-square bg-muted/30">
              {asset.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={asset.url} alt={asset.filename} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  {asset.status === "uploading" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <ImageIcon className="h-5 w-5" />
                  )}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2.5 text-white">
                <p className="text-xs font-semibold text-white/90">
                  {uploadedIndex !== undefined ? referenceLabel(kind, uploadedIndex) : `图片素材`}
                </p>
                <p className="truncate text-sm font-medium">{asset.filename}</p>
                <p className="mt-0.5 text-xs text-white/85">{uploadStatusLabel(asset.status)}</p>
                {asset.errorMessage ? (
                  <p className="mt-1 line-clamp-2 text-xs text-rose-200">{asset.errorMessage}</p>
                ) : null}
              </div>
              <div className="absolute right-2 top-2 flex gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                {asset.url ? (
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                    title="打开原图"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemove(asset.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white"
                  title="移除"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {uploadedIndex !== undefined
                  ? referencePromptSnippet(kind, uploadedIndex)
                  : asset.status === "uploading"
                    ? "上传中…"
                    : "上传失败"}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 px-3 text-sm"
                onClick={() =>
                  uploadedIndex !== undefined && onInsertReference(`@${referenceLabel(kind, uploadedIndex)}`)
                }
                disabled={uploadedIndex === undefined}
              >
                引用
              </Button>
            </div>
          </div>
        )})}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((asset) => {
        const Icon = kind === "video" ? Play : Music4;
        const uploadedIndex = uploadedNumberMap.get(asset.id);
        return (
          <div
            key={asset.id}
            className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-4 shadow-sm"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/8 text-primary">
                {asset.status === "uploading" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {uploadedIndex !== undefined ? referenceLabel(kind, uploadedIndex) : `${kindLabel(kind)}素材`}
                </p>
                <p className="truncate text-base font-medium">{asset.filename}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {uploadStatusLabel(asset.status)}
                  {asset.url ? ` · ${asset.url}` : ""}
                </p>
                {asset.errorMessage ? (
                  <p className="truncate text-sm text-rose-600 dark:text-rose-400">{asset.errorMessage}</p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="default"
                className="px-3 text-sm"
                onClick={() =>
                  uploadedIndex !== undefined && onInsertReference(`@${referenceLabel(kind, uploadedIndex)}`)
                }
                disabled={uploadedIndex === undefined}
              >
                引用
              </Button>
              {asset.url ? (
                <a
                  href={asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  title="打开文件"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => onRemove(asset.id)}
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
  authenticated,
  profileMissing = false,
}: {
  configured: boolean;
  authenticated: boolean;
  profileMissing?: boolean;
}) {
  const [promptDialogOpen, setPromptDialogOpen] = useState(false);
  const [promptBuilderMode, setPromptBuilderMode] = useState<PromptBuilderMode>("optimizer");
  const [promptDraft, setPromptDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [promptPreview, setPromptPreview] = useState("");
  const [prompt, setPrompt] = useState("");
  const [imageMode, setImageMode] = useState<ImageInputMode>("multimodal");
  const [imageUrls, setImageUrls] = useState("");
  const [videoUrls, setVideoUrls] = useState("");
  const [audioUrls, setAudioUrls] = useState("");
  const [modelId, setModelId] = useState<SeedanceModelId>(DEFAULT_SEEDANCE_MODEL);
  const [resolution, setResolution] = useState<SeedanceResolution>("720p");
  const [ratio, setRatio] = useState<SeedanceRatio>("16:9");
  const [duration, setDuration] = useState("5");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [returnLastFrame, setReturnLastFrame] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [task, setTask] = useState<SeedanceTaskSummary | null>(null);
  const [taskIdInput, setTaskIdInput] = useState("");
  const [submittedParams, setSubmittedParams] = useState<{
    resolution: string;
    ratio: string;
    duration: string;
    modelId: string;
  } | null>(null);
  const [historyItems, setHistoryItems] = useState<SeedanceTaskSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [promptHistory, setPromptHistory] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_PROMPT_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showManualUrls, setShowManualUrls] = useState(false);
  const [uploading, setUploading] = useState<Record<LocalAssetKind, boolean>>({
    image: false,
    video: false,
    audio: false,
  });
  const [assetCards, setAssetCards] = useState<Record<LocalAssetKind, AssetCardItem[]>>({
    image: [],
    video: [],
    audio: [],
  });
  const [historyPromptExpanded, setHistoryPromptExpanded] = useState<Record<string, boolean>>({});
  const [promptSelection, setPromptSelection] = useState<PromptSelectionRange>({
    start: 0,
    end: 0,
  });
  const [promptInputFocused, setPromptInputFocused] = useState(false);
  const [promptReferenceActiveIndex, setPromptReferenceActiveIndex] = useState(0);
  const [promptScrollTop, setPromptScrollTop] = useState(0);
  const notifiedRef = useRef<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const promptSelectionRef = useRef<PromptSelectionRange>({ start: 0, end: 0 });

  const parsedDuration = useMemo(() => Number(duration), [duration]);
  const shouldAutoPoll = Boolean(task?.taskId && !isTerminal(task.status));
  const referenceAssetCounts: ReferenceAssetCounts = useMemo(
    () => ({
      images: splitMultilineUrls(imageUrls).length,
      videos: splitMultilineUrls(videoUrls).length,
      audios: splitMultilineUrls(audioUrls).length,
    }),
    [imageUrls, videoUrls, audioUrls]
  );
  const promptReferenceOptions = useMemo(
    () => buildPromptReferenceOptions(assetCards),
    [assetCards]
  );
  const promptReferenceMention = useMemo(() => {
    if (!promptInputFocused) return null;
    if (promptSelection.start !== promptSelection.end) return null;
    return getPromptReferenceMention(prompt, promptSelection.start);
  }, [prompt, promptInputFocused, promptSelection]);
  const filteredPromptReferenceOptions = useMemo(() => {
    if (!promptReferenceMention) return [];
    const query = promptReferenceMention.query.trim().toLowerCase();
    if (!query) return promptReferenceOptions;
    return promptReferenceOptions.filter((option) => option.searchText.includes(query));
  }, [promptReferenceMention, promptReferenceOptions]);
  const showPromptReferenceMenu = Boolean(promptInputFocused && promptReferenceMention);
  const referenceCount =
    referenceAssetCounts.images + referenceAssetCounts.videos + referenceAssetCounts.audios;
  const webSearchAvailable = canUseSeedanceWebSearch(referenceAssetCounts);
  const hasVideoReferenceInput = referenceAssetCounts.videos > 0;
  const currentUnitPrice = useMemo(
    () => getSeedanceUnitPriceYuanPerMillionTokens(modelId, hasVideoReferenceInput),
    [hasVideoReferenceInput, modelId]
  );
  const currentPricingEstimate = useMemo(() => {
    if (currentUnitPrice == null) return null;
    if (hasVideoReferenceInput) {
      return {
        unitPriceYuanPerMillionTokens: currentUnitPrice,
        estimatedTokens: null,
        estimatedCostYuan: null,
        note: "当前输入包含参考视频，单价已切换到“含视频输入”档位；最终费用还取决于输入视频总时长与任务 usage。",
      };
    }
    if (ratio === "adaptive") {
      return {
        unitPriceYuanPerMillionTokens: currentUnitPrice,
        estimatedTokens: null,
        estimatedCostYuan: null,
        note: "自适应比例下无法提前精确推算像素尺寸，建议以任务完成后的 usage 为准。",
      };
    }
    if (parsedDuration === SEEDANCE_20_DURATION.auto) {
      return {
        unitPriceYuanPerMillionTokens: currentUnitPrice,
        estimatedTokens: null,
        estimatedCostYuan: null,
        note: "智能时长模式由模型自主决定输出秒数，提交前无法精确预估成本。",
      };
    }
    if (!Number.isFinite(parsedDuration) || parsedDuration <= 0) {
      return {
        unitPriceYuanPerMillionTokens: currentUnitPrice,
        estimatedTokens: null,
        estimatedCostYuan: null,
        note: "请先填写合法时长后再查看价格预估。",
      };
    }
    const estimated = estimateSeedance20CostFromOutputOnly({
      model: modelId,
      resolution,
      ratio,
      durationSeconds: parsedDuration,
    });
    if (!estimated) return null;
    return {
      ...estimated,
      note: "该预估按“输入不含视频”的官方 token 公式计算，仅作提交前参考。",
    };
  }, [currentUnitPrice, hasVideoReferenceInput, modelId, parsedDuration, ratio, resolution]);
  const selectedTaskPricing = useMemo(() => {
    if (!task?.model) return null;
    return estimateSeedance20TaskCostFromUsage(task.model, task.raw);
  }, [task]);

  async function parseTaskResponse(response: Response) {
    const data = (await response.json().catch(() => ({}))) as ApiResult;
    if (!response.ok) {
      throw new Error(data.error || "请求失败");
    }
    if (!data.task) {
      throw new Error("服务端未返回任务信息");
    }
    return { task: data.task, prompt: data.prompt ?? null };
  }

  function persistPromptHistory(next: Record<string, string>) {
    try {
      localStorage.setItem(LOCAL_PROMPT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function mergePromptIntoState(taskId: string | undefined, prompt: string | null | undefined) {
    if (!taskId || prompt == null) return;
    setPromptHistory((prev) => {
      const next = { ...prev, [taskId]: prompt };
      persistPromptHistory(next);
      return next;
    });
  }

  async function refreshTask(targetTaskId?: string) {
    const nextTaskId = (targetTaskId ?? taskIdInput ?? task?.taskId ?? "").trim();
    if (!nextTaskId) {
      toast.error("请先输入任务 ID");
      return;
    }
    if (profileMissing) {
      toast.error(SEEDANCE_PROFILE_MISSING_MESSAGE);
      return;
    }
    if (!authenticated) {
      toast.info("请先登录后再查询任务详情");
      return;
    }

    setRefreshing(true);
    try {
      const { task: nextTask, prompt } = await parseTaskResponse(
        await fetch(`/api/seedance/tasks/${encodeURIComponent(nextTaskId)}`, {
          method: "GET",
          cache: "no-store",
        })
      );
      mergePromptIntoState(nextTask.taskId || nextTaskId, prompt);
      setTask(nextTask);
      setTaskIdInput(nextTask.taskId || nextTaskId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询任务失败");
    } finally {
      setRefreshing(false);
    }
  }

  async function deleteTask(targetTaskId?: string) {
    const nextTaskId = (targetTaskId ?? task?.taskId ?? taskIdInput).trim();
    if (!nextTaskId) {
      toast.error("请先选择一个任务");
      return;
    }
    if (profileMissing) {
      toast.error(SEEDANCE_PROFILE_MISSING_MESSAGE);
      return;
    }
    if (!authenticated) {
      toast.info("请先登录后再取消或删除任务");
      return;
    }

    try {
      const response = await fetch(`/api/seedance/tasks/${encodeURIComponent(nextTaskId)}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "删除任务失败");
      }
      if (task?.taskId === nextTaskId) {
        setTask(null);
      }
      if (taskIdInput === nextTaskId) {
        setTaskIdInput("");
      }
      void loadHistory();
      toast.success("任务已取消或删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除任务失败");
    }
  }

  async function loadHistory(options?: { silent?: boolean }) {
    if (profileMissing) {
      if (!options?.silent) {
        toast.error(SEEDANCE_PROFILE_MISSING_MESSAGE);
      }
      return;
    }
    if (!authenticated) {
      if (!options?.silent) {
        toast.info("请先登录后再查看全站历史与提示词快照");
      }
      return;
    }

    setHistoryLoading(true);
    try {
      const response = await fetch("/api/seedance/tasks?pageNum=1&pageSize=12", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as HistoryResult & {
        code?: string;
      };
      if (response.status === 403 && payload.code === "profile_missing") {
        toast.error(payload.error || SEEDANCE_PROFILE_MISSING_MESSAGE);
        return;
      }
      if (response.status === 401) {
        toast.info("登录已过期，请重新登录后再刷新");
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error || "查询历史任务失败");
      }
      setHistoryItems(payload.items ?? []);
      const serverPrompts = payload.prompts ?? {};
      if (Object.keys(serverPrompts).length > 0) {
        setPromptHistory((prev) => {
          const next = { ...prev, ...serverPrompts };
          persistPromptHistory(next);
          return next;
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "查询历史任务失败");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function uploadLocalFiles(kind: LocalAssetKind, files: FileList | null) {
    if (!files || files.length === 0) return;

    const selectedFiles = Array.from(files);
    const currentCount =
      kind === "image"
        ? splitMultilineUrls(imageUrls).length
        : kind === "video"
          ? splitMultilineUrls(videoUrls).length
          : splitMultilineUrls(audioUrls).length;
    const maxCount = referenceLimit(kind);
    if (currentCount + selectedFiles.length > maxCount) {
      toast.error(`参考${kindLabel(kind)}最多支持 ${maxCount} 个，当前已存在 ${currentCount} 个。`);
      if (kind === "image" && imageInputRef.current) imageInputRef.current.value = "";
      if (kind === "video" && videoInputRef.current) videoInputRef.current.value = "";
      if (kind === "audio" && audioInputRef.current) audioInputRef.current.value = "";
      return;
    }

    setUploading((prev) => ({ ...prev, [kind]: true }));
    try {
      const preparedFiles = await Promise.all(
        selectedFiles.map(async (file) => {
          let uploadFile = file;
          let wasResized = false;

          if (kind === "image") {
            const normalized = await downscaleImageIfNeeded(file);
            uploadFile = normalized.file;
            wasResized = normalized.resized;
          }

          return {
            id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            uploadFile,
            filename: uploadFile.name,
            contentType: uploadFile.type || "application/octet-stream",
            sizeBytes: uploadFile.size,
            wasResized,
          };
        })
      );

      const resizedCount = preparedFiles.filter((item) => item.wasResized).length;
      if (resizedCount > 0) {
        toast.info(`已自动缩放 ${resizedCount} 张超大图片后上传`);
      }

      setAssetCards((prev) => ({
        ...prev,
        [kind]: [
          ...prev[kind],
          ...preparedFiles.map((item) => ({
            id: item.id,
            kind,
            filename: item.filename,
            url: "",
            status: "uploading" as const,
          })),
        ],
      }));

      const initResponse = await fetch("/api/seedance/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          files: preparedFiles.map((item) => ({
            filename: item.filename,
            contentType: item.contentType,
            sizeBytes: item.sizeBytes,
          })),
        }),
      });
      const initPayload = (await initResponse.json().catch(() => ({}))) as {
        error?: string;
        items?: SignedUploadItem[];
      };
      if (!initResponse.ok) {
        throw new Error(initPayload.error || `上传失败 (${initResponse.status})`);
      }

      const signedItems = Array.isArray(initPayload.items) ? initPayload.items : [];
      if (signedItems.length !== preparedFiles.length) {
        throw new Error("服务端返回的上传地址数量不匹配");
      }

      const uploadResults = await runWithConcurrency(
        preparedFiles,
        UPLOAD_CONCURRENCY,
        async (item, index) => {
          const signed = signedItems[index];
          if (!signed?.signedUrl || !signed?.url || !signed?.storagePath) {
            const message = "服务端未返回上传地址";
            setAssetCards((prev) => ({
              ...prev,
              [kind]: prev[kind].map((card) =>
                card.id === item.id ? { ...card, status: "failed", errorMessage: message } : card
              ),
            }));
            return { ok: false as const, errorMessage: message };
          }

          const uploadResponse = await uploadToSignedUrl({
            bucket: "seedance-assets",
            storagePath: signed.storagePath,
            signedUrl: signed.signedUrl,
            fileBody: item.uploadFile,
            contentType: item.contentType,
          });
          if (!uploadResponse.ok) {
            const message = `上传文件失败 (${uploadResponse.status})：${uploadResponse.message}`;
            setAssetCards((prev) => ({
              ...prev,
              [kind]: prev[kind].map((card) =>
                card.id === item.id ? { ...card, status: "failed", errorMessage: message } : card
              ),
            }));
            return { ok: false as const, errorMessage: message };
          }

          setAssetCards((prev) => ({
            ...prev,
            [kind]: prev[kind].map((card) =>
              card.id === item.id
                ? { ...card, status: "uploaded", url: signed.url.trim(), errorMessage: undefined }
                : card
            ),
          }));

          return {
            ok: true as const,
            itemUrl: signed.url.trim(),
          };
        }
      );

      const uploadedItems = uploadResults
        .filter((result): result is { ok: true; itemUrl: string } => result.ok)
        .map((result) => result.itemUrl);

      if (kind === "image") {
        setImageUrls((prev) => uploadedItems.reduce((current, url) => appendUrlLine(current, url), prev));
      } else if (kind === "video") {
        setVideoUrls((prev) => uploadedItems.reduce((current, url) => appendUrlLine(current, url), prev));
      } else {
        setAudioUrls((prev) => uploadedItems.reduce((current, url) => appendUrlLine(current, url), prev));
      }

      const failedCount = uploadResults.filter((result) => !result.ok).length;
      if (uploadedItems.length > 0 && failedCount === 0) {
        toast.success(`本地${kindLabel(kind)}已上传并回填 URL，输入 @ 可插入引用`);
      } else if (uploadedItems.length > 0) {
        toast.warning(`${kindLabel(kind)}上传部分成功：成功 ${uploadedItems.length} 个，失败 ${failedCount} 个`);
      } else {
        toast.error(`本地${kindLabel(kind)}上传失败`);
      }
    } catch (error) {
      if (error instanceof Error) {
        setAssetCards((prev) => ({
          ...prev,
          [kind]: prev[kind].map((card) =>
            card.status === "uploading" ? { ...card, status: "failed", errorMessage: error.message } : card
          ),
        }));
      }
      toast.error(error instanceof Error ? error.message : "上传失败");
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
      if (kind === "image" && imageInputRef.current) imageInputRef.current.value = "";
      if (kind === "video" && videoInputRef.current) videoInputRef.current.value = "";
      if (kind === "audio" && audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  function removeUploadedAsset(kind: LocalAssetKind, id: string) {
    const target = assetCards[kind].find((item) => item.id === id);
    setAssetCards((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((item) => item.id !== id),
    }));

    if (!target?.url) return;

    if (kind === "image") {
      setImageUrls((prev) => removeUrlLine(prev, target.url));
    } else if (kind === "video") {
      setVideoUrls((prev) => removeUrlLine(prev, target.url));
    } else {
      setAudioUrls((prev) => removeUrlLine(prev, target.url));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!configured) {
      toast.error("服务端还没有配置 ARK_API_KEY");
      return;
    }
    if (profileMissing) {
      toast.error(SEEDANCE_PROFILE_MISSING_MESSAGE);
      return;
    }
    if (!authenticated) {
      toast.info("请先登录后再提交生成任务");
      return;
    }
    const referenceError = validateSeedanceReferenceCounts(referenceAssetCounts);
    if (referenceError) {
      toast.error(referenceError);
      return;
    }
    const parsedImageUrls = splitMultilineUrls(imageUrls);
    const parsedVideoUrls = splitMultilineUrls(videoUrls);
    const parsedAudioUrls = splitMultilineUrls(audioUrls);
    if (imageMode === "first_frame") {
      if (parsedImageUrls.length !== 1) {
        toast.error("首帧图生视频需要且仅需要 1 张图片。");
        return;
      }
      if (parsedVideoUrls.length > 0 || parsedAudioUrls.length > 0) {
        toast.error("首帧图生视频不能同时携带参考视频或参考音频。");
        return;
      }
    }
    if (imageMode === "first_last_frame") {
      if (parsedImageUrls.length !== 2) {
        toast.error("首尾帧生视频需要且仅需要 2 张图片。");
        return;
      }
      if (parsedVideoUrls.length > 0 || parsedAudioUrls.length > 0) {
        toast.error("首尾帧生视频不能同时携带参考视频或参考音频。");
        return;
      }
    }
    const content = buildContent(
      prompt,
      imageMode,
      parsedImageUrls,
      parsedVideoUrls,
      parsedAudioUrls
    );
    if (content.length === 0) {
      toast.error("请至少填写提示词，或添加图片/视频/音频参考素材。");
      return;
    }
    if (!isValidSeedance20DurationValue(parsedDuration)) {
      toast.error(
        `时长需为 ${SEEDANCE_20_DURATION.minSeconds}～${SEEDANCE_20_DURATION.maxSeconds} 秒的整数，或 ${SEEDANCE_20_DURATION.auto}（智能时长）。`
      );
      return;
    }
    if (enableWebSearch && !webSearchAvailable) {
      toast.error("联网搜索仅适用于纯文本输入，不能同时携带图片、视频或音频参考。");
      return;
    }

    const payload = {
      model: modelId,
      resolution,
      ratio,
      duration: parsedDuration,
      generate_audio: generateAudio,
      return_last_frame: returnLastFrame,
      watermark,
      content,
      ...(enableWebSearch ? { tools: [{ type: "web_search" as const }] } : {}),
    };

    setSubmitting(true);
    try {
      const { task: nextTask } = await parseTaskResponse(
        await fetch("/api/seedance/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      );
      setTask(nextTask);
      setTaskIdInput(nextTask.taskId);
      setSubmittedParams({ resolution, ratio, duration, modelId });
      notifiedRef.current = null;
      if (nextTask.taskId) {
        setPromptHistory((prev) => {
          const next = { [nextTask.taskId!]: prompt.trim(), ...prev };
          persistPromptHistory(next);
          return next;
        });
      }
      void loadHistory();
      toast.success(nextTask.taskId ? `任务已创建：${nextTask.taskId}` : "任务已提交");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  function applyLastFrameAsFirstFrame(frameUrl: string) {
    const cardId = `image-lastframe-${Date.now()}`;
    const filename = "尾帧首帧.png";
    setImageMode("first_frame");
    setImageUrls(frameUrl);
    setAssetCards((prev) => ({
      ...prev,
      image: [{ id: cardId, kind: "image", filename, url: frameUrl, status: "uploaded" }],
    }));
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast.success("已将尾帧设为首帧，在上方填写提示词后生成");
  }

  function resetForm() {
    setPrompt("");
    setImageMode("multimodal");
    setImageUrls("");
    setVideoUrls("");
    setAudioUrls("");
    setAssetCards({ image: [], video: [], audio: [] });
    setTask(null);
    setTaskIdInput("");
    setModelId(DEFAULT_SEEDANCE_MODEL);
    setResolution("720p");
    setRatio("16:9");
    setDuration("5");
    setGenerateAudio(true);
    setReturnLastFrame(false);
    setWatermark(false);
    setEnableWebSearch(false);
  }

  function syncPromptSelection(target: HTMLTextAreaElement | null) {
    if (!target) return;
    const nextSelection = {
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0,
    };
    promptSelectionRef.current = nextSelection;
    setPromptSelection(nextSelection);
    setPromptScrollTop(target.scrollTop);
  }

  function focusPromptSelection(start: number, end = start) {
    window.requestAnimationFrame(() => {
      const target = promptTextareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(start, end);
      syncPromptSelection(target);
    });
  }

  function replacePromptRange(start: number, end: number, text: string) {
    setPrompt((previous) => `${previous.slice(0, start)}${text}${previous.slice(end)}`);
    const nextSelection = {
      start: start + text.length,
      end: start + text.length,
    };
    promptSelectionRef.current = nextSelection;
    setPromptSelection(nextSelection);
    setPromptReferenceActiveIndex(0);
    focusPromptSelection(nextSelection.start);
  }

  function applyPromptFromDialog(mode: "replace" | "append", text: string) {
    const next = text.trim();
    if (!next) {
      toast.error("请先在助手里生成或编辑提示词");
      return;
    }

    setPrompt((previous) => {
      const current = previous.trim();
      if (mode === "append" && current) {
        return `${current}\n\n${next}`;
      }
      return next;
    });
    setPromptDialogOpen(false);
    toast.success(mode === "append" ? "提示词已追加到主输入框" : "提示词已回填到主输入框");
  }

  function insertReferenceSnippet(snippet: string) {
    const currentSelection = promptTextareaRef.current
      ? {
          start: promptTextareaRef.current.selectionStart ?? 0,
          end: promptTextareaRef.current.selectionEnd ?? 0,
        }
      : promptSelectionRef.current;
    const mention =
      currentSelection.start === currentSelection.end
        ? getPromptReferenceMention(prompt, currentSelection.start)
        : null;

    if (mention) {
      replacePromptRange(mention.start, currentSelection.end, snippet);
    } else {
      replacePromptRange(currentSelection.start, currentSelection.end, snippet);
    }
    toast.success(`已插入提示词引用：${snippet}`);
  }

  function insertReferenceMention(option: PromptReferenceOption) {
    const currentSelection = promptTextareaRef.current
      ? {
          start: promptTextareaRef.current.selectionStart ?? 0,
          end: promptTextareaRef.current.selectionEnd ?? 0,
        }
      : promptSelectionRef.current;
    const mention =
      currentSelection.start === currentSelection.end
        ? getPromptReferenceMention(prompt, currentSelection.start)
        : null;

    const text = `@${option.label}`;
    if (mention) {
      replacePromptRange(mention.start, currentSelection.end, text);
    } else {
      replacePromptRange(currentSelection.start, currentSelection.end, text);
    }
    toast.success(`已插入引用：${text}`);
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!showPromptReferenceMenu) return;

    if (event.key === "ArrowDown") {
      if (filteredPromptReferenceOptions.length === 0) return;
      event.preventDefault();
      setPromptReferenceActiveIndex((previous) =>
        previous + 1 >= filteredPromptReferenceOptions.length ? 0 : previous + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      if (filteredPromptReferenceOptions.length === 0) return;
      event.preventDefault();
      setPromptReferenceActiveIndex((previous) =>
        previous - 1 < 0 ? filteredPromptReferenceOptions.length - 1 : previous - 1
      );
      return;
    }

    if ((event.key === "Enter" || event.key === "Tab") && filteredPromptReferenceOptions.length > 0) {
      event.preventDefault();
      const option = filteredPromptReferenceOptions[promptReferenceActiveIndex];
      if (option) insertReferenceMention(option);
    }

    if (event.key === "Escape") {
      event.preventDefault();
    }
  }

  useEffect(() => {
    void loadHistory({ silent: true });
  }, [authenticated, profileMissing]);

  useEffect(() => {
    setPromptReferenceActiveIndex(0);
  }, [promptReferenceMention?.start, promptReferenceMention?.query]);

  useEffect(() => {
    if (promptReferenceActiveIndex < filteredPromptReferenceOptions.length) return;
    setPromptReferenceActiveIndex(0);
  }, [filteredPromptReferenceOptions.length, promptReferenceActiveIndex]);

  useEffect(() => {
    if (!webSearchAvailable && enableWebSearch) {
      setEnableWebSearch(false);
    }
  }, [enableWebSearch, webSearchAvailable]);

  useEffect(() => {
    const taskId = task?.taskId;
    if (!shouldAutoPoll || !taskId) return;

    let cancelled = false;
    let timeoutId: number | undefined;
    let pollBackoffMs = 0;

    const schedule = (delayMs: number) => {
      timeoutId = window.setTimeout(() => {
        void pollOnce();
      }, delayMs);
    };

    const pollOnce = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`/api/seedance/tasks/${encodeURIComponent(taskId)}`, {
          method: "GET",
          cache: "no-store",
        });

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After");
          const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
          const suggested =
            Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : SEEDANCE_POLL_INTERVAL_MS * 2;
          pollBackoffMs = Math.min(
            Math.max(pollBackoffMs || suggested, suggested),
            SEEDANCE_POLL_429_BACKOFF_MAX_MS
          );
          schedule(pollBackoffMs + Math.floor(Math.random() * SEEDANCE_POLL_JITTER_MS));
          return;
        }

        if (response.status === 401 || response.status === 403) {
          return;
        }

        pollBackoffMs = 0;
        const { task: nextTask, prompt } = await parseTaskResponse(response);
        if (cancelled) return;
        mergePromptIntoState(nextTask.taskId, prompt);
        setTask(nextTask);
        setTaskIdInput(nextTask.taskId);
        if (isTerminal(nextTask.status)) {
          void loadHistory();
          return;
        }
        schedule(nextPollDelayMs(SEEDANCE_POLL_INTERVAL_MS, SEEDANCE_POLL_JITTER_MS));
      } catch {
        if (cancelled) return;
        schedule(nextPollDelayMs(SEEDANCE_POLL_INTERVAL_MS, SEEDANCE_POLL_JITTER_MS));
      }
    };

    schedule(nextPollDelayMs(SEEDANCE_POLL_INTERVAL_MS, SEEDANCE_POLL_JITTER_MS));

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
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
    <div className="flex w-full flex-col gap-10 text-[17px] leading-relaxed [text-rendering:optimizeLegibility]">
      <Card className="overflow-hidden rounded-2xl border-border/70 shadow-md">
        <form className="flex flex-col" onSubmit={handleSubmit}>
          {!configured ? (
            <div className="border-b border-amber-200/60 bg-amber-50 px-6 py-4 text-base leading-relaxed text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-300 sm:px-8">
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

          <div className="divide-y divide-border">
            <div className="space-y-4 px-6 py-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Label htmlFor="seedance-prompt" className="text-xl font-semibold tracking-tight">
                  创意提示词
                </Label>
                <Button type="button" variant="outline" size="default" onClick={() => setPromptDialogOpen(true)}>
                  <Sparkles className="h-4 w-4" />
                  AI 提示词优化
                </Button>
              </div>
              <div className="relative">
                {/* 高亮叠层：让 @图片1 / @视频1 / @音频1 显示蓝色下划线 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden text-lg"
                >
                  <div
                    className="whitespace-pre-wrap break-words px-0 py-0 text-lg leading-8"
                    style={{ transform: `translateY(${-promptScrollTop}px)` }}
                  >
                    {prompt ? (
                      (() => {
                        const segments: Array<{ text: string; highlight: boolean }> = [];
                        const pattern = /@(图片|视频|音频)\d+/g;
                        let last = 0;
                        for (const m of prompt.matchAll(pattern)) {
                          const idx = m.index ?? 0;
                          if (idx > last) segments.push({ text: prompt.slice(last, idx), highlight: false });
                          segments.push({ text: m[0], highlight: true });
                          last = idx + m[0].length;
                        }
                        if (last < prompt.length) segments.push({ text: prompt.slice(last), highlight: false });
                        return segments.map((seg, i) =>
                          seg.highlight ? (
                            <span
                              key={i}
                              className="font-medium text-sky-600 underline decoration-sky-500 underline-offset-4 dark:text-sky-400"
                            >
                              {seg.text}
                            </span>
                          ) : (
                            <span key={i}>{seg.text}</span>
                          )
                        );
                      })()
                    ) : null}
                  </div>
                </div>
                <textarea
                  ref={promptTextareaRef}
                  id="seedance-prompt"
                  value={prompt}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    syncPromptSelection(event.target);
                  }}
                  onKeyDown={handlePromptKeyDown}
                  onKeyUp={(event) => syncPromptSelection(event.currentTarget)}
                  onClick={(event) => syncPromptSelection(event.currentTarget)}
                  onSelect={(event) => syncPromptSelection(event.currentTarget)}
                  onScroll={(event) => syncPromptSelection(event.currentTarget)}
                  onFocus={(event) => {
                    setPromptInputFocused(true);
                    syncPromptSelection(event.currentTarget);
                  }}
                  onBlur={() => setPromptInputFocused(false)}
                  placeholder="一句话描述你想生成的画面、节奏和镜头语言。"
                  className="relative z-10 min-h-52 max-h-96 w-full resize-none overflow-y-auto bg-transparent px-0 py-0 text-lg leading-8 text-transparent caret-foreground outline-none placeholder:text-muted-foreground/80 selection:bg-primary/20"
                />
                {showPromptReferenceMenu ? (
                  <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border/60 bg-popover shadow-xl">
                    <div className="px-4 pt-3 pb-2">
                      <p className="text-sm font-medium text-muted-foreground">可能 @ 的内容</p>
                    </div>
                    {filteredPromptReferenceOptions.length > 0 ? (
                      <div className="max-h-72 overflow-y-auto pb-1.5">
                        {filteredPromptReferenceOptions.map((option, index) => (
                          <button
                            key={option.id}
                            type="button"
                            onMouseDown={(event) => {
                              event.preventDefault();
                              insertReferenceMention(option);
                            }}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60",
                              index === promptReferenceActiveIndex && "bg-muted/60"
                            )}
                          >
                            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-muted">
                              {option.kind === "image" ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={option.url}
                                  alt={option.label}
                                  className="h-full w-full object-cover"
                                />
                              ) : option.kind === "video" ? (
                                <div className="flex h-full w-full items-center justify-center">
                                  <Video className="h-4 w-4 text-muted-foreground" />
                                </div>
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <Music4 className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                            <span className="text-base font-medium">{option.label}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-4 text-base text-muted-foreground">
                        没有匹配的已上传素材，试试输入 @图片1、@视频1、@音频1 或文件名。
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                输入 @ 可插入素材引用；素材区卡片上的「引用」按钮会插入到当前光标处。历史任务的提示词在下方「最近生成」里与视频一起展示。
              </p>
            </div>

            <div className="space-y-5 px-6 py-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-xl font-semibold tracking-tight">参考素材</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  className="text-base"
                  onClick={() => setShowManualUrls((value) => !value)}
                >
                  {showManualUrls ? "收起 URL" : "手动填 URL"}
                </Button>
              </div>
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <ImageIcon className="h-5 w-5 text-primary" />
                    参考图片
                  </div>
                  <UploadEntry
                    kind="image"
                    count={splitMultilineUrls(imageUrls).length}
                    busy={uploading.image}
                    onPick={() => imageInputRef.current?.click()}
                  />
                  <UploadedAssetGallery
                    kind="image"
                    items={assetCards.image}
                    onRemove={(id) => removeUploadedAsset("image", id)}
                    onInsertReference={insertReferenceSnippet}
                  />
                  {assetCards.image.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                      点击上方添加图片，或展开手动 URL。
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <Video className="h-5 w-5 text-primary" />
                    参考视频
                  </div>
                  <UploadEntry
                    kind="video"
                    count={splitMultilineUrls(videoUrls).length}
                    busy={uploading.video}
                    onPick={() => videoInputRef.current?.click()}
                  />
                  <UploadedAssetGallery
                    kind="video"
                    items={assetCards.video}
                    onRemove={(id) => removeUploadedAsset("video", id)}
                    onInsertReference={insertReferenceSnippet}
                  />
                  {assetCards.video.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                      点击上方添加视频，或展开手动 URL。
                    </div>
                  ) : null}
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    ⚠️ 所有参考视频合计时长须 ≤ 15.2 秒，超出会被 API 拒绝。
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-base font-semibold">
                    <Volume2 className="h-5 w-5 text-primary" />
                    参考音频
                  </div>
                  <UploadEntry
                    kind="audio"
                    count={splitMultilineUrls(audioUrls).length}
                    busy={uploading.audio}
                    onPick={() => audioInputRef.current?.click()}
                  />
                  <UploadedAssetGallery
                    kind="audio"
                    items={assetCards.audio}
                    onRemove={(id) => removeUploadedAsset("audio", id)}
                    onInsertReference={insertReferenceSnippet}
                  />
                  {assetCards.audio.length === 0 ? (
                    <div className="rounded-xl border border-dashed px-4 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                      点击上方添加音频，或展开手动 URL。
                    </div>
                  ) : null}
                </div>
              </div>

              {showManualUrls ? (
                <div className="grid gap-4 border-t border-border pt-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="seedance-images-manual">图片 URL</Label>
                    <Textarea
                      id="seedance-images-manual"
                      value={imageUrls}
                      onChange={(event) => setImageUrls(event.target.value)}
                      className="min-h-28 rounded-xl text-base leading-relaxed"
                      placeholder="每行一个图片 URL，支持 https://、asset://<asset-id> 或 data:image/...;base64,..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seedance-videos-manual">视频 URL</Label>
                    <Textarea
                      id="seedance-videos-manual"
                      value={videoUrls}
                      onChange={(event) => setVideoUrls(event.target.value)}
                      className="min-h-28 rounded-xl text-base leading-relaxed"
                      placeholder="每行一个视频 URL，支持 https://、asset://<asset-id> 或 data:video/...;base64,..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="seedance-audios-manual">音频 URL</Label>
                    <Textarea
                      id="seedance-audios-manual"
                      value={audioUrls}
                      onChange={(event) => setAudioUrls(event.target.value)}
                      className="min-h-28 rounded-xl text-base leading-relaxed"
                      placeholder="每行一个音频 URL，支持 https://、asset://<asset-id> 或 data:audio/...;base64,..."
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-5 px-6 py-6 sm:px-8">
              <h3 className="text-xl font-semibold tracking-tight">输出参数</h3>
              <div className="space-y-4">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">模式</span>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          ["multimodal", "多模态参考"],
                          ["first_frame", "首帧图生视频"],
                          ["first_last_frame", "首尾帧生视频"],
                        ] as const
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setImageMode(mode)}
                          className={cn(
                            "rounded-full border px-4 py-2 text-sm font-medium transition",
                            imageMode === mode
                              ? "border-primary bg-primary/8 text-primary"
                              : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                      {imageMode === "multimodal" && (
                        <>
                          <span className="font-semibold text-foreground">多模态参考</span>
                          {" — "}上传的图片作为「外观/风格参考」，不固定首帧画面；可同时加入参考视频（动作参考）和参考音频（节奏/BGM）。适合：有参考素材但不需要精确控制起始画面的场景。
                        </>
                      )}
                      {imageMode === "first_frame" && (
                        <>
                          <span className="font-semibold text-foreground">首帧图生视频</span>
                          {" — "}上传 1 张图片作为视频的第 1 帧，生成内容从该画面自然延伸。<span className="font-medium text-foreground">不能同时携带参考视频或参考音频。</span>适合：续拍（把上一段的尾帧作为首帧）、固定开场镜头、产品展示等。
                        </>
                      )}
                      {imageMode === "first_last_frame" && (
                        <>
                          <span className="font-semibold text-foreground">首尾帧生视频</span>
                          {" — "}上传 2 张图片，第 1 张固定视频起点，第 2 张固定视频终点，模型自动填充中间过渡动画。<span className="font-medium text-foreground">不能同时携带参考视频或参考音频。</span>适合：需要精确控制开头和结尾画面的镜头，例如产品变形、场景转换。
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">模型</span>
                  <div className="flex flex-wrap gap-2">
                    {SEEDANCE_MODEL_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setModelId(option.id)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition",
                          modelId === option.id
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">比例</span>
                  <div className="flex flex-wrap gap-2">
                    {SEEDANCE_RATIO_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setRatio(option)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition",
                          ratio === option
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option === "adaptive" ? "自适应" : option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">清晰度</span>
                  <div className="flex flex-wrap gap-2">
                    {SEEDANCE_RESOLUTION_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setResolution(option)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition",
                          resolution === option
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">时长</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {SEEDANCE_20_DURATION.presets.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setDuration(String(option))}
                        className={cn(
                          "rounded-full border px-4 py-2 text-sm font-medium transition",
                          duration === String(option)
                            ? "border-primary bg-primary/8 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {option} 秒
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDuration(String(SEEDANCE_20_DURATION.auto))}
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm font-medium transition",
                        duration === String(SEEDANCE_20_DURATION.auto)
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border bg-muted/40 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      智能
                    </button>
                    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground">
                      <span className="shrink-0">自定义</span>
                      <Input
                        type="number"
                        min={SEEDANCE_20_DURATION.auto}
                        max={SEEDANCE_20_DURATION.maxSeconds}
                        step={1}
                        value={duration}
                        onChange={(event) => setDuration(event.target.value)}
                        onBlur={() => {
                          const next = Math.round(Number(duration));
                          if (!isValidSeedance20DurationValue(next)) {
                            const clamped = Math.min(
                              Math.max(Number.isFinite(next) ? next : SEEDANCE_20_DURATION.minSeconds, SEEDANCE_20_DURATION.minSeconds),
                              SEEDANCE_20_DURATION.maxSeconds
                            );
                            setDuration(String(clamped));
                          }
                        }}
                        className="h-8 w-16 border-0 bg-transparent px-1 text-center text-sm shadow-none focus-visible:ring-0"
                      />
                      <span className="shrink-0">秒</span>
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:gap-6">
                  <span className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">选项</span>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
                      <Checkbox checked={generateAudio} onCheckedChange={(value) => setGenerateAudio(Boolean(value))} />
                      输出声音
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
                      <Checkbox checked={returnLastFrame} onCheckedChange={(value) => setReturnLastFrame(Boolean(value))} />
                      返回尾帧
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
                      <Checkbox
                        checked={enableWebSearch}
                        onCheckedChange={(value) => setEnableWebSearch(Boolean(value))}
                        disabled={!webSearchAvailable}
                      />
                      联网搜索
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2.5 rounded-full border border-border bg-muted/40 px-4 py-2 text-sm text-foreground">
                      <Checkbox checked={watermark} onCheckedChange={(value) => setWatermark(Boolean(value))} />
                      保留水印
                    </label>
                  </div>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                素材上限：图 {SEEDANCE_REFERENCE_LIMITS.images} / 视频 {SEEDANCE_REFERENCE_LIMITS.videos} / 音频{" "}
                {SEEDANCE_REFERENCE_LIMITS.audios}。提交需至少「提示词」或「参考素材」其一；多模态时提示词可空。联网搜索仅纯文本、不可带素材。
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4 border-t border-border bg-muted/20 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p className="text-sm text-muted-foreground">
              <span className="font-mono text-base text-foreground/90">{modelId}</span>
              <span className="mx-2 text-border">·</span>
              已选素材 {referenceCount} 个
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" size="default" onClick={resetForm}>
                清空画布
              </Button>
              <Button type="submit" size="lg" className="min-h-11 px-8 text-base" disabled={submitting || !configured}>
                {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                {submitting ? "生成中…" : "开始生成视频"}
              </Button>
            </div>
          </div>
        </form>
      </Card>

      <div className="flex w-full flex-col gap-8">
        <Card className="rounded-2xl border-border/70 bg-card/90 shadow-md">
          <CardHeader className="pb-2 pt-6 sm:px-8">
            <CardTitle className="text-2xl font-semibold tracking-tight">生成结果</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-6 sm:px-8">
            <div className="flex gap-3">
              <Input
                value={taskIdInput}
                onChange={(event) => setTaskIdInput(event.target.value)}
                placeholder="任务 ID"
                className="h-11 rounded-xl text-base"
              />
              <Button type="button" variant="outline" size="default" className="shrink-0 px-5" onClick={() => void refreshTask()} disabled={refreshing}>
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </div>

            {task ? (
              <div className="space-y-4">
                {task.videoUrls.length > 0 ? (
                  <video
                    className="aspect-video w-full rounded-xl border bg-black"
                    src={task.videoUrls[0]}
                    controls
                    playsInline
                  />
                ) : shouldAutoPoll ? (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-base text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    正在轮询，完成后会显示视频。
                  </div>
                ) : null}

                {task.taskId ? (
                  <div className="rounded-xl border border-border/80 bg-muted/15 px-4 py-4">
                    {(() => {
                      const tid = task.taskId;
                      const hasSnapshot =
                        tid != null && Object.prototype.hasOwnProperty.call(promptHistory, tid);
                      const snapshotText = hasSnapshot && tid != null ? promptHistory[tid] : undefined;
                      return (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">提交时的提示词</p>
                            {snapshotText != null && snapshotText.length > 0 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="shrink-0 text-sm"
                                onClick={() => setPrompt(snapshotText)}
                              >
                                填入创作区
                              </Button>
                            ) : null}
                          </div>
                          {snapshotText != null ? (
                            snapshotText.length > 0 ? (
                              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/95">
                                {snapshotText}
                              </p>
                            ) : (
                              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                                本次提交未包含文本提示词（例如仅使用参考素材的多模态任务）。
                              </p>
                            )
                          ) : (
                            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                              暂无全站保存的提示词快照（可能为该任务创建于本功能上线之前，或写入失败）。可尝试刷新任务或联系管理员检查数据库迁移是否已执行。
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                <div className="flex items-start justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">任务</p>
                    <p className="break-all font-mono text-sm text-foreground">{task.taskId || "—"}</p>
                    <p className="mt-1 text-base font-semibold">{statusLabel(task.status)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {task.taskId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10"
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
                    {task.taskId ? (
                      <Button type="button" variant="outline" size="default" className="text-sm" onClick={() => void deleteTask(task.taskId)}>
                        {isTerminal(task.status) ? "删除" : "取消"}
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border text-sm sm:grid-cols-3">
                  {[
                    ["模型", task.model ?? submittedParams?.modelId ?? "—"],
                    [
                      "分辨率",
                      `${task.resolution ?? submittedParams?.resolution ?? "—"} / ${task.ratio ?? submittedParams?.ratio ?? "—"}`,
                    ],
                    [
                      "时长",
                      task.durationSeconds != null
                        ? `${task.durationSeconds} 秒`
                        : submittedParams?.duration != null
                          ? `${submittedParams.duration} 秒`
                          : "—",
                    ],
                    ["FPS", String(task.framesPerSecond ?? "—")],
                    ["创建", formatDateTime(task.createdAt)],
                    ["更新", formatDateTime(task.updatedAt)],
                    ["服务", task.serviceTier ?? "—"],
                    [
                      "usage / seed",
                      `${task.usageTokens ?? "—"} / ${task.seed ?? "—"}`,
                    ],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-card px-3 py-2.5">
                      <p className="text-xs text-muted-foreground">{k}</p>
                      <p className="mt-1 line-clamp-2 break-all font-medium leading-snug">{v}</p>
                    </div>
                  ))}
                </div>

                {task.message ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
                    {task.message}
                  </div>
                ) : null}

                {task.videoUrls.length > 1 ? (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">全部地址</p>
                    {task.videoUrls.map((url) => (
                      <div
                        key={url}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="line-clamp-2 min-w-0 break-all">{url}</span>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    ))}
                  </div>
                ) : null}

                {task.lastFrameUrls.length > 0 ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-base font-semibold">尾帧</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="default"
                        className="text-sm"
                        onClick={() => applyLastFrameAsFirstFrame(task.lastFrameUrls[0])}
                      >
                        <Play className="h-4 w-4" />
                        以此接续生成
                      </Button>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={task.lastFrameUrls[0]}
                      alt="任务尾帧"
                      className="w-full rounded-xl border bg-muted/30"
                    />
                  </div>
                ) : task.videoUrls.length > 0 && task.status === "succeeded" ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
                    <p className="text-sm text-muted-foreground">
                      本次未返回尾帧。勾选「返回尾帧」后重新生成可启用接续，或将此视频作为参考视频续拍。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      className="shrink-0 text-sm"
                      onClick={() => {
                        setVideoUrls((prev) => appendUrlLine(prev, task.videoUrls[0]));
                        setImageMode("multimodal");
                        setReturnLastFrame(true);
                        toast.success("已添加为参考视频，并自动勾选「返回尾帧」");
                      }}
                    >
                      <Video className="h-4 w-4" />
                      加入参考视频续拍
                    </Button>
                  </div>
                ) : null}

                <details className="rounded-xl border">
                  <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted-foreground">
                    原始返回（调试）
                  </summary>
                  <pre className="max-h-56 overflow-auto border-t bg-muted/50 p-3 text-xs leading-relaxed">
                    {JSON.stringify(task.raw, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed px-6 py-12 text-center text-base text-muted-foreground">
                提交任务后在此查看状态与视频。
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/90 shadow-md">
          <CardHeader className="pb-2 pt-6 sm:px-8">
            <CardTitle className="text-2xl font-semibold tracking-tight">价格</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-6 pb-6 sm:px-8">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="font-medium">提交前估算</span>
              <span>{hasVideoReferenceInput ? "含视频参考" : "无视频参考"}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border bg-muted/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">单价</p>
                <p className="mt-1 font-semibold leading-snug">
                  {currentPricingEstimate
                    ? `${formatCurrency(currentPricingEstimate.unitPriceYuanPerMillionTokens)} / 百万 token`
                    : "—"}
                </p>
              </div>
              <div className="rounded-xl border bg-muted/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">预估 token</p>
                <p className="mt-1 font-semibold">
                  {currentPricingEstimate?.estimatedTokens != null
                    ? formatTokenCount(currentPricingEstimate.estimatedTokens)
                    : "—"}
                </p>
              </div>
              <div className="col-span-2 rounded-xl border bg-muted/30 px-3 py-3">
                <p className="text-xs text-muted-foreground">预估费用 / 次</p>
                <p className="mt-1 font-semibold">
                  {currentPricingEstimate?.estimatedCostYuan != null
                    ? `${formatCurrency(currentPricingEstimate.estimatedCostYuan)} 元`
                    : "提交后看 usage"}
                </p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {currentPricingEstimate?.note ?? "当前模型可能未配置价格估算。"}
            </p>

            <div className="border-t pt-4">
              <p className="mb-3 text-sm font-medium text-muted-foreground">当前任务（usage）</p>
              {selectedTaskPricing ? (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border bg-muted/30 px-3 py-3">
                    <p className="text-xs text-muted-foreground">token</p>
                    <p className="mt-1 font-semibold">{formatTokenCount(selectedTaskPricing.usageTokens)}</p>
                  </div>
                  <div className="rounded-xl border bg-muted/30 px-3 py-3">
                    <p className="text-xs text-muted-foreground">单价</p>
                    <p className="mt-1 font-semibold leading-snug">
                      {formatCurrency(selectedTaskPricing.unitPriceYuanPerMillionTokens)} / 百万
                    </p>
                  </div>
                  <div className="col-span-2 rounded-xl border bg-muted/30 px-3 py-3">
                    <p className="text-xs text-muted-foreground">估算费用</p>
                    <p className="mt-1 font-semibold">{formatCurrency(selectedTaskPricing.estimatedCostYuan)} 元</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">有 usage 的任务会显示更接近账单的估算。</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/70 bg-card/90 shadow-md">
          <CardHeader className="space-y-2 pb-2 pt-6 sm:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-2xl font-semibold tracking-tight">最近生成</CardTitle>
              <Button type="button" variant="outline" size="default" className="text-sm" onClick={() => void loadHistory()} disabled={historyLoading}>
                {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              视频列表来自方舟。提示词快照在服务端保存，全站登录成员可见；本机仍会缓存一份便于离线回看。
            </p>
            {profileMissing ? (
              <div className="rounded-xl border border-rose-200/80 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-950 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-100">
                你已登录，但账号尚未写入「用户资料表」（public.users），与中间件只校验会话不同，Seedance
                接口需要完整用户记录。请联系管理员在数据库中补全你的用户行，或走注册/同步流程。
              </div>
            ) : !authenticated ? (
              <div className="rounded-xl border border-amber-200/70 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100">
                当前未登录，无法拉取「最近生成」与全站提示词快照。请先{" "}
                <Link href="/login" className="font-medium text-primary underline underline-offset-4">
                  登录
                </Link>
                ，或点击刷新时会提示登录。
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="max-h-[min(75vh,640px)] space-y-4 overflow-y-auto px-6 pb-6 pr-2 sm:px-8">
            {historyItems.length === 0 ? (
              <div className="rounded-xl border border-dashed px-6 py-10 text-center text-base text-muted-foreground">
                {profileMissing
                  ? "用户资料未同步，无法拉取历史（见上方说明）。"
                  : authenticated
                    ? "暂无历史记录。"
                    : "登录后可查看全站历史任务与提示词快照。"}
              </div>
            ) : (
              historyItems.map((item) => {
                const hasSnapshot = Object.prototype.hasOwnProperty.call(promptHistory, item.taskId);
                const saved = hasSnapshot ? promptHistory[item.taskId] : undefined;
                const expanded = historyPromptExpanded[item.taskId] ?? false;
                const promptLongThreshold = 200;
                const isLong = saved != null && saved.length > promptLongThreshold;
                return (
                  <div key={item.taskId} className="space-y-4 rounded-xl border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-foreground">{item.taskId}</p>
                        <p className="text-sm text-muted-foreground">
                          {statusLabel(item.status)} · {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-sm"
                        onClick={() => {
                          setTask(item);
                          setTaskIdInput(item.taskId);
                        }}
                      >
                        在上方查看
                      </Button>
                    </div>

                    {item.videoUrls[0] ? (
                      <video
                        className="aspect-video w-full rounded-xl border bg-black"
                        src={item.videoUrls[0]}
                        controls
                        playsInline
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">暂无视频地址。</p>
                    )}

                    {item.lastFrameUrls[0] ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-muted-foreground">视频尾帧</p>
                          <div className="flex shrink-0 gap-2">
                            {item.videoUrls[0] ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-sm"
                                onClick={() => {
                                  setVideoUrls((prev) => appendUrlLine(prev, item.videoUrls[0]));
                                  setImageMode("multimodal");
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                  toast.success("已添加为参考视频，可在上方配合提示词续拍");
                                }}
                              >
                                <Video className="h-3.5 w-3.5" />
                                加入参考视频
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-sm"
                              onClick={() => applyLastFrameAsFirstFrame(item.lastFrameUrls[0])}
                            >
                              <Play className="h-3.5 w-3.5" />
                              以此接续生成
                            </Button>
                          </div>
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.lastFrameUrls[0]}
                          alt="视频尾帧"
                          className="w-full rounded-xl border bg-muted/30"
                        />
                      </div>
                    ) : item.videoUrls[0] && item.status === "succeeded" ? (
                      <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3">
                        <p className="text-sm text-muted-foreground">
                          未保存尾帧。可将此视频加入参考，或在下次生成时勾选「返回尾帧」以启用接续。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0 text-sm"
                          onClick={() => {
                            setVideoUrls((prev) => appendUrlLine(prev, item.videoUrls[0]));
                            setImageMode("multimodal");
                            window.scrollTo({ top: 0, behavior: "smooth" });
                            toast.success("已添加为参考视频，可在上方配合提示词续拍");
                          }}
                        >
                          <Video className="h-3.5 w-3.5" />
                          加入参考视频
                        </Button>
                      </div>
                    ) : null}

                    <div className="rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-foreground">当时提示词</p>
                        {saved != null && saved.length > 0 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="shrink-0 text-sm text-primary"
                            onClick={() => setPrompt(saved)}
                          >
                            填入创作区
                          </Button>
                        ) : null}
                      </div>
                      {saved != null ? (
                        saved.length > 0 ? (
                          <>
                            <p
                              className={cn(
                                "mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/95",
                                !expanded && isLong && "line-clamp-4"
                              )}
                            >
                              {saved}
                            </p>
                            {isLong ? (
                              <button
                                type="button"
                                className="mt-2 text-sm font-medium text-primary hover:underline"
                                onClick={() =>
                                  setHistoryPromptExpanded((prev) => ({
                                    ...prev,
                                    [item.taskId]: !expanded,
                                  }))
                                }
                              >
                                {expanded ? "收起" : "展开全文"}
                              </button>
                            ) : null}
                          </>
                        ) : (
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            本次提交未包含文本提示词（例如仅参考素材）。
                          </p>
                        )
                      ) : (
                        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                          暂无全站提示词快照（任务可能早于本功能创建，或尚未同步）。
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <SeedancePromptDialog
        open={promptDialogOpen}
        onOpenChange={setPromptDialogOpen}
        mode={promptBuilderMode}
        onModeChange={setPromptBuilderMode}
        draft={promptDraft}
        onDraftChange={setPromptDraft}
        preview={promptPreview}
        onPreviewChange={setPromptPreview}
        currentPrompt={prompt}
        referenceCounts={referenceAssetCounts}
        referenceOptions={promptReferenceOptions}
        onApply={applyPromptFromDialog}
      />
    </div>
  );
}
