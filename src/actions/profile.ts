"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // 用 service role 生成签名 URL，避免 Storage RLS 在 createSignedUploadUrl 阶段报
  // 「new row violates row-level security policy」（路径已由服务端限定为当前用户 id）
  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    throw new Error(
      e instanceof Error
        ? `头像上传初始化失败：${e.message}。请在部署环境配置正确的 SUPABASE_SERVICE_ROLE_KEY（service_role）并重新部署。`
        : "服务端未配置 SUPABASE_SERVICE_ROLE_KEY，无法生成头像上传链接。请在部署环境（如 Vercel）添加该密钥。",
    );
  }

  const { data, error } = await admin.storage.from(AVATAR_BUCKET).createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    console.error("[profile] createSignedUploadUrl:", error?.message);
    if (error?.message?.includes("row-level security")) {
      throw new Error(
        "头像上传权限校验失败（Storage RLS）。请确认部署环境中的 SUPABASE_SERVICE_ROLE_KEY 为 service_role，并确保 avatars 桶策略已生效后重新部署。",
      );
    }
    throw new Error(
      error?.message ??
        "生成上传链接失败。请在 Supabase 创建公开存储桶「avatars」并执行迁移 add_avatars_bucket.sql",
    );
  }

  const { data: pub } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(storagePath);
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
