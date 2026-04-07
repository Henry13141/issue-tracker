/**
 * 上传到 Supabase Storage 的 signed upload URL。
 *
 * 必须与 @supabase/storage-js 的 `StorageFileApi.uploadToSignedUrl` 对齐：
 * 对 Blob/File 使用 multipart FormData（cacheControl + 空字段名挂载文件），并带 `x-upsert`。
 * 使用裸 PUT 且自行设置 `Content-Type: application/octet-stream` 时，与 Storage 期望的
 * multipart 格式不一致，接口常返回 400。
 *
 * Signed URL 已含鉴权 token，无需也不应加 Authorization（避免不必要的 CORS preflight）。
 */
export async function uploadToSignedUrl(
  signedUrl: string,
  fileBody: Blob,
  _contentType: string,
  options?: { upsert?: boolean; cacheControl?: string }
): Promise<Response> {
  const cacheControl = options?.cacheControl ?? "3600";
  const upsert = options?.upsert ?? false;

  const form = new FormData();
  form.append("cacheControl", cacheControl);
  form.append("", fileBody);

  return fetch(signedUrl, {
    method: "PUT",
    body: form,
    headers: {
      "x-upsert": String(upsert),
    },
  });
}
