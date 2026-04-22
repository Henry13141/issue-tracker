import { NextResponse } from "next/server";

const TTS_PORT = 7860;

export async function GET() {
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
