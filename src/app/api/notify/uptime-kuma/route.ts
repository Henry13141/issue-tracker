import { NextRequest, NextResponse } from "next/server";
import { sendWecomWorkNotice } from "@/lib/wecom";

const NOTIFY_SECRET = process.env.UPTIME_KUMA_NOTIFY_SECRET;
const NOTIFY_USERID = process.env.UPTIME_KUMA_NOTIFY_USERID || "HaoYi";

export async function POST(req: NextRequest) {
  // 简单密钥校验（防止公网滥用）
  const secret = req.headers.get("x-notify-secret") ?? req.nextUrl.searchParams.get("secret");
  if (NOTIFY_SECRET && secret !== NOTIFY_SECRET) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const monitor = body.monitor as Record<string, unknown> | undefined;
  const heartbeat = body.heartbeat as Record<string, unknown> | undefined;

  const monitorName = (monitor?.name as string) ?? "未知服务";
  const isUp = (heartbeat?.status as number) === 1;
  const statusText = isUp ? "✅ 恢复正常" : "🔴 服务故障";
  const detail = (heartbeat?.msg as string) ?? (isUp ? "服务已恢复" : "服务不可达");

  const markdown = `${statusText}\n\n**服务：** ${monitorName}\n**详情：** ${detail}`;

  try {
    await sendWecomWorkNotice(NOTIFY_USERID, "Uptime Kuma 告警", markdown);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[notify/uptime-kuma]", e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
