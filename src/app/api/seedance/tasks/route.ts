import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/auth";
import {
  createSeedanceTask,
  listSeedanceTasks,
  toArkErrorResponse,
  type SeedanceContentItem,
  type SeedanceCreateTaskInput,
  type SeedanceTool,
} from "@/lib/ark-seedance";
import {
  canUseSeedanceWebSearch,
  isAllowedSeedanceModelId,
  isAllowedSeedanceRatio,
  isAllowedSeedanceResolution,
  isValidSeedance20DurationValue,
  validateSeedanceReferenceCounts,
} from "@/lib/seedance-params";

export const dynamic = "force-dynamic";

function isValidHttpUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function isValidAssetUrl(url: string) {
  return /^asset:\/\/\S+$/i.test(url);
}

function isValidBase64DataUrl(url: string, kind: "image" | "video" | "audio") {
  return new RegExp(`^data:${kind}/[a-z0-9.+-]+;base64,`, "i").test(url);
}

function isValidMediaUrl(url: unknown, kind: "image" | "video" | "audio"): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return isValidHttpUrl(trimmed) || isValidAssetUrl(trimmed) || isValidBase64DataUrl(trimmed, kind);
}

function isValidSeedanceTool(tool: unknown): tool is SeedanceTool {
  if (!tool || typeof tool !== "object") return false;
  return (tool as { type?: unknown }).type === "web_search";
}

function countReferenceItems(content: SeedanceContentItem[]) {
  return content.reduce(
    (counts, item) => {
      if (item.type === "image_url") counts.images += 1;
      if (item.type === "video_url") counts.videos += 1;
      if (item.type === "audio_url") counts.audios += 1;
      return counts;
    },
    { images: 0, videos: 0, audios: 0 }
  );
}

function validateContentCombination(content: SeedanceContentItem[]): string | null {
  const imageItems = content.filter((item) => item.type === "image_url");
  const videoItems = content.filter((item) => item.type === "video_url");
  const audioItems = content.filter((item) => item.type === "audio_url");
  const hasLastFrame = imageItems.some((item) => item.role === "last_frame");
  const hasFirstFrame = imageItems.some((item) => item.role === "first_frame") || (imageItems.length === 1 && !imageItems[0]?.role);
  const hasReferenceImages = imageItems.some((item) => item.role === "reference_image");
  const usesFrameMode = hasFirstFrame || hasLastFrame;
  const usesReferenceMode = hasReferenceImages || videoItems.length > 0 || audioItems.length > 0;

  if (usesFrameMode && usesReferenceMode) {
    return "首帧/首尾帧场景与多模态参考场景互斥，不能混用参考图、参考视频或参考音频。";
  }
  if (hasLastFrame) {
    if (!imageItems.some((item) => item.role === "first_frame")) {
      return "配置尾帧时，必须同时提供首帧图片。";
    }
    if (imageItems.length !== 2) {
      return "首尾帧场景下需要且仅需要 2 张图片，分别作为 first_frame 和 last_frame。";
    }
  }
  if (hasFirstFrame && !hasLastFrame && imageItems.length > 1 && !hasReferenceImages) {
    return "首帧场景最多只支持 1 张图片。";
  }
  return null;
}

function isValidContentItem(item: unknown): item is SeedanceContentItem {
  if (!item || typeof item !== "object") return false;

  const value = item as Record<string, unknown>;
  if (value.type === "text") {
    return typeof value.text === "string" && value.text.trim().length > 0;
  }

  if (value.type === "image_url") {
    const role = value.role;
    return (
      (role === undefined || role === "reference_image" || role === "first_frame" || role === "last_frame") &&
      isValidMediaUrl((value.image_url as { url?: unknown } | undefined)?.url, "image")
    );
  }

  if (value.type === "video_url") {
    return (
      value.role === "reference_video" &&
      isValidMediaUrl((value.video_url as { url?: unknown } | undefined)?.url, "video")
    );
  }

  if (value.type === "audio_url") {
    return (
      value.role === "reference_audio" &&
      isValidMediaUrl((value.audio_url as { url?: unknown } | undefined)?.url, "audio")
    );
  }

  return false;
}

