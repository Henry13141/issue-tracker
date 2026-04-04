"use client";

import { startTransition, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Camera } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { createAvatarSignedUploadUrl, updateMyAvatarUrl } from "@/actions/profile";
import { cn } from "@/lib/utils";
import type { User } from "@/types";

/** 最小 PNG（1×1），仅开发环境「测试上传」用 */
const TEST_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function testPngFile(): File {
  const buf = Uint8Array.from(atob(TEST_PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([buf], "avatar-test.png", { type: "image/png" });
}

export function WorkbenchAvatar({
  user,
  className,
}: {
  user: Pick<User, "name" | "avatar_url">;
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const initials = user.name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function runAvatarUpload(file: File) {
    const { signedUrl, publicUrl } = await createAvatarSignedUploadUrl(file.type, file.size);
    const put = await fetch(signedUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!put.ok) {
      throw new Error(`上传失败（${put.status}）`);
    }
    await updateMyAvatarUrl(publicUrl);
    toast.success("头像已更新");
    startTransition(() => {
      router.refresh();
    });
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      await runAvatarUpload(file);
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.error("[WorkbenchAvatar] upload failed", err);
      }
      toast.error(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function onDevTestUpload() {
    setUploading(true);
    try {
      await runAvatarUpload(testPngFile());
    } catch (err) {
      console.error("[WorkbenchAvatar] dev test upload failed", err);
      toast.error(err instanceof Error ? err.message : "测试上传失败");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 lg:flex-col lg:items-center lg:justify-start lg:gap-2.5",
        className,
      )}
    >
      <div className="relative shrink-0">
        <Avatar className="size-16 border-2 border-background shadow-md ring-1 ring-border/80 sm:size-[4.5rem] lg:size-20">
          {user.avatar_url ? (
            <AvatarImage src={user.avatar_url} alt="" className="object-cover" />
          ) : null}
          <AvatarFallback className="text-sm font-semibold sm:text-base lg:text-lg">{initials || "?"}</AvatarFallback>
        </Avatar>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute -bottom-0.5 -right-0.5 size-8 rounded-full border shadow-md sm:size-9"
          disabled={uploading}
          title="更换头像（JPG / PNG / WebP / GIF，最大 2 MB）"
          aria-label="更换头像"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:h-4 sm:w-4" /> : <Camera className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={onPickFile}
        />
        {process.env.NODE_ENV === "development" ? (
          <button
            type="button"
            className="mt-1 w-full text-center text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            disabled={uploading}
            onClick={() => void onDevTestUpload()}
          >
            测试上传（1×1 PNG）
          </button>
        ) : null}
      </div>
      <div className="min-w-0 flex-1 lg:w-full lg:max-w-[12rem] lg:flex-none lg:text-center">
        <p
          className="truncate rounded-lg border border-black bg-white px-3 py-2 text-base font-semibold tracking-tight text-neutral-900 shadow-[0_4px_12px_0_rgba(0,0,0,0.15)] sm:text-lg"
          title={user.name}
        >
          {user.name}
        </p>
      </div>
    </div>
  );
}
