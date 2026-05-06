import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";

const TTS_DIR = "/Users/haoyi/Desktop/兴趣爱好/index-tts";
const TTS_PORT = 7860;

function isLocalhostRequest(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
}

async function isServiceRunning(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${TTS_PORT}`, {
      signal: AbortSignal.timeout(2000),
    });
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production" || !isLocalhostRequest(req)) {
    return NextResponse.json({ error: "仅本地开发环境可用" }, { status: 403 });
  }

  if (await isServiceRunning()) {
    return NextResponse.json({ status: "already_running" });
  }

  try {
    const child = spawn("/bin/bash", ["start.sh"], {
      cwd: TTS_DIR,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return NextResponse.json({ status: "starting" });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 }
    );
  }
}
