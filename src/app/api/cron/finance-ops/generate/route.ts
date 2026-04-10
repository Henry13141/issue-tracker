import { NextResponse } from "next/server";
import { ensureFinanceTaskInstancesForCurrentPeriod } from "@/lib/finance-ops-queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const vercelCron = request.headers.get("x-vercel-cron") === "1";
  if (secret) {
    const header = request.headers.get("authorization");
    if (!vercelCron && header !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await ensureFinanceTaskInstancesForCurrentPeriod();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[cron] finance-ops generate failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
