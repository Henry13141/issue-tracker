import { NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron-auth";
import { ensureFinanceTaskInstancesForCurrentPeriod } from "@/lib/finance-ops-queries";

export async function GET(request: Request) {
  const auth = authorizeCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
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
