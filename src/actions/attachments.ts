"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { IssueAttachmentWithUrl } from "@/types";

const BUCKET = "issue-files";
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

/** 生成客户端直传用的 signed upload URL（有效期 60 秒） */
export async function createSignedUploadUrl(
  issueId: string,
  filename: string,
  contentType: string,
  sizeBytes: number
): Promise<{ signedUrl: string; storagePath: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");
  if (sizeBytes > MAX_SIZE_BYTES) throw new Error("文件不能超过 20 MB");

  const ext = filename.split(".").pop() ?? "bin";
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const storagePath = `${issueId}/${Date.now()}-${safeFilename}`;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "生成上传链接失败");
  }

  void ext;
  return { signedUrl: data.signedUrl, storagePath };
}

/** 上传完成后写元数据到 issue_attachments */
export async function saveAttachmentMeta(params: {
  issueId: string;
  issueUpdateId?: string | null;
  storagePath: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issue_attachments")
    .insert({
      issue_id: params.issueId,
      issue_update_id: params.issueUpdateId ?? null,
      storage_path: params.storagePath,
      filename: params.filename,
      content_type: params.contentType,
      size_bytes: params.sizeBytes,
      uploaded_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "保存附件信息失败");

  revalidatePath(`/issues/${params.issueId}`);
  return data.id as string;
}

/** 生成附件下载用的 signed URL（有效期 60 分钟） */
export async function getAttachmentSignedUrl(storagePath: string): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) throw new Error(error?.message ?? "生成下载链接失败");
  return data.signedUrl;
}

/** 删除附件（同时删 Storage 对象和元数据行） */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data: row, error: fetchErr } = await supabase
    .from("issue_attachments")
    .select("storage_path, uploaded_by, issue_id")
    .eq("id", attachmentId)
    .single();

  if (fetchErr || !row) throw new Error("附件不存在");

  const isOwner = (row.uploaded_by as string) === user.id;
  const isAdmin = user.role === "admin";
  if (!isOwner && !isAdmin) throw new Error("无权限删除此附件");

  // 删 Storage 对象（用 admin client 跳过 Storage RLS 限制）
  const admin = createAdminClient();
  const { error: storageErr } = await admin.storage
    .from(BUCKET)
    .remove([row.storage_path as string]);

  if (storageErr) console.error("[deleteAttachment] storage remove:", storageErr.message);

  // 删元数据行
  const { error: dbErr } = await supabase
    .from("issue_attachments")
    .delete()
    .eq("id", attachmentId);

  if (dbErr) throw new Error(dbErr.message);

  revalidatePath(`/issues/${row.issue_id}`);
}

/** 批量为附件列表生成 signed URL */
export async function enrichAttachmentsWithUrls(
  attachments: Omit<IssueAttachmentWithUrl, "url">[]
): Promise<IssueAttachmentWithUrl[]> {
  if (!attachments.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(attachments.map((a) => a.storage_path), 3600);

  if (error || !data) {
    throw new Error(error?.message ?? "批量生成下载链接失败");
  }

  const signedUrlMap = new Map(data.map((row) => [row.path ?? "", row.signedUrl ?? undefined]));
  return attachments.map((a) => ({
    ...a,
    url: signedUrlMap.get(a.storage_path),
  }));
}
