import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
type UploadRequestItem = {
  filename: string;
  contentType: string;
  sizeBytes: number;
};

let bucketReadyPromise: Promise<void> | null = null;

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
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
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
    })().catch((error) => {
      bucketReadyPromise = null;
      throw error;
    });
  }

  await bucketReadyPromise;
  return createAdminClient();
}

function normalizeUploadRequestItems(body: unknown): { kind: SeedanceAssetKind | null; items: UploadRequestItem[] } {
  if (!body || typeof body !== "object") {
    return { kind: null, items: [] };
  }

  const payload = body as {
    kind?: unknown;
    filename?: unknown;
    contentType?: unknown;
    sizeBytes?: unknown;
    files?: unknown;
  };

  const kind = isSeedanceAssetKind(payload.kind) ? payload.kind : null;
  if (!kind) {
    return { kind: null, items: [] };
  }

  const files = Array.isArray(payload.files) ? payload.files : null;
  if (files) {
    const items = files
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const value = item as Record<string, unknown>;
        const filename = typeof value.filename === "string" ? value.filename.trim() : "";
        const contentType = typeof value.contentType === "string" ? value.contentType.trim() : "";
        const sizeBytes = typeof value.sizeBytes === "number" ? value.sizeBytes : Number(value.sizeBytes);
        return { filename, contentType, sizeBytes };
      })
      .filter((item): item is UploadRequestItem => Boolean(item));
    return { kind, items };
  }

  const filename = typeof payload.filename === "string" ? payload.filename.trim() : "";
  const contentType = typeof payload.contentType === "string" ? payload.contentType.trim() : "";
  const sizeBytes = typeof payload.sizeBytes === "number" ? payload.sizeBytes : Number(payload.sizeBytes);
  return { kind, items: [{ filename, contentType, sizeBytes }] };
}

function validateUploadItem(kind: SeedanceAssetKind, item: UploadRequestItem) {
  if (!item.filename) {
    return "缺少文件名。";
  }

  if (!Number.isFinite(item.sizeBytes) || item.sizeBytes <= 0) {
    return "空文件不能上传。";
  }

  if (item.sizeBytes > MAX_SIZE_BYTES) {
    return "文件不能超过 500 MB。";
  }

  const mime = normalizeMime(item.contentType || "application/octet-stream");
  if (!MIME_ALLOWLIST[kind].includes(mime as never)) {
    return `仅支持上传${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}文件。`;
  }

  return null;
}

export async function POST(request: Request) {
  let userId: string;
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "未登录，无法上传本地素材。" }, { status: 401 });
    }
    userId = user.id;
  } catch {
    return NextResponse.json({ error: "鉴权失败，请刷新页面后重试。" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const { kind, items } = normalizeUploadRequestItems(body);

  if (!kind) {
    return NextResponse.json({ error: "无效的素材类型。" }, { status: 400 });
  }

  if (items.length === 0) {
    return NextResponse.json({ error: "缺少待上传文件。" }, { status: 400 });
  }

  const invalid = items.find((item) => validateUploadItem(kind, item));
  if (invalid) {
    return NextResponse.json({ error: validateUploadItem(kind, invalid) }, { status: 400 });
  }

  try {
    const admin = await ensureBucket();
    const itemsWithSignedUrls = await Promise.all(
      items.map(async (item, index) => {
        const storagePath = `${userId}/${kind}/${Date.now()}-${index}-${sanitizeFilename(item.filename)}`;
        const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(storagePath);
        if (error || !data?.signedUrl) {
          throw new Error(error?.message ?? "生成上传链接失败");
        }

        const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
        return {
          signedUrl: data.signedUrl,
          url: publicData.publicUrl,
          filename: item.filename,
          storagePath,
        };
      })
    );

    return NextResponse.json({ items: itemsWithSignedUrls });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 500 }
    );
  }
}
