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
    .select("storage_path, filename")
    .eq("id", id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "附件不存在" }, { status: 404 });
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
