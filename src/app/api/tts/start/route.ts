import { spawn } from "child_process";
import { NextResponse } from "next/server";

const TTS_DIR = "/Users/haoyi/Desktop/兴趣爱好/index-tts";
const TTS_PORT = 7860;

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

export async function POST() {
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
