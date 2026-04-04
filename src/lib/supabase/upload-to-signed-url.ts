"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * 直传 Storage 时附带当前会话 JWT。
 * 仅使用 signed URL 的 PUT 时，RLS 里 auth.uid() 可能为空，导致
 * 「new row violates row-level security policy」。
 */
export async function uploadToSignedUrl(
  signedUrl: string,
  body: Blob,
  contentType: string
): Promise<Response> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": contentType || "application/octet-stream",
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  return fetch(signedUrl, { method: "PUT", body, headers });
}
