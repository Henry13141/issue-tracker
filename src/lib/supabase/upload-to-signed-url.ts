import { createClient } from "@/lib/supabase/client";

type UploadToSignedUrlParams = {
  bucket: string;
  storagePath: string;
  signedUrl: string;
  fileBody: Blob;
  contentType: string;
  options?: {
    upsert?: boolean;
    cacheControl?: string;
  };
};

type UploadToSignedUrlResult =
  | { ok: true; status: 200 }
  | { ok: false; status: number; message: string };

/**
 * 通过 Supabase 官方 browser client 调用 uploadToSignedUrl。
 *
 * 之前直接 fetch signedUrl，在不同桶/浏览器环境下会因请求格式或缺少 SDK 默认头部而返回 400。
 * 这里统一走官方 SDK，避免我们手工拼装 multipart、token 和 headers。
 */
export async function uploadToSignedUrl({
  bucket,
  storagePath,
  signedUrl,
  fileBody,
  contentType,
  options,
}: UploadToSignedUrlParams): Promise<UploadToSignedUrlResult> {
  let token = "";
  try {
    token = new URL(signedUrl).searchParams.get("token") ?? "";
  } catch {
    return { ok: false, status: 400, message: "上传地址无效" };
  }

  if (!token) {
    return { ok: false, status: 400, message: "上传凭证缺失" };
  }

  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(
    storagePath,
    token,
    fileBody,
    {
      cacheControl: options?.cacheControl ?? "3600",
      contentType,
      upsert: options?.upsert ?? false,
    }
  );

  if (error) {
    return {
      ok: false,
      status: typeof error.status === "number" ? error.status : 400,
      message: error.message || "上传失败",
    };
  }

  return { ok: true, status: 200 };
}
