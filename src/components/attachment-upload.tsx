"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { Paperclip, X, FileText, Loader2, FileVideo, ExternalLink, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createSignedUploadUrl, saveAttachmentMeta } from "@/actions/attachments";
import { uploadToSignedUrl } from "@/lib/supabase/upload-to-signed-url";
import { put as blobPut } from "@vercel/blob/client";
import type { IssueAttachmentWithUrl } from "@/types";
import { cn } from "@/lib/utils";

const MAX_MB = 500; // Vercel Blob 最大 500 MB，Supabase 小文件走 50 MB

interface Props {
  issueId: string;
  issueUpdateId?: string | null;
  onUploaded?: (attachment: IssueAttachmentWithUrl) => void;
  className?: string;
  disabled?: boolean;
  /** 上传前对文件重命名，返回新 File 对象 */
  filenameTransform?: (file: File) => File;
  label?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} 千字节`;
  return `${(bytes / 1024 / 1024).toFixed(1)} 兆字节`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function isVideoType(contentType: string): boolean {
  return contentType.startsWith("video/");
}

export function AttachmentUploadButton({
  issueId,
  issueUpdateId,
  onUploaded,
  className,
  disabled,
  filenameTransform,
  label,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);

    for (const rawFile of Array.from(files)) {
      const file = filenameTransform ? filenameTransform(rawFile) : rawFile;
      if (file.size <= 0) {
        setError(`${file.name} 是空文件，请重新打包或确认文件已下载完整后再上传`);
        continue;
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setError(`${file.name} 超过 ${MAX_MB} MB 限制`);
        continue;
      }
      try {
        const uploadInfo = await createSignedUploadUrl(
          issueId,
          file.name,
          file.type || "application/octet-stream",
          file.size
        );

        let finalStoragePath: string;

        if (uploadInfo.provider === "blob") {
          // 大文件走 Vercel Blob（支持多达 500MB，自动分片）
          const blob = await blobPut(uploadInfo.pathname, file, {
            access: "public",
            token: uploadInfo.clientToken,
            contentType: file.type || "application/octet-stream",
            multipart: true,
          });
          finalStoragePath = blob.url; // 以完整 HTTPS URL 存入 storage_path
        } else {
          // 小文件走 Supabase Storage
          const uploadRes = await uploadToSignedUrl({
            bucket: "issue-files",
            storagePath: uploadInfo.storagePath,
            signedUrl: uploadInfo.signedUrl,
            fileBody: file,
            contentType: file.type || "application/octet-stream",
          });
          if (!uploadRes.ok) throw new Error(`上传失败 (${uploadRes.status})：${uploadRes.message}`);
          finalStoragePath = uploadInfo.storagePath;
        }

        const attachmentId = await saveAttachmentMeta({
          issueId,
          issueUpdateId: issueUpdateId ?? null,
          storagePath: finalStoragePath,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });

        onUploaded?.({
          id: attachmentId,
          issue_id: issueId,
          issue_update_id: issueUpdateId ?? null,
          storage_path: finalStoragePath,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_by: "",
          created_at: new Date().toISOString(),
          url: finalStoragePath.startsWith("https://")
            ? finalStoragePath
            : URL.createObjectURL(file),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
      }
    }

    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={disabled || uploading}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 text-xs text-muted-foreground"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Paperclip className="h-3.5 w-3.5" />
        )}
        {uploading ? "上传中…" : (label ?? "添加附件")}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface ListProps {
  attachments: IssueAttachmentWithUrl[];
  onDelete?: (id: string) => void;
  canDelete?: boolean;
  variant?: "grid" | "list";
  ownershipOptions?: { issueId: string; label: string }[];
  onReassign?: (attachmentId: string, targetIssueId: string) => Promise<void> | void;
}

export function AttachmentList({
  attachments,
  onDelete,
  canDelete,
  variant = "grid",
  ownershipOptions,
  onReassign,
}: ListProps) {
  const [selected, setSelected] = useState<IssueAttachmentWithUrl | null>(null);

  const sortedAttachments = useMemo(() => {
    return [...attachments].sort((a, b) => {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return tb - ta;
    });
  }, [attachments]);

  if (!attachments.length) return null;

  return (
    <>
      {variant === "list" ? (
        <div className="space-y-2">
          {sortedAttachments.map((a, index) => (
            <AttachmentRow
              key={a.id}
              attachment={a}
              isLatest={index === 0}
              onDelete={onDelete}
              canDelete={canDelete}
              ownershipOptions={ownershipOptions}
              onReassign={onReassign}
              onPreview={() => setSelected(a)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sortedAttachments.map((a) => (
            <AttachmentItem
              key={a.id}
              attachment={a}
              onDelete={onDelete}
              canDelete={canDelete}
              onPreview={() => setSelected(a)}
            />
          ))}
        </div>
      )}

      {/* 预览弹窗 */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-[90vw] w-[90vw] gap-0 p-0 overflow-hidden bg-black/90">
          <DialogTitle className="sr-only">
            {selected?.filename ?? "附件预览"}
          </DialogTitle>

          {selected?.content_type && isImageType(selected.content_type) ? (
            <div className="flex items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.url}
                alt={selected.filename}
                className="max-h-[90vh] max-w-full object-contain"
              />
            </div>
          ) : selected?.content_type && isVideoType(selected.content_type) ? (
            <div className="flex items-center justify-center p-2">
              <video
                src={selected.url}
                controls
                autoPlay
                className="max-h-[90vh] max-w-full"
              />
            </div>
          ) : selected ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 p-6 text-white/75">
              <FileText className="h-12 w-12 text-white/45" />
              <p className="max-w-md text-center text-sm">
                此类型暂不支持在线预览，请使用下方按钮下载或在新标签页打开。
              </p>
            </div>
          ) : null}

          {selected && (
            <div className="flex items-center justify-between border-t border-white/10 px-4 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm text-white/70">{selected.filename}</span>
                <a
                  href={`/api/attachments/${selected.id}/download`}
                  className="shrink-0 text-white/40 hover:text-white/70"
                  title="下载文件"
                >
                  <Download className="h-4 w-4" />
                </a>
                <a
                  href={selected.url ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-white/40 hover:text-white/70"
                  title="在新标签页打开"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <div className="flex gap-2 text-xs text-white/50">
                {sortedAttachments.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a)}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded",
                      a.id === selected.id
                        ? "bg-white/20 text-white"
                        : "text-white/40 hover:text-white/70"
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AttachmentRow({
  attachment: a,
  isLatest,
  onDelete,
  canDelete,
  ownershipOptions,
  onReassign,
  onPreview,
}: {
  attachment: IssueAttachmentWithUrl;
  isLatest?: boolean;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
  ownershipOptions?: { issueId: string; label: string }[];
  onReassign?: (attachmentId: string, targetIssueId: string) => Promise<void> | void;
  onPreview?: () => void;
}) {
  const isImage = isImageType(a.content_type);
  const isVideo = isVideoType(a.content_type);
  const [reassigning, setReassigning] = useState(false);
  const canReassign = !!ownershipOptions && ownershipOptions.length > 1 && !!onReassign;
  const ownershipLabel =
    ownershipOptions?.find((o) => o.issueId === a.issue_id)?.label ?? "选择归属任务";

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
      {onPreview ? (
        <button
          type="button"
          onClick={onPreview}
          className="shrink-0 cursor-zoom-in overflow-hidden rounded-md border bg-muted/30 hover:bg-muted/60"
          title="预览附件"
        >
          {isImage && a.url ? (
            <Image
              src={a.url}
              alt={a.filename}
              width={44}
              height={44}
              className="h-11 w-11 bg-muted/20 object-contain p-0.5"
            />
          ) : isVideo ? (
            <span className="flex h-11 w-11 items-center justify-center bg-black/60">
              <FileVideo className="h-4 w-4 text-white/80" />
            </span>
          ) : (
            <span className="flex h-11 w-11 items-center justify-center">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
        </button>
      ) : (
        <a
          href={a.url ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 overflow-hidden rounded-md border bg-muted/30"
          title="打开附件"
        >
          {isImage && a.url ? (
            <Image
              src={a.url}
              alt={a.filename}
              width={44}
              height={44}
              className="h-11 w-11 bg-muted/20 object-contain p-0.5"
            />
          ) : isVideo ? (
            <span className="flex h-11 w-11 items-center justify-center bg-black/60">
              <FileVideo className="h-4 w-4 text-white/80" />
            </span>
          ) : (
            <span className="flex h-11 w-11 items-center justify-center">
              <FileText className="h-4 w-4 text-muted-foreground" />
            </span>
          )}
        </a>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isVideo ? (
            <FileVideo className="h-4 w-4 text-muted-foreground" />
          ) : (
            <FileText className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">{a.filename}</span>
          {a.source_subtask_index ? (
            <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px]">
              子任务{a.source_subtask_index}
            </Badge>
          ) : null}
          {isLatest && (
            <Badge className="h-5 rounded-full px-2 text-[10px]">最新添加</Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(a.created_at)} · {formatBytes(a.size_bytes)}
        </div>
        {canReassign && (
          <div className="mt-1">
            <Select
              value={a.issue_id}
              disabled={reassigning}
              onValueChange={async (nextIssueId) => {
                if (!onReassign || nextIssueId == null || nextIssueId === "") return;
                if (nextIssueId === a.issue_id) return;
                setReassigning(true);
                try {
                  await onReassign(a.id, nextIssueId);
                } finally {
                  setReassigning(false);
                }
              }}
            >
              <SelectTrigger className="h-auto min-h-7 w-full max-w-[min(100%,20rem)] justify-start gap-2 py-1.5 text-xs [&>svg]:shrink-0">
                <span className="line-clamp-2 flex-1 text-left whitespace-normal" title={ownershipLabel}>
                  {ownershipLabel}
                </span>
              </SelectTrigger>
              <SelectContent>
                {ownershipOptions.map((opt) => (
                  <SelectItem key={opt.issueId} value={opt.issueId} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onPreview && (isImage || isVideo) ? (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onPreview} title="预览">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <a
            href={a.url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            title="打开"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <a
          href={`/api/attachments/${a.id}/download`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          title="下载"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        {canDelete && onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={() => onDelete(a.id)}
            title="删除"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function formatDateTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function AttachmentItem({
  attachment: a,
  onDelete,
  canDelete,
  onPreview,
}: {
  attachment: IssueAttachmentWithUrl;
  onDelete?: (id: string) => void;
  canDelete?: boolean;
  onPreview?: () => void;
}) {
  const isImage = isImageType(a.content_type);
  const isVideo = isVideoType(a.content_type);

  const inner = (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border bg-muted/30 transition-colors hover:bg-muted/60",
        isImage ? "h-20 w-20 overflow-hidden" : "h-14 w-28 gap-2 px-2"
      )}
    >
      {isImage && a.url ? (
        <Image
          src={a.url}
          alt={a.filename}
          width={80}
          height={80}
          className="h-full w-full bg-muted/20 object-contain p-1"
        />
      ) : isVideo ? (
        <span className="flex h-full w-full items-center justify-center bg-black/60">
          <FileVideo className="h-5 w-5 text-white/80" />
        </span>
      ) : (
        <>
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate text-xs text-muted-foreground">{a.filename}</span>
        </>
      )}
    </div>
  );

  return (
    <div className="group relative flex flex-col items-center gap-1">
      {onPreview ? (
        <button type="button" onClick={onPreview} className="cursor-zoom-in">
          {inner}
        </button>
      ) : (
        <a href={a.url ?? "#"} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      )}
      <span className="max-w-[80px] truncate text-center text-[10px] text-muted-foreground">
        {isImage ? a.filename : formatBytes(a.size_bytes)}
      </span>

      {/* 悬停时显示的下载按钮 */}
      <a
        href={`/api/attachments/${a.id}/download`}
        className="absolute bottom-5 left-1/2 hidden -translate-x-1/2 h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white group-hover:flex hover:bg-black/80"
        title="下载文件"
      >
        <Download className="h-3.5 w-3.5" />
      </a>

      {canDelete && onDelete && (
        <button
          type="button"
          onClick={() => onDelete(a.id)}
          className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-white group-hover:flex"
          title="删除附件"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
