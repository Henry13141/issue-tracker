import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getKnowledgeDecisions, type KnowledgeDecisionFilters } from "@/actions/knowledge-decisions";
import { KnowledgeDecisionsClient } from "@/components/knowledge-decisions-client";
import { SkeletonTable } from "@/components/skeleton-page";
import type { KnowledgeDecisionStatus } from "@/types";

function isDecisionStatus(v: unknown): v is KnowledgeDecisionStatus {
  return typeof v === "string" && ["draft", "confirmed", "superseded"].includes(v);
}

export default async function KnowledgeDecisionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const page = Math.max(1, parseInt(str(sp.page) ?? "1", 10) || 1);
  const rawStatus = str(sp.status);

  const filters: KnowledgeDecisionFilters = {
    q: str(sp.q),
    status: isDecisionStatus(rawStatus) ? rawStatus : undefined,
    project_name: str(sp.project_name) ?? null,
    module: str(sp.module) ?? null,
    page,
    pageSize: 20,
  };

  const { decisions, total } = await getKnowledgeDecisions(filters);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">决策记录</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          记录关键决策背景、结论与影响范围
        </p>
      </div>

      <Suspense fallback={<SkeletonTable rows={6} />}>
        <KnowledgeDecisionsClient decisions={decisions} total={total} currentUser={user} />
      </Suspense>
    </div>
  );
}
