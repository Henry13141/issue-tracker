"use client";

import type { KeyboardEvent as ReactKeyboardEvent, TextareaHTMLAttributes } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Copy, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import {
  buildSeedancePromptWithReferenceHint,
  buildSeedanceOptimizationFallback,
  canGenerateSeedancePrompt,
  normalizeSeedanceReferenceMentions,
  SEEDANCE_DOC_SNIPPETS,
  type PromptBuilderMode,
  type PromptDraft,
  type ReferenceAssetCounts,
  type SeedancePromptOptimizationResult,
} from "@/lib/seedance-prompt-builder";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type PromptFieldKey = keyof PromptDraft;
type LocalAssetKind = "image" | "video" | "audio";
type PromptReferenceOption = {
  id: string;
  kind: LocalAssetKind;
  label: string;
  filename: string;
  searchText: string;
};
type PromptReferenceMention = {
  start: number;
  end: number;
  query: string;
};

const STRUCTURED_FIELDS: Array<{
  key: PromptFieldKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "goal", label: "想做什么视频", placeholder: "例如：一支电影感的新品发布短视频" },
  { key: "subject", label: "主体", placeholder: "例如：一个穿白衬衫的年轻女生" },
  { key: "action", label: "动作", placeholder: "例如：拿起相机，转头朝窗外看去" },
  { key: "scene", label: "场景", placeholder: "例如：雨后的城市天台，远处霓虹闪烁" },
  { key: "style", label: "风格", placeholder: "例如：电影感、写实、细腻、偏冷色调" },
  { key: "camera", label: "镜头语言", placeholder: "例如：先中景跟拍，再缓慢推近到面部特写" },
  { key: "lighting", label: "光影氛围", placeholder: "例如：清晨逆光，空气里有薄雾和微尘" },
  { key: "audio", label: "声音", placeholder: "例如：有环境雨声和轻柔钢琴，旁白节奏平稳", multiline: true },
  { key: "textOverlay", label: "文字/字幕", placeholder: "例如：结尾出现品牌名，底部字幕跟旁白同步", multiline: true },
  { key: "imageReference", label: "图片参考说明", placeholder: "例如：人物形象参考图片1，构图参考图片2", multiline: true },
  { key: "videoReference", label: "视频参考说明", placeholder: "例如：动作参考视频1，运镜参考视频2", multiline: true },
  { key: "constraints", label: "额外约束", placeholder: "例如：保持主体一致，不要出现多余人物，动作和运镜自然", multiline: true },
];

const FIELD_SUGGESTIONS: Partial<Record<PromptFieldKey, string[]>> = {
  style: ["电影感", "写实", "二次元动画", "3D 赛博朋克", "广告大片", "温暖日常"],
  camera: ["缓慢推近", "横向跟拍", "俯冲镜头", "第一视角", "中景切近景", "特写定格"],
  lighting: ["晨光逆光", "暖色室内光", "夜景霓虹", "薄雾氛围", "柔和自然光", "高对比戏剧光"],
  audio: ["有环境音", "有旁白", "有背景音乐", "字幕跟语音同步", "节奏轻快", "节奏舒缓"],
  textOverlay: [
    "结尾出现品牌名，风格与画面统一",
    "底部字幕与台词同步",
    "角色旁白时出现对应字幕",
    "广告语在画面中部淡入淡出",
  ],
  imageReference: ["主体外观参考图片1", "构图参考图片2", "Logo 参考图片1", "分镜按图片顺序切换"],
  videoReference: ["动作参考视频1", "运镜参考视频2", "特效参考视频1", "节奏参考视频1"],
  constraints: ["保持主体一致", "动作自然", "运镜稳定", "不要多余人物", "细节清晰", "构图干净"],
};

const WIZARD_STEPS: Array<{
  title: string;
  description: string;
  fields: PromptFieldKey[];
}> = [
  {
    title: "想做什么",
    description: "先描述视频目标和核心主体。",
    fields: ["goal", "subject"],
  },
  {
    title: "发生什么",
    description: "补充主体动作与场景环境。",
    fields: ["action", "scene"],
  },
  {
    title: "长什么样",
    description: "补充风格、镜头和光影氛围。",
    fields: ["style", "camera", "lighting"],
  },
  {
    title: "听到什么",
    description: "说明音频、字幕和画面文字需求。",
    fields: ["audio", "textOverlay"],
  },
  {
    title: "参考与约束",
    description: "写清参考素材与不变约束。",
    fields: ["imageReference", "videoReference", "constraints"],
  },
];

