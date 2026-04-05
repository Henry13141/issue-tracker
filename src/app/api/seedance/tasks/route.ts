import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  createSeedanceTask,
  listSeedanceTasks,
  toArkErrorResponse,
  type SeedanceContentItem,
  type SeedanceCreateTaskInput,
} from "@/lib/ark-seedance";

export const dynamic = "force-dynamic";

function isValidReferenceUrl(url: unknown): url is string {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim());
}

function isValidContentItem(item: unknown): item is SeedanceContentItem {
  if (!item || typeof item !== "object") return false;

  const value = item as Record<string, unknown>;
  if (value.type === "text") {
    return typeof value.text === "string" && value.text.trim().length > 0;
  }

  if (value.type === "image_url") {
    return value.role === "reference_image" && isValidReferenceUrl((value.image_url as { url?: unknown } | undefined)?.url);
  }

  if (value.type === "video_url") {
    return value.role === "reference_video" && isValidReferenceUrl((value.video_url as { url?: unknown } | undefined)?.url);
  }

  if (value.type === "audio_url") {
    return value.role === "reference_audio" && isValidReferenceUrl((value.audio_url as { url?: unknown } | undefined)?.url);
  }

  return false;
}

function parsePayload(body: unknown): SeedanceCreateTaskInput | null {
  if (!body || typeof body !== "object") return null;

  const value = body as Record<string, unknown>;
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const ratio = typeof value.ratio === "string" ? value.ratio.trim() : "";
  const duration = typeof value.duration === "number" ? value.duration : Number(value.duration);
  const content = Array.isArray(value.content) ? value.content.filter(isValidContentItem) : [];

  if (!model || !ratio || !Number.isFinite(duration) || duration < 1 || content.length === 0) {
    return null;
  }

  return {
    model,
    ratio,
    duration,
    content,
    generate_audio: Boolean(value.generate_audio),
    watermark: Boolean(value.watermark),
  };
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
    return NextResponse.json({ error: "请求参数不完整或格式不正确。" }, { status: 400 });
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
