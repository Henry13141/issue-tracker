import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import OpenAI from "openai";

export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.MOONSHOT_API_KEY;
  const configured = Boolean(key);
  const keyPrefix = key ? key.slice(0, 8) + "..." : null;

  // 测试一次极小的 API 调用
  let apiCallResult: { ok: boolean; elapsed: number; error?: string; model?: string } | null = null;
  if (configured) {
    const client = new OpenAI({ apiKey: key, baseURL: "https://api.moonshot.cn/v1" });
    const t0 = Date.now();
    try {
      const res = await client.chat.completions.create({
        model: "kimi-k2.6",
        messages: [{ role: "user", content: "回复OK" }],
        max_tokens: 8,
        thinking: { type: "disabled" as const },
      });
      apiCallResult = {
        ok: true,
        elapsed: Date.now() - t0,
        model: res.model,
      };
    } catch (e) {
      apiCallResult = {
        ok: false,
        elapsed: Date.now() - t0,
        error: e instanceof Error ? `${e.message} (status=${(e as { status?: number }).status ?? "?"})` : String(e),
      };
    }
  }

  return NextResponse.json({
    configured,
    keyPrefix,
    apiCallResult,
    region: process.env.VERCEL_REGION ?? "unknown",
    env: process.env.VERCEL_ENV ?? "local",
    maxDurationInPageTest: "check dashboard/page.tsx export",
  });
}