function appendSuggestion(previous: string, suggestion: string) {
  const value = previous.trim();
  if (!value) return suggestion;
  if (value.includes(suggestion)) return value;
  const separator = /[，。；\n]$/.test(value) ? "" : "，";
  return `${value}${separator}${suggestion}`;
}

function appendBlock(previous: string, block: string) {
  const a = previous.trim();
  const b = block.trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b.slice(0, 24))) return a;
  return `${a}\n\n${b}`;
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

function kindLabel(kind: LocalAssetKind) {
  if (kind === "image") return "图片";
  if (kind === "video") return "视频";
  return "音频";
}

function renderHighlightedSegments(value: string) {
  const segments: Array<{ text: string; highlighted: boolean }> = [];
  const pattern = /@?(图片|视频|音频)\d+/g;
  let lastIndex = 0;

  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ text: value.slice(lastIndex, index), highlighted: false });
    }
    segments.push({ text: match[0], highlighted: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) {
    segments.push({ text: value.slice(lastIndex), highlighted: false });
  }

  return segments.length > 0 ? segments : [{ text: value, highlighted: false }];
}

type ReferenceMentionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (next: string) => void;
  referenceOptions: PromptReferenceOption[];
  multiline?: boolean;
};

function ReferenceMentionTextarea({
  value,
  onChange,
  referenceOptions,
  multiline = true,
  className,
  onBlur,
  onFocus,
  onKeyDown,
  ...props
}: ReferenceMentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

  const mention = useMemo(
    () => (selection.start === selection.end ? getPromptReferenceMention(value, selection.start) : null),
    [selection.end, selection.start, value]
  );
  const filteredOptions = useMemo(() => {
    if (!mention) return [];
    const query = mention.query.trim().toLowerCase();
    if (!query) return referenceOptions;
    return referenceOptions.filter((option) => option.searchText.includes(query));
  }, [mention, referenceOptions]);
  const showMenu = focused && mention !== null;
  const highlightedSegments = useMemo(() => renderHighlightedSegments(value), [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query, mention?.start]);

  useEffect(() => {
    if (activeIndex < filteredOptions.length) return;
    setActiveIndex(0);
  }, [activeIndex, filteredOptions.length]);

  function syncSelection(target: HTMLTextAreaElement) {
    setSelection({
      start: target.selectionStart ?? 0,
      end: target.selectionEnd ?? 0,
    });
    setScrollOffset({
      top: target.scrollTop,
      left: target.scrollLeft,
    });
  }

  function focusTo(position: number) {
    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.selectionStart = position;
      target.selectionEnd = position;
      syncSelection(target);
    });
  }

  function replaceRange(start: number, end: number, next: string) {
    const updated = `${value.slice(0, start)}${next}${value.slice(end)}`;
    onChange(updated);
    focusTo(start + next.length);
  }

  function insertReference(option: PromptReferenceOption | undefined) {
    if (!option || !mention) return;
    replaceRange(mention.start, selection.end, `@${option.label}`);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || !showMenu) return;

    if (event.key === "ArrowDown") {
      if (filteredOptions.length === 0) return;
      event.preventDefault();
      setActiveIndex((previous) => (previous + 1 >= filteredOptions.length ? 0 : previous + 1));
      return;
    }

    if (event.key === "ArrowUp") {
      if (filteredOptions.length === 0) return;
      event.preventDefault();
      setActiveIndex((previous) => (previous - 1 < 0 ? filteredOptions.length - 1 : previous - 1));
      return;
    }

    if ((event.key === "Enter" || event.key === "Tab") && filteredOptions.length > 0) {
      event.preventDefault();
      insertReference(filteredOptions[activeIndex]);
      return;
    }

    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      const target = textareaRef.current;
      if (!target || !mention) return;
      focusTo(mention.end);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative overflow-hidden rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
          className
        )}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden px-2.5 py-2 text-base md:text-sm">
          <div
            className="min-h-full whitespace-pre-wrap break-words text-foreground"
            style={{ transform: `translate(${-scrollOffset.left}px, ${-scrollOffset.top}px)` }}
          >
            {value ? (
              highlightedSegments.map((segment, index) => (
                <span
                  key={`${segment.text}-${index}`}
                  className={
                    segment.highlighted
                      ? "font-medium text-sky-600 underline decoration-sky-500 underline-offset-4 dark:text-sky-400 dark:decoration-sky-400"
                      : undefined
                  }
                >
                  {segment.text}
                </span>
              ))
            ) : (
              " "
            )}
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            syncSelection(event.target);
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={(event) => syncSelection(event.currentTarget)}
          onClick={(event) => syncSelection(event.currentTarget)}
          onSelect={(event) => syncSelection(event.currentTarget)}
          onScroll={(event) => syncSelection(event.currentTarget)}
          onFocus={(event) => {
            setFocused(true);
            syncSelection(event.currentTarget);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          rows={multiline ? props.rows : 1}
          className={cn(
            "relative z-10 min-h-16 w-full resize-none bg-transparent px-2.5 py-2 text-base text-transparent outline-none caret-foreground placeholder:text-muted-foreground selection:bg-primary/15 md:text-sm",
            "disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:disabled:bg-input/80"
          )}
          {...props}
        />
        {showMenu ? (
          <div className="absolute inset-x-2 top-full z-20 mt-2 rounded-2xl border border-border/70 bg-popover p-2 shadow-lg">
            <div className="flex items-center justify-between gap-3 px-2 py-1">
              <p className="text-xs font-medium">插入参考素材</p>
              <p className="text-[11px] text-muted-foreground">输入 @图片1 / @视频1 / 文件名筛选</p>
            </div>
            {filteredOptions.length > 0 ? (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {filteredOptions.map((option, index) => (
                  <button
                    key={option.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      insertReference(option);
                    }}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-left transition hover:bg-muted",
                      index === activeIndex && "bg-muted"
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-sky-600 underline decoration-sky-500 underline-offset-4 dark:text-sky-400 dark:decoration-sky-400">
                          @{option.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{option.filename}</p>
                      </div>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {kindLabel(option.kind)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                没有匹配的已上传素材，试试输入 @图片1、@视频1、@音频1 或文件名。
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const DOC_TEMPLATE_BUTTONS: Array<{
  label: string;
  field: PromptFieldKey;
  snippet: string;
  hint: string;
}> = [
  { label: "基础公式", field: "goal", snippet: SEEDANCE_DOC_SNIPPETS.baseFormula, hint: "官方：主体 + 动作 + 环境/美学 + 运镜/音频" },
  { label: "广告语", field: "textOverlay", snippet: SEEDANCE_DOC_SNIPPETS.slogan, hint: "官方：文字内容 + 出现时机 + 位置 + 方式 + 风格" },
  { label: "字幕", field: "textOverlay", snippet: SEEDANCE_DOC_SNIPPETS.subtitle, hint: "官方：底部字幕与音频节奏同步" },
  { label: "气泡台词", field: "textOverlay", snippet: SEEDANCE_DOC_SNIPPETS.bubbleSpeech, hint: "官方：气泡内为台词" },
  { label: "主体图参考", field: "imageReference", snippet: SEEDANCE_DOC_SNIPPETS.subjectFromImages, hint: "官方：多图锁定主体一致性" },
  { label: "分镜图参考", field: "imageReference", snippet: SEEDANCE_DOC_SNIPPETS.storyboardFromImages, hint: "官方：多图顺序作为分镜" },
  { label: "Logo 参考", field: "imageReference", snippet: SEEDANCE_DOC_SNIPPETS.logoReference, hint: "官方：Logo 作为画面元素引用" },
  { label: "动作参考", field: "videoReference", snippet: SEEDANCE_DOC_SNIPPETS.actionFromVideo, hint: "官方：参考视频n 的动作" },
  { label: "运镜参考", field: "videoReference", snippet: SEEDANCE_DOC_SNIPPETS.cameraFromVideo, hint: "官方：参考视频n 的运镜" },
  { label: "特效参考", field: "videoReference", snippet: SEEDANCE_DOC_SNIPPETS.vfxFromVideo, hint: "官方：参考视频n 的特效" },
  { label: "增加元素", field: "constraints", snippet: SEEDANCE_DOC_SNIPPETS.addElementEdit, hint: "官方：视频编辑中的元素增加" },
  { label: "替换元素", field: "constraints", snippet: SEEDANCE_DOC_SNIPPETS.replaceElementEdit, hint: "官方：视频编辑中的元素替换" },
  { label: "删除元素", field: "constraints", snippet: SEEDANCE_DOC_SNIPPETS.removeElementEdit, hint: "官方：视频编辑中的元素删除" },
  { label: "视频延长", field: "videoReference", snippet: SEEDANCE_DOC_SNIPPETS.extendVideo, hint: "官方：向前/向后延长视频" },
  { label: "轨道补齐", field: "videoReference", snippet: SEEDANCE_DOC_SNIPPETS.stitchVideos, hint: "官方：多段视频过渡衔接" },
];

const SCENARIO_LABELS: Record<
  SeedancePromptOptimizationResult["detectedScenario"],
  string
> = {
  general: "通用视频生成",
  multimodal_reference: "多模态参考",
  video_edit: "视频编辑",
  video_extend: "视频延长",
  video_stitch: "轨道补齐",
  first_frame: "首帧图生视频",
  first_last_frame: "首尾帧生视频",
};

function PromptField({
  label,
  placeholder,
  value,
  onChange,
  multiline = false,
  suggestions = [],
  referenceOptions = [],
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  suggestions?: string[];
  referenceOptions?: PromptReferenceOption[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <ReferenceMentionTextarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={multiline ? "min-h-24" : "min-h-10"}
        referenceOptions={referenceOptions}
        multiline={multiline}
      />
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onChange(appendSuggestion(value, suggestion))}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border bg-background p-4">
      <p className="text-sm font-medium">{title}</p>
      {items.length > 0 ? (
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          {items.map((item, index) => (
            <p key={`${title}-${index}`}>{index + 1}. {item}</p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function SeedancePromptDialog({
  open,
  onOpenChange,
  mode,
  onModeChange,
  draft,
  onDraftChange,
  preview,
  onPreviewChange,
  currentPrompt,
  referenceCounts,
  referenceOptions,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: PromptBuilderMode;
  onModeChange: (mode: PromptBuilderMode) => void;
  draft: PromptDraft;
  onDraftChange: (draft: PromptDraft) => void;
  preview: string;
  onPreviewChange: (preview: string) => void;
  currentPrompt: string;
  /** 主界面参考素材条数，用于自动生成「图片1」「视频1」编号提示 */
  referenceCounts: ReferenceAssetCounts;
  referenceOptions: PromptReferenceOption[];
  onApply: (mode: "replace" | "append", text: string) => void;
}) {
  const [wizardStep, setWizardStep] = useState(0);
  const [optimizerInput, setOptimizerInput] = useState("");
  const [optimizerResult, setOptimizerResult] = useState<SeedancePromptOptimizationResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const autoOptimizedSignatureRef = useRef("");

  useEffect(() => {
    if (!open) {
      setWizardStep(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (optimizerInput.trim()) return;
    if (currentPrompt.trim()) {
      setOptimizerInput(currentPrompt);
    }
  }, [currentPrompt, open, optimizerInput]);

  const referenceSummary = useMemo(() => {
    const { images, videos, audios } = referenceCounts;
    if (images === 0 && videos === 0 && audios === 0) return null;
    return `主界面参考：图 ${images} · 视频 ${videos} · 音频 ${audios}`;
  }, [referenceCounts]);

  const hasPreview = preview.trim().length > 0;
  const canGoPrev = wizardStep > 0;
  const canGoNext = wizardStep < WIZARD_STEPS.length - 1;
  const activeStep = WIZARD_STEPS[wizardStep];
  const isOptimizerMode = mode === "optimizer";
  const optimizerAutoSignature = useMemo(
    () =>
      JSON.stringify({
        input: optimizerInput.trim(),
        referenceCounts,
      }),
    [optimizerInput, referenceCounts]
  );

  function updateField(key: PromptFieldKey, value: string) {
    onDraftChange({
      ...draft,
      [key]: value,
    });
  }

  function generatePrompt() {
    if (!canGenerateSeedancePrompt(draft, referenceCounts)) {
      toast.error("先填写左侧内容，或在主界面添加至少一张参考图/一段参考视频/音频");
      return;
    }
    const next = buildSeedancePromptWithReferenceHint(draft, referenceCounts);
    onPreviewChange(next);
    toast.success("提示词草稿已生成，可继续手动修改");
  }

  function handlePreviewChange(next: string) {
    onPreviewChange(next);
    setOptimizerResult((previous) =>
      previous
        ? {
            ...previous,
            optimizedPrompt: next,
          }
        : previous
    );
  }

  function seedOptimizerFromCurrentPrompt() {
    const next = currentPrompt.trim();
    if (!next) {
      toast.error("当前主输入框还没有内容");
      return;
    }
    setOptimizerInput(next);
    toast.success("已带入当前主输入框内容");
  }

  function seedOptimizerFromDraft() {
    if (!canGenerateSeedancePrompt(draft, referenceCounts)) {
      toast.error("先填写结构化内容，或在主界面添加参考素材");
      return;
    }
    const next = buildSeedancePromptWithReferenceHint(draft, referenceCounts);
    setOptimizerInput(next);
    toast.success("已把结构化草稿转成待优化初稿");
  }

  async function optimizePrompt(options?: { rawPrompt?: string; silent?: boolean }) {
    const rawPrompt = normalizeSeedanceReferenceMentions(
      options?.rawPrompt?.trim() || optimizerInput.trim() || currentPrompt.trim()
    );
    if (!rawPrompt && !canGenerateSeedancePrompt(draft, referenceCounts)) {
      toast.error("先输入原始提示词，或准备一份结构化草稿");
      return;
    }

    const localFallback = () => {
      const result = buildSeedanceOptimizationFallback({
        rawPrompt,
        draft,
        counts: referenceCounts,
      });
      autoOptimizedSignatureRef.current = JSON.stringify({
        input: rawPrompt,
        referenceCounts,
      });
      setOptimizerResult({
        ...result,
        source: "fallback",
      });
      handlePreviewChange(result.optimizedPrompt);
      if (!options?.silent) {
        toast.success("AI 优化暂不可用，已按本地规则生成");
      }
    };

    setOptimizing(true);
    try {
      const response = await fetch("/api/seedance/prompt-optimize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawPrompt,
          draft,
          referenceCounts,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        result?: SeedancePromptOptimizationResult;
      };
      if (!response.ok) {
        console.warn("[seedance-prompt-optimize] non-ok response", response.status, data.error);
        localFallback();
        return;
      }
      const result =
        data.result ||
        buildSeedanceOptimizationFallback({
          rawPrompt,
          draft,
          counts: referenceCounts,
        });
      autoOptimizedSignatureRef.current = JSON.stringify({
        input: rawPrompt,
        referenceCounts,
      });
      setOptimizerResult(result);
      handlePreviewChange(result.optimizedPrompt);
      if (!options?.silent) {
        if (result.ready) {
          toast.success(result.source === "fallback" ? "已按本地规则完成优化" : "已生成 sd2-pe 风格优化稿");
        } else {
          toast.success("已完成问题分析，请先补充关键信息");
        }
      }
    } catch (error) {
      console.error("[seedance-prompt-optimize] request failed", error);
      localFallback();
    } finally {
      setOptimizing(false);
    }
  }

  useEffect(() => {
    if (!open || !isOptimizerMode) return;
    const trimmedInput = optimizerInput.trim();
    if (!trimmedInput) return;
    if (optimizing) return;
    if (optimizerAutoSignature === autoOptimizedSignatureRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void optimizePrompt({ rawPrompt: trimmedInput, silent: true });
    }, 700);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [open, isOptimizerMode, optimizerInput, optimizerAutoSignature, optimizing, draft, referenceCounts]);

  function insertDocTemplate(field: PromptFieldKey, snippet: string) {
    updateField(field, appendBlock(draft[field], snippet));
    toast.success("已插入官方文档句式，可按需改写");
  }

  async function copyPreview() {
    if (!hasPreview) {
      toast.error("先生成提示词再复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(preview);
      toast.success("提示词已复制");
    } catch {
      toast.error("复制失败");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 sm:max-w-6xl" showCloseButton>
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            Seedance 提示词助手
          </DialogTitle>
          <DialogDescription>
            既可以按表单拆解想法，也可以直接把原始提示词交给 AI 做 `sd2-pe` 风格分析和重写。右侧结果支持继续手改，再一键回填到主输入框。
            {referenceSummary ? (
              <span className="mt-2 block text-foreground/80">
                {referenceSummary}（输入 `@` 可插入参考素材，编辑区里的 `图片1 / 视频1 / 音频1` 会以蓝色下划线高亮）
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[75vh] gap-0 overflow-hidden lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <div className="overflow-y-auto border-b p-6 lg:border-r lg:border-b-0">
            <Tabs
              value={mode}
              onValueChange={(value) => onModeChange(value as PromptBuilderMode)}
              className="gap-4"
            >
              <TabsList>
                <TabsTrigger value="structured">结构化表单</TabsTrigger>
                <TabsTrigger value="wizard">分步向导</TabsTrigger>
                <TabsTrigger value="optimizer">AI 优化器</TabsTrigger>
              </TabsList>

              <div className="rounded-2xl border border-dashed border-primary/25 bg-primary/5 p-3">
                <p className="mb-2 text-xs font-medium text-foreground">官方文档快捷句式（点击插入到对应字段，可再改）</p>
                <div className="flex flex-wrap gap-2">
                  {DOC_TEMPLATE_BUTTONS.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      title={item.hint}
                      onClick={() => insertDocTemplate(item.field, item.snippet)}
                      className="rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <TabsContent value="structured" className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  {STRUCTURED_FIELDS.map((field) => (
                    <div
                      key={field.key}
                      className={cn(field.multiline ? "md:col-span-2" : undefined)}
                    >
                      <PromptField
                        label={field.label}
                        placeholder={field.placeholder}
                        value={draft[field.key]}
                        onChange={(next) => updateField(field.key, next)}
                        multiline={field.multiline}
                        suggestions={FIELD_SUGGESTIONS[field.key]}
                        referenceOptions={referenceOptions}
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="wizard" className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {WIZARD_STEPS.map((step, index) => (
                    <button
                      key={step.title}
                      type="button"
                      onClick={() => setWizardStep(index)}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs transition",
                        wizardStep === index
                          ? "border-primary bg-primary/8 text-primary"
                          : "border-border bg-background text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {index + 1}. {step.title}
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border bg-card p-4">
                  <p className="text-sm font-medium">{activeStep.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{activeStep.description}</p>
                </div>

                <div className="space-y-5">
                  {activeStep.fields.map((fieldKey) => {
                    const field = STRUCTURED_FIELDS.find((item) => item.key === fieldKey);
                    if (!field) return null;
                    return (
                      <PromptField
                        key={field.key}
                        label={field.label}
                        placeholder={field.placeholder}
                        value={draft[field.key]}
                        onChange={(next) => updateField(field.key, next)}
                        multiline={field.multiline}
                        suggestions={FIELD_SUGGESTIONS[field.key]}
                        referenceOptions={referenceOptions}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
                    disabled={!canGoPrev}
                  >
                    上一步
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setWizardStep((step) => Math.min(WIZARD_STEPS.length - 1, step + 1))
                    }
                    disabled={!canGoNext}
                  >
                    下一步
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="optimizer" className="space-y-5">
                <div className="rounded-2xl border border-dashed border-primary/25 bg-primary/5 p-4">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Bot className="h-4 w-4 text-primary" />
                    sd2-pe 风格工作流
                  </p>
                  <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                    <p>1. 先判断这是普通生成、首帧、首尾帧、多模态参考、视频编辑还是视频延长。</p>
                    <p>2. 再检查主体、动作、镜头、风格、声音、字幕和约束是否齐全。</p>
                    <p>3. 最后输出可直接提交的优化稿，并列出缺失项和改写原则。</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">原始提示词</Label>
                  <ReferenceMentionTextarea
                    value={optimizerInput}
                    onChange={setOptimizerInput}
                    placeholder="把你的想法贴进来，系统会自动分析并生成可直接使用的 Seedance 提示词。"
                    className="min-h-40"
                    referenceOptions={referenceOptions}
                  />
                  <p className="text-xs text-muted-foreground">
                    粘贴或停止输入约 0.7 秒后会自动生成，你也可以手动点“开始优化”。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={seedOptimizerFromCurrentPrompt}>
                      从主输入框带入
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={seedOptimizerFromDraft}>
                      从结构化草稿生成初稿
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden bg-muted/20">
            <div className="border-b px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{isOptimizerMode ? "sd2-pe 优化结果" : "提示词预览"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isOptimizerMode ? "先看问题分析，再决定是否直接回填优化稿。" : "先生成，再按你的习惯继续二改或三改。"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={copyPreview}
                  disabled={!hasPreview}
                >
                  <Copy className="h-4 w-4" />
                  复制
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {isOptimizerMode ? (
                <div className="space-y-4">
                  <div className="rounded-2xl border bg-background p-4">
                    <p className="text-sm font-medium">识别场景</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {optimizerResult
                        ? `${SCENARIO_LABELS[optimizerResult.detectedScenario]}${optimizerResult.source === "fallback" ? " · 本地降级结果" : " · AI 结果"}`
                        : "尚未分析"}
                    </p>
                  </div>

                  <ResultSection
                    title="原始提示词问题"
                    empty="点击“开始优化”后，这里会列出当前提示词最主要的问题。"
                    items={optimizerResult?.issues ?? []}
                  />
                  <ResultSection
                    title="相关原则"
                    empty="优化后会在这里解释为什么要这么改。"
                    items={optimizerResult?.principles ?? []}
                  />
                  <ResultSection
                    title="待确认信息"
                    empty={optimizerResult ? "无额外问题，当前信息已基本齐全。" : "优化后会在这里列出仍需你补充的信息。"}
                    items={optimizerResult?.clarificationQuestions ?? []}
                  />

                  <div className="rounded-2xl border bg-background p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">优化后提示词</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {optimizerResult?.ready
                            ? "这份优化稿可以继续手改后直接回填。"
                            : "如果待确认信息还没补齐，建议先补充再提交。"}
                        </p>
                      </div>
                    </div>
                    <ReferenceMentionTextarea
                      value={preview}
                      onChange={handlePreviewChange}
                      placeholder="点击“开始优化”后，这里会出现可编辑的优化稿。"
                      className="mt-3 min-h-[260px] resize-none bg-background"
                      referenceOptions={referenceOptions}
                    />
                  </div>
                </div>
              ) : (
                <ReferenceMentionTextarea
                  value={preview}
                  onChange={handlePreviewChange}
                  placeholder="点击“生成提示词”后，这里会出现可编辑的最终文案。"
                  className="min-h-[420px] resize-none bg-background"
                  referenceOptions={referenceOptions}
                />
              )}
            </div>

            <div className="border-t bg-background/80 px-6 py-3 text-xs text-muted-foreground">
              {currentPrompt.trim()
                ? "当前主输入框已有内容，可选择覆盖或追加回填。"
                : "当前主输入框为空，可直接回填生成结果。"}
            </div>
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="text-xs text-muted-foreground">
            关闭弹窗后会保留草稿和优化结果，下次打开可继续编辑。
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {isOptimizerMode ? (
              <Button type="button" variant="outline" onClick={() => void optimizePrompt()} disabled={optimizing}>
                {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {optimizing ? "优化中..." : hasPreview ? "重新优化" : "开始优化"}
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={generatePrompt}>
                <Sparkles className="h-4 w-4" />
                {hasPreview ? "重新生成提示词" : "生成提示词"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onApply("append", preview)}
              disabled={!hasPreview}
            >
              追加回填
            </Button>
            <Button
              type="button"
              onClick={() => onApply("replace", preview)}
              disabled={!hasPreview}
            >
              覆盖回填
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
