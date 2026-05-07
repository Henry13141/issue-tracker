import { existsSync } from "fs";
import { NextResponse } from "next/server";

const TTS_DIR = process.env.INDEXTTS_DIR ?? "/Users/haoyi/Desktop/兴趣爱好/index-tts";
const TTS_PORT = parseInt(process.env.INDEXTTS_PORT ?? "7860", 10);

export async function GET() {
  const installed = existsSync(TTS_DIR);

  try {
    const res = await fetch(`http://localhost:${TTS_PORT}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.status < 500) {
      return NextResponse.json({ running: true, installed });
    }
  } catch {
    // 服务未运行
  }

  return NextResponse.json({ running: false, installed });
}
