import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const BUCKET = "seedance-assets";
const MAX_SIZE_BYTES = 500 * 1024 * 1024;

const MIME_ALLOWLIST = {
  image: ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/webm"],
} as const;
const ALL_ALLOWED_MIMES = Array.from(new Set(Object.values(MIME_ALLOWLIST).flat()));

type SeedanceAssetKind = keyof typeof MIME_ALLOWLIST;

function isSeedanceAssetKind(value: unknown): value is SeedanceAssetKind {
  return value === "image" || value === "video" || value === "audio";
}

function normalizeMime(value: string) {
  return value.split(";")[0].trim().toLowerCase();
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file.bin";
}

async function ensureBucket() {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.listBuckets();
  if (error) throw new Error(error.message);

  const exists = (data ?? []).some((bucket) => bucket.id === BUCKET);
  if (!exists) {
    const { error: createError } = await admin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_SIZE_BYTES,
      allowedMimeTypes: ALL_ALLOWED_MIMES,
    });
    if (createError && !createError.message.toLowerCase().includes("already exists")) {
      throw new Error(createError.message);
    }
  }

  return admin;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法上传本地素材。" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const payload = body as {
    kind?: unknown;
    filename?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
  };

  if (!isSeedanceAssetKind(payload.kind)) {
    return NextResponse.json({ error: "无效的素材类型。" }, { status: 400 });
  }

  const filename = typeof payload.filename === "string" ? payload.filename.trim() : "";
  const contentType = typeof payload.contentType === "string" ? payload.contentType.trim() : "";
  const sizeBytes = typeof payload.sizeBytes === "number" ? payload.sizeBytes : Number(payload.sizeBytes);

  if (!filename) {
    return NextResponse.json({ error: "缺少文件名。" }, { status: 400 });
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "空文件不能上传。" }, { status: 400 });
  }

  if (sizeBytes > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "文件不能超过 500 MB。" }, { status: 400 });
  }

  const mime = normalizeMime(contentType || "application/octet-stream");
  if (!MIME_ALLOWLIST[payload.kind].includes(mime as never)) {
    return NextResponse.json(
      { error: `仅支持上传${payload.kind === "image" ? "图片" : payload.kind === "video" ? "视频" : "音频"}文件。` },
      { status: 400 }
    );
  }

  try {
    const admin = await ensureBucket();
    const storagePath = `${user.id}/${payload.kind}/${Date.now()}-${sanitizeFilename(filename)}`;
    const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "生成上传链接失败");
    }

    const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
    return NextResponse.json({
      signedUrl: data.signedUrl,
      url: publicData.publicUrl,
      filename,
      storagePath,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 500 }
    );
  }
}
