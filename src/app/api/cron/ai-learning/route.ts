/**
 * AI 组织学习 Cron Job
 *
 * 每日触发一次，分析平台全量数据并更新 ai_memory 表。
 * 建议在 vercel.json 中配置为每天凌晨 2 点（低峰期）执行。
 *
 * 调用方式：
 *   - Vercel Cron（自动，需在 vercel.json 配置）
 *   - 手动触发：GET /api/cron/ai-learning?secret=<CRON_SECRET>
 *   - 管理员从 Dashboard 手动触发
 */

import { NextResponse } from "next/server";
import { runOrganizationLearning } from "@/lib/ai-learning";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret     = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";

  if (secret) {
    const header = request.headers.get("authorization");
    if (!vercelCron && header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 503 }
    );
  }

  const startTime = Date.now();
  console.log("[ai-learning] Starting organization learning...");

  try {
    const result = await runOrganizationLearning();
    const elapsed = Date.now() - startTime;

    console.log("[ai-learning] Completed:", result);

    return NextResponse.json({
      ok:      true,
      elapsed: `${elapsed}ms`,
      learned: {
        org_insight:     result.org_insight,
        process_pattern: result.process_pattern,
        module_health:   result.module_health,
        member_profiles: result.member_profiles,
      },
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (e: unknown) {
    console.error("[ai-learning] Fatal error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Learning failed" },
      { status: 500 }
    );
  }
}
