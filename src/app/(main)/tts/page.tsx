"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Loader2, Mic, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

// 通过环境变量覆盖 IndexTTS 前端地址（如部署在独立机器上）
// 默认仍指向本机 :7860，适配开发者本地或与 Next.js 同机运行的场景
const TTS_URL = process.env.NEXT_PUBLIC_INDEXTTS_URL ?? "http://localhost:7860";
const POLL_INTERVAL_MS = 3000;
// 安装阶段可能需要下载模型（几 GB），最多等待 20 分钟
const MAX_WAIT_INSTALL_MS = 20 * 60 * 1000;
// 已安装但尚未启动，等待 3 分钟
const MAX_WAIT_START_MS = 3 * 60 * 1000;

type Phase =
  | "checking"
  | "installing"
  | "starting"
  | "waiting"
  | "ready"
  | "error";

const PHASE_LABELS: Record<Phase, string> = {
  checking: "正在检测服务状态…",
  installing: "正在安装 IndexTTS（首次使用，需下载模型，约需数分钟）…",
  starting: "正在启动 IndexTTS…",
  waiting: "服务启动中，请稍候…",
  ready: "",
  error: "",
};

export default function TTSPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 记录是否处于安装阶段（用于动态调整超时）
  const isInstallingRef = useRef(false);

  async function checkStatus(): Promise<{ running: boolean; installed: boolean }> {
    try {
      const res = await fetch("/api/tts/status");
      const data = await res.json();
      return { running: data.running === true, installed: data.installed !== false };
    } catch {
      return { running: false, installed: false };
    }
  }

  async function startService(): Promise<"starting" | "installing" | "already_running" | "error"> {
    try {
      const res = await fetch("/api/tts/start", { method: "POST" });
      const data = await res.json();
      return data.status ?? "starting";
    } catch {
      return "error";
    }
  }

  function stopPolling() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function bootstrap() {
    stopPolling();
    setPhase("checking");
    setElapsedSec(0);
    startTimeRef.current = Date.now();
    isInstallingRef.current = false;

    const { running } = await checkStatus();
    if (running) {
      setPhase("ready");
      return;
    }

    const startResult = await startService();

    if (startResult === "already_running") {
      setPhase("ready");
      return;
    }

    if (startResult === "installing") {
      isInstallingRef.current = true;
      setPhase("installing");
    } else if (startResult === "error") {
      setPhase("error");
      return;
    } else {
      setPhase("waiting");
    }

    timerRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedSec(Math.floor(elapsed / 1000));

      const maxWait = isInstallingRef.current ? MAX_WAIT_INSTALL_MS : MAX_WAIT_START_MS;
      if (elapsed > maxWait) {
        stopPolling();
        setPhase("error");
        return;
      }

      const { running } = await checkStatus();
      if (running) {
        stopPolling();
        setIframeKey((k) => k + 1);
        setPhase("ready");
      }
    }, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    bootstrap();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isInstalling = phase === "installing";
  const maxWaitSec = Math.floor(
    (isInstalling ? MAX_WAIT_INSTALL_MS : MAX_WAIT_START_MS) / 1000,
  );

  return (
    <div className="flex h-full flex-col gap-3" style={{ height: "calc(100vh - 8rem)" }}>
      <div className="flex shrink-0 items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">语音合成</h1>
          <p className="text-sm text-muted-foreground">IndexTTS · 本地语音克隆与合成</p>
        </div>
        <div className="flex items-center gap-2">
          {phase === "ready" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  stopPolling();
                  bootstrap();
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                重新加载
              </Button>
              <a
                href={TTS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                新窗口打开
              </a>
            </>
          )}
        </div>
      </div>

      {phase === "ready" ? (
        <iframe
          key={iframeKey}
          src={TTS_URL}
          className="min-h-0 flex-1 rounded-lg border border-border"
          title="IndexTTS 语音合成"
          allow="microphone"
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 rounded-lg border border-dashed border-border bg-muted/30">
          {phase === "error" ? (
            <>
              <div className="flex flex-col items-center gap-2 text-center">
                <Mic className="h-10 w-10 text-muted-foreground/40" />
                <p className="font-medium text-muted-foreground">启动超时</p>
                <p className="text-sm text-muted-foreground/70">
                  IndexTTS 超过 {Math.floor(maxWaitSec / 60)} 分钟未就绪，请联系管理员检查环境。
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  stopPolling();
                  bootstrap();
                }}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                重试
              </Button>
            </>
          ) : (
            <>
              {phase === "installing" ? (
                <Download className="h-10 w-10 animate-bounce text-muted-foreground/50" />
              ) : (
                <Loader2 className="h-10 w-10 animate-spin text-muted-foreground/50" />
              )}
              <div className="text-center">
                <p className="font-medium text-muted-foreground">
                  {PHASE_LABELS[phase]}
                </p>
                {(phase === "waiting" || phase === "installing") && (
                  <p className="mt-1 text-sm text-muted-foreground/60">
                    已等待 {elapsedSec} 秒
                    {phase === "installing"
                      ? "，首次安装需下载模型文件（数 GB），请耐心等候"
                      : "，模型加载通常需要 30～60 秒"}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
