"use client";

import { useState } from "react";
import { Play, FileVideo } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import type { IssueAttachmentWithUrl } from "@/types";

interface Props {
  attachments: IssueAttachmentWithUrl[];
}

export function AttachmentThumbnails({ attachments }: Props) {
  const [selected, setSelected] = useState<IssueAttachmentWithUrl | null>(null);

  if (!attachments?.length) return null;

  const visible = attachments.slice(0, 3);
  const overflow = attachments.length - visible.length;

  return (
    <>
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {visible.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.filename}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSelected(a);
            }}
            className="relative h-9 w-9 shrink-0 overflow-hidden rounded border border-border bg-muted/40 transition-opacity hover:opacity-75"
          >
            {a.content_type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={a.url}
                alt={a.filename}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-black/60">
                <FileVideo className="h-4 w-4 text-white/80" />
              </span>
            )}
          </button>
        ))}

        {overflow > 0 && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-muted/40 text-[11px] text-muted-foreground">
            +{overflow}
          </span>
        )}
      </div>

      {/* ─── 放大/播放弹窗 ─────────────────────────────────────── */}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-4xl gap-0 p-0 overflow-hidden bg-black/90">
          <DialogTitle className="sr-only">
            {selected?.filename ?? "附件预览"}
          </DialogTitle>

          {selected?.content_type.startsWith("image/") ? (
            <div className="flex items-center justify-center p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={selected.url}
                alt={selected.filename}
                className="max-h-[85vh] max-w-full object-contain"
              />
            </div>
          ) : selected ? (
            <div className="flex items-center justify-center p-2">
              <video
                src={selected.url}
                controls
                autoPlay
                className="max-h-[85vh] max-w-full"
              />
            </div>
          ) : null}

          {selected && (
            <div className="flex items-center justify-between border-t border-white/10 px-4 py-2">
              <span className="truncate text-sm text-white/70">{selected.filename}</span>
              {/* 导航：上一个 / 下一个 */}
              <div className="flex gap-2 text-xs text-white/50">
                {attachments.map((a, i) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelected(a)}
                    className={`flex h-6 w-6 items-center justify-center rounded ${
                      a.id === selected.id
                        ? "bg-white/20 text-white"
                        : "text-white/40 hover:text-white/70"
                    }`}
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

/** 单个视频缩略图（带播放覆盖层） */
export function VideoThumbnail({ url, filename }: { url: string; filename: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title={filename}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        className="group relative h-9 w-9 overflow-hidden rounded border border-border bg-black/60"
      >
        <Play className="absolute inset-0 m-auto h-4 w-4 text-white" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl gap-0 bg-black/90 p-2">
          <DialogTitle className="sr-only">{filename}</DialogTitle>
          <video src={url} controls autoPlay className="max-h-[85vh] w-full" />
        </DialogContent>
      </Dialog>
    </>
  );
}
