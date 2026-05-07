import { spawn } from "child_process";
import { existsSync } from "fs";
import { platform } from "os";
import { NextResponse } from "next/server";

const TTS_DIR = process.env.INDEXTTS_DIR ?? "/Users/haoyi/Desktop/兴趣爱好/index-tts";
const TTS_PORT = parseInt(process.env.INDEXTTS_PORT ?? "7860", 10);
const IS_WINDOWS = platform() === "win32";

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

function spawnDetached(cmd: string, args: string[], cwd: string) {
  const child = spawn(cmd, args, {
    cwd,
    detached: true,
    stdio: "ignore",
    // Windows 下需要 shell:false 避免 cmd 窗口弹出
    windowsHide: true,
  });
  child.unref();
}

function startService() {
  if (IS_WINDOWS) {
    // 优先 start.bat，其次 start.ps1，最后直接 python webui.py
    if (existsSync(`${TTS_DIR}\\start.bat`)) {
      spawnDetached("cmd.exe", ["/c", "start.bat"], TTS_DIR);
    } else if (existsSync(`${TTS_DIR}\\start.ps1`)) {
      spawnDetached("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", "start.ps1"], TTS_DIR);
    } else {
      spawnDetached("python", ["webui.py"], TTS_DIR);
    }
  } else {
    spawnDetached("/bin/bash", ["start.sh"], TTS_DIR);
  }
}

function installService() {
  // 读取管理员提供的安装脚本路径
  const installScript = process.env.INDEXTTS_INSTALL_SCRIPT;

  if (IS_WINDOWS) {
    if (installScript) {
      spawnDetached("powershell.exe", ["-ExecutionPolicy", "Bypass", "-File", installScript], "C:\\");
    } else {
      // 默认：git clone + pip install + 启动
      const cmds = [
        `git clone https://github.com/index-tts/index-tts.git "${TTS_DIR}"`,
        `cd /d "${TTS_DIR}"`,
        `python -m venv venv`,
        `call venv\\Scripts\\activate.bat`,
        `pip install -r requirements.txt`,
        `python webui.py`,
      ].join(" && ");
      spawnDetached("cmd.exe", ["/c", cmds], "C:\\");
    }
  } else {
    if (installScript) {
      spawnDetached("/bin/bash", [installScript], "/");
    } else {
      const cmds = [
        `git clone https://github.com/index-tts/index-tts.git "${TTS_DIR}"`,
        `cd "${TTS_DIR}"`,
        `python3 -m venv venv`,
        `source venv/bin/activate`,
        `pip install -r requirements.txt`,
        `python webui.py`,
      ].join(" && ");
      spawnDetached("/bin/bash", ["-c", cmds], "/");
    }
  }
}

export async function POST() {
  if (await isServiceRunning()) {
    return NextResponse.json({ status: "already_running" });
  }

  const installed = existsSync(TTS_DIR);

  try {
    if (!installed) {
      // 目录不存在 → 触发自动安装（安装完成后服务也会自动启动）
      installService();
      return NextResponse.json({ status: "installing" });
    }

    startService();
    return NextResponse.json({ status: "starting" });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: String(err) },
      { status: 500 },
    );
  }
}
