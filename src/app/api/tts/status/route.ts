import { NextRequest, NextResponse } from "next/server";

const TTS_PORT = 7860;

function isLocalhostRequest(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || !isLocalhostRequest(req)) {
    return NextResponse.json({ running: false });
  }

  try {
    const res = await fetch(`http://localhost:${TTS_PORT}`, {
      signal: AbortSignal.timeout(2000),
    });
    // Gradio 正常启动后会返回 200 的 HTML 页面
    if (res.status < 500) {
      return NextResponse.json({ running: true });
    }
    return NextResponse.json({ running: false });
  } catch {
    return NextResponse.json({ running: false });
  }
}
