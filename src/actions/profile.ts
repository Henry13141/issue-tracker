"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function normalizeMime(s: string): string {
  return s.split(";")[0].trim().toLowerCase();
}

/** 生成头像直传链接；上传成功后调用 updateMyAvatarUrl(publicUrl) */
export async function createAvatarSignedUploadUrl(
  contentType: string,
  sizeBytes: number
): Promise<{ signedUrl: string; storagePath: string; publicUrl: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (sizeBytes > MAX_AVATAR_BYTES) throw new Error("头像不能超过 2 MB");

  const mime = normalizeMime(contentType);
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error("仅支持 JPG、PNG、WebP、GIF 图片");

  const storagePath = `${user.id}/${Date.now()}.${ext}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    console.error("[profile] createSignedUploadUrl:", error?.message);
    throw new Error(
      error?.message ??
        "生成上传链接失败。请在 Supabase 创建公开存储桶「avatars」并执行迁移 add_avatars_bucket.sql"
    );
  }

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
  return { signedUrl: data.signedUrl, storagePath, publicUrl: pub.publicUrl };
}

export async function updateMyAvatarUrl(publicUrl: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new Error("未配置 NEXT_PUBLIC_SUPABASE_URL");

  let parsed: URL;
  try {
    parsed = new URL(publicUrl);
  } catch {
    throw new Error("无效头像地址");
  }

  const baseHost = new URL(base).host;
  if (parsed.host !== baseHost) throw new Error("无效头像地址");

  const marker = "/storage/v1/object/public/avatars/";
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) throw new Error("无效头像地址");

  const after = publicUrl.slice(idx + marker.length);
  const firstSeg = after.split("/")[0];
  if (firstSeg !== user.id) throw new Error("无效头像地址");

  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ avatar_url: publicUrl }).eq("id", user.id);

  if (error) throw new Error(error.message);

  // 只失效工作台相关树；不要用 "/" layout，避免与根路由 / 的 redirect 逻辑叠加后触发异常 RSC 刷新
  revalidatePath("/home", "layout");
}
