/**
 * GET /api/attachments/[id]/download
 *
 * 生成带 Content-Disposition: attachment 的 Supabase signed URL，
 * 然后 302 重定向过去，触发浏览器"另存为"行为。
 * 有效期 60 秒（够用一次下载，不暴露长期链接）。
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const BUCKET = "issue-files";

function buildContentDisposition(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim() || "download";

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: row, error: fetchErr } = await supabase
    .from("issue_attachments")
    .select("storage_path, filename, content_type")
    .eq("id", id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  }

  if (/^https?:\/\//.test(row.storage_path as string)) {
    const upstream = await fetch(row.storage_path as string, { cache: "no-store" });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "下载附件失败" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      (row.content_type as string | null) ??
      upstream.headers.get("content-type") ??
      "application/octet-stream"
    );
    headers.set("Content-Disposition", buildContentDisposition(row.filename as string));
    headers.set("Cache-Control", "private, no-store, max-age=0");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path as string, 60, {
      download: row.filename as string,
    });

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "生成下载链接失败" }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl, { status: 302 });
}
