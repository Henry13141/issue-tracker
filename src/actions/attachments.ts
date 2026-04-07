"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { del as blobDel } from "@vercel/blob";
import type { IssueAttachmentWithUrl } from "@/types";

const BUCKET = "issue-files";
const SUPABASE_MAX_BYTES = 50 * 1024 * 1024;   // 50 MB（Supabase Free Plan 全局上限）
const BLOB_MAX_BYTES     = 500 * 1024 * 1024;  // 500 MB（Vercel Blob 上限）
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // > 10 MB 改走 Vercel Blob

export type CreateUploadUrlResult =
  | { provider: "supabase"; signedUrl: string; storagePath: string }
  | { provider: "blob"; clientToken: string; pathname: string };

/** 生成客户端直传凭证，自动按文件大小选择存储后端 */
export async function createSignedUploadUrl(
  issueId: string,
  filename: string,
  contentType: string,
  sizeBytes: number
): Promise<CreateUploadUrlResult> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

  if (sizeBytes > LARGE_FILE_THRESHOLD) {
    // 大文件走 Vercel Blob
    if (sizeBytes > BLOB_MAX_BYTES) throw new Error("文件不能超过 500 MB");
    const pathname = `issues/${issueId}/${Date.now()}-${safeFilename}`;
    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname,
      maximumSizeInBytes: BLOB_MAX_BYTES,
      // allowedContentTypes 不传 = 默认允许所有类型（含 fbx/zip/binary 等）
      validUntil: Date.now() + 5 * 60 * 1000, // 5 分钟有效期
      addRandomSuffix: false,
    });
    return { provider: "blob", clientToken, pathname };
  }

  // 小文件走 Supabase Storage
  if (sizeBytes > SUPABASE_MAX_BYTES) throw new Error("文件不能超过 50 MB");
  const storagePath = `${issueId}/${Date.now()}-${safeFilename}`;
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "生成上传链接失败");
  }

  return { provider: "supabase", signedUrl: data.signedUrl, storagePath };
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
  if (params.sizeBytes <= 0) throw new Error("空文件不能上传");

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

  const storagePath = row.storage_path as string;

  if (storagePath.startsWith("https://")) {
    // Vercel Blob — 直接按 URL 删除
    try {
      await blobDel(storagePath);
    } catch (e) {
      console.error("[deleteAttachment] blob del:", e);
    }
  } else {
    // Supabase Storage — 用 admin client 跳过 RLS
    const admin = createAdminClient();
    const { error: storageErr } = await admin.storage
      .from(BUCKET)
      .remove([storagePath]);
    if (storageErr) console.error("[deleteAttachment] storage remove:", storageErr.message);
  }

  // 删元数据行
  const { error: dbErr } = await supabase
    .from("issue_attachments")
    .delete()
    .eq("id", attachmentId);

  if (dbErr) throw new Error(dbErr.message);

  revalidatePath(`/issues/${row.issue_id}`);
}

/** 手动调整附件归属（主任务 / 子任务） */
export async function reassignAttachmentIssue(params: {
  attachmentId: string;
  targetIssueId: string;
  parentIssueId: string;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("未登录");

  const supabase = await createClient();
  const { data: attachment, error: attachmentErr } = await supabase
    .from("issue_attachments")
    .select("id, issue_id")
    .eq("id", params.attachmentId)
    .single();

  if (attachmentErr || !attachment) throw new Error("附件不存在");

  // 目标 issue 必须是 parentIssueId 本身或其子任务
  const { data: targetIssue, error: targetErr } = await supabase
    .from("issues")
    .select("id, parent_issue_id")
    .eq("id", params.targetIssueId)
    .single();

  if (targetErr || !targetIssue) throw new Error("目标任务不存在");
  const targetBelongsToParent =
    targetIssue.id === params.parentIssueId ||
    targetIssue.parent_issue_id === params.parentIssueId;
  if (!targetBelongsToParent) throw new Error("目标任务不属于当前父任务");

  // 权限：管理员，或父任务创建者/负责人
  const { data: parentIssue, error: parentErr } = await supabase
    .from("issues")
    .select("id, creator_id, assignee_id")
    .eq("id", params.parentIssueId)
    .single();
  if (parentErr || !parentIssue) throw new Error("父任务不存在");

  const isAdmin = user.role === "admin";
  const canEdit =
    isAdmin ||
    user.id === (parentIssue.creator_id as string | null) ||
    user.id === (parentIssue.assignee_id as string | null);
  if (!canEdit) throw new Error("无权限修改附件归属");

  if (attachment.issue_id === params.targetIssueId) return;

  const { error: updateErr } = await supabase
    .from("issue_attachments")
    .update({ issue_id: params.targetIssueId })
    .eq("id", params.attachmentId);

  if (updateErr) throw new Error(updateErr.message);

  revalidatePath(`/issues/${params.parentIssueId}`);
  if (params.targetIssueId !== params.parentIssueId) {
    revalidatePath(`/issues/${params.targetIssueId}`);
  }
}

/** 批量为附件列表生成 signed URL（Blob 附件直接用其 URL） */
export async function enrichAttachmentsWithUrls(
  attachments: Omit<IssueAttachmentWithUrl, "url">[]
): Promise<IssueAttachmentWithUrl[]> {
  if (!attachments.length) return [];

  // 分开 Blob 附件（storage_path 是完整 URL）和 Supabase 附件
  const blobAttachments = attachments.filter((a) => a.storage_path.startsWith("https://"));
  const supabaseAttachments = attachments.filter((a) => !a.storage_path.startsWith("https://"));

  const result: IssueAttachmentWithUrl[] = blobAttachments.map((a) => ({
    ...a,
    url: a.storage_path, // Vercel Blob 公开 URL 直接可用
  }));

  if (supabaseAttachments.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(supabaseAttachments.map((a) => a.storage_path), 3600);

    if (error || !data) {
      throw new Error(error?.message ?? "批量生成下载链接失败");
    }

    const signedUrlMap = new Map(data.map((row) => [row.path ?? "", row.signedUrl ?? undefined]));
    for (const a of supabaseAttachments) {
      result.push({ ...a, url: signedUrlMap.get(a.storage_path) });
    }
  }

  // 保持原顺序
  const orderMap = new Map(attachments.map((a, i) => [a.id, i]));
  return result.sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
}
