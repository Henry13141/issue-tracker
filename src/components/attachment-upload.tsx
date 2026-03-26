"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Paperclip, X, FileText, Loader2, FileVideo, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createSignedUploadUrl, saveAttachmentMeta } from "@/actions/attachments";
import type { IssueAttachmentWithUrl } from "@/types";
import { cn } from "@/lib/utils";

const MAX_MB = 20;

interface Props {
  issueId: string;
  issueUpdateId?: string | null;
  onUploaded?: (attachment: IssueAttachmentWithUrl) => void;
  className?: string;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isImageType(contentType: string): boolean {
  return contentType.startsWith("image/");
}

function isVideoType(contentType: string): boolean {
  return contentType.startsWith("video/");
}

function isPreviewable(contentType: string): boolean {
  return isImageType(contentType) || isVideoType(contentType);
}

export function AttachmentUploadButton({
  issueId,
  issueUpdateId,
  onUploaded,
  className,
  disabled,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);

    for (const file of Array.from(files)) {
      if (file.size > MAX_MB * 1024 * 1024) {
        setError(`${file.name} 超过 ${MAX_MB} MB 限制`);
        continue;
      }
      try {
        const { signedUrl, storagePath } = await createSignedUploadUrl(
          issueId,
          file.name,
          file.type || "application/octet-stream",
          file.size
        );

        const uploadRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!uploadRes.ok) throw new Error(`上传失败 (${uploadRes.status})`);

        const attachmentId = await saveAttachmentMeta({
          issueId,
          issueUpdateId: issueUpdateId ?? null,
          storagePath,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });

        onUploaded?.({
          id: attachmentId,
          issue_id: issueId,
          issue_update_id: issueUpdateId ?? null,
          storage_path: storagePath,
          filename: file.name,
          content_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_by: "",
          created_at: new Date().toISOString(),
          url: URL.createObjectURL(file),
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
        {uploading ? "上传中…" : "添加附件"}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface ListProps {
  attachments: IssueAttachmentWithUrl[];
  onDelete?: (id: string) => void;
  canDelete?: boolean;
}

export function AttachmentList({ attachments, onDelete, canDelete }: ListProps) {
  const [selected, setSelected] = useState<IssueAttachmentWithUrl | null>(null);

  if (!attachments.length) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {attachments.map((a) => (
          <AttachmentItem
            key={a.id}
            attachment={a}
            onDelete={onDelete}
            canDelete={canDelete}
            onPreview={isPreviewable(a.content_type) ? () => setSelected(a) : undefined}
          />
        ))}
      </div>

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
          ) : selected ? (
            <div className="flex items-center justify-center p-2">
              <video
                src={selected.url}
                controls
                autoPlay
                className="max-h-[90vh] max-w-full"
              />
            </div>
          ) : null}

          {selected && (
            <div className="flex items-center justify-between border-t border-white/10 px-4 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm text-white/70">{selected.filename}</span>
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
                {attachments.filter((a) => isPreviewable(a.content_type)).map((a, i) => (
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
          className="h-full w-full object-cover"
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
