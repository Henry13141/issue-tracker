"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";

const TTS_URL = "http://localhost:7860";
const POLL_INTERVAL_MS = 3000;
const MAX_WAIT_MS = 3 * 60 * 1000; // 最多等待 3 分钟

type Phase = "checking" | "starting" | "waiting" | "ready" | "error";

export default function TTSPage() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [iframeKey, setIframeKey] = useState(0);
  const startTimeRef = useRef<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function checkStatus(): Promise<boolean> {
    try {
      const res = await fetch("/api/tts/status");
      const data = await res.json();
      return data.running === true;
    } catch {
      return false;
    }
  }

  async function startService() {
    try {
      await fetch("/api/tts/start", { method: "POST" });
    } catch {
      // 忽略启动请求错误，继续轮询
    }
  }

  function stopPolling() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function bootstrap() {
    setPhase("checking");
    setElapsedSec(0);
    startTimeRef.current = Date.now();

    const alreadyRunning = await checkStatus();
    if (alreadyRunning) {
      setPhase("ready");
      return;
    }

    setPhase("starting");
    await startService();
    setPhase("waiting");

    timerRef.current = setInterval(async () => {
      const elapsed = Date.now() - startTimeRef.current;
      setElapsedSec(Math.floor(elapsed / 1000));

      if (elapsed > MAX_WAIT_MS) {
        stopPolling();
        setPhase("error");
        return;
      }

      const running = await checkStatus();
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
              <Button variant="outline" size="sm" onClick={() => { stopPolling(); bootstrap(); }}>
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
                  IndexTTS 服务超过 3 分钟未就绪，请检查本地环境。
                </p>
              </div>
              <Button size="sm" onClick={() => { stopPolling(); bootstrap(); }}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                重试
              </Button>
            </>
          ) : (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground/50" />
              <div className="text-center">
                <p className="font-medium text-muted-foreground">
                  {phase === "checking" && "正在检测服务状态…"}
                  {phase === "starting" && "正在启动 IndexTTS…"}
                  {phase === "waiting" && "服务启动中，请稍候…"}
                </p>
                {phase === "waiting" && (
                  <p className="mt-1 text-sm text-muted-foreground/60">
                    已等待 {elapsedSec} 秒，模型加载通常需要 30～60 秒
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