function parsePayload(body: unknown): SeedanceCreateTaskInput | null {
  if (!body || typeof body !== "object") return null;

  const value = body as Record<string, unknown>;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const ratio = typeof value.ratio === "string" ? value.ratio.trim() : "";
  const rawResolution = typeof value.resolution === "string" ? value.resolution.trim() : "";
  const resolution = isAllowedSeedanceResolution(rawResolution) ? rawResolution : "";
  const duration = typeof value.duration === "number" ? value.duration : Number(value.duration);
  const content = Array.isArray(value.content) ? value.content.filter(isValidContentItem) : [];
  const tools = Array.isArray(value.tools) ? value.tools.filter(isValidSeedanceTool) : [];
  const referenceCounts = countReferenceItems(content);
  const contentCombinationError = validateContentCombination(content);

  if (!model || !isAllowedSeedanceModelId(model) || !ratio || !isAllowedSeedanceRatio(ratio)) {
    return null;
  }
  if (rawResolution && !resolution) {
    return null;
  }
  if (!Number.isFinite(duration) || !isValidSeedance20DurationValue(duration)) {
    return null;
  }
  if (content.length === 0) {
    return null;
  }
  if (contentCombinationError) {
    return null;
  }
  if (Array.isArray(value.tools) && tools.length !== value.tools.length) {
    return null;
  }
  if (validateSeedanceReferenceCounts(referenceCounts)) {
    return null;
  }
  if (tools.length > 0 && !canUseSeedanceWebSearch(referenceCounts)) {
    return null;
  }

  return {
    model,
    ratio,
    duration,
    content,
    generate_audio: Boolean(value.generate_audio),
    watermark: Boolean(value.watermark),
    ...(resolution ? { resolution } : {}),
    ...(typeof value.return_last_frame === "boolean"
      ? { return_last_frame: value.return_last_frame }
      : {}),
    ...(typeof value.safety_identifier === "string" && value.safety_identifier.trim()
      ? { safety_identifier: value.safety_identifier.trim().slice(0, 64) }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
  };
}

function describePayloadError(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "请求体不是合法 JSON。";
  }
  const value = body as Record<string, unknown>;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const ratio = typeof value.ratio === "string" ? value.ratio.trim() : "";
  const rawResolution = typeof value.resolution === "string" ? value.resolution.trim() : "";
  const resolution = isAllowedSeedanceResolution(rawResolution) ? rawResolution : "";
  const duration = typeof value.duration === "number" ? value.duration : Number(value.duration);
  const content = Array.isArray(value.content) ? value.content.filter(isValidContentItem) : [];
  const tools = Array.isArray(value.tools) ? value.tools.filter(isValidSeedanceTool) : [];
  const referenceCounts = countReferenceItems(content);
  const referenceError = validateSeedanceReferenceCounts(referenceCounts);
  const contentCombinationError = validateContentCombination(content);

  if (!model) {
    return "缺少 model。";
  }
  if (!isAllowedSeedanceModelId(model)) {
    return "当前仅支持 doubao-seedance-2-0-260128 与 doubao-seedance-2-0-fast-260128。";
  }
  if (!ratio) {
    return "缺少 ratio。";
  }
  if (!isAllowedSeedanceRatio(ratio)) {
    return "ratio 不在允许列表（16:9 / 9:16 / 1:1 / 3:4 / 4:3 / 21:9 / adaptive）。";
  }
  if (rawResolution && !resolution) {
    return "resolution 仅支持 480p / 720p。";
  }
  if (!Number.isFinite(duration)) {
    return "duration 必须是整数秒，或 -1（智能时长）。";
  }
  if (!isValidSeedance20DurationValue(duration)) {
    return "duration 需为 4～15 秒的整数，或 -1（智能时长），与 Seedance 2.0 官方教程约定一致；若接口升级请以返回错误为准。";
  }
  if (content.length === 0) {
    return "content 至少包含一条有效内容。可为纯文本，也可为图片/视频/音频参考组合。";
  }
  if (contentCombinationError) {
    return contentCombinationError;
  }
  if (referenceError) {
    return referenceError;
  }
  if (Array.isArray(value.tools) && tools.length !== value.tools.length) {
    return "当前 tools 仅支持 [{\"type\":\"web_search\"}]。";
  }
  if (tools.length > 0 && !canUseSeedanceWebSearch(referenceCounts)) {
    return "联网搜索仅适用于纯文本输入；启用时不能同时传图片、视频或音频参考。";
  }
  return "请求参数不完整或格式不正确。";
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法调用 Seedance 体验功能。" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const payload = parsePayload(body);
  if (!payload) {
    return NextResponse.json({ error: describePayloadError(body) }, { status: 400 });
  }

  if (!payload.safety_identifier) {
    payload.safety_identifier = createHash("sha256").update(user.id).digest("hex").slice(0, 64);
  }

  try {
    const task = await createSeedanceTask(payload);
    return NextResponse.json({ task });
  } catch (error) {
    const response = toArkErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法查询 Seedance 历史任务。" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const pageNum = Number(searchParams.get("pageNum") ?? "1");
  const pageSize = Number(searchParams.get("pageSize") ?? "12");

  try {
    const result = await listSeedanceTasks({
      pageNum: Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1,
      pageSize: Number.isFinite(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : 12,
    });
    return NextResponse.json(result);
  } catch (error) {
    const response = toArkErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
