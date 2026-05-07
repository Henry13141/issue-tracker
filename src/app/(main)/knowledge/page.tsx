import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getKnowledgeArticles,
  getKnowledgeProjectNames,
  getKnowledgeModules,
  type KnowledgeFilters,
} from "@/actions/knowledge";
import { KnowledgeListClient } from "@/components/knowledge-list-client";
import type { KnowledgeCategory, KnowledgeStatus } from "@/types";

function isKnowledgeCategory(v: unknown): v is KnowledgeCategory {
  const valid = [
    "project_overview", "gameplay_rule", "numeric_system", "ui_spec",
    "technical_spec", "hardware_protocol", "decision_record", "test_acceptance",
    "troubleshooting", "operation_guide", "finance_ops", "ai_workflow",
  ];
  return typeof v === "string" && valid.includes(v);
}

function isKnowledgeStatus(v: unknown): v is KnowledgeStatus {
  return typeof v === "string" && ["draft", "reviewing", "approved", "deprecated", "archived"].includes(v);
}

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

  const page = Math.max(1, parseInt(str(sp.page) ?? "1", 10) || 1);
  const rawCategory = str(sp.category);
  const rawStatus = str(sp.status);

  const filters: KnowledgeFilters = {
    q: str(sp.q),
    category: isKnowledgeCategory(rawCategory) ? rawCategory : undefined,
    status: isKnowledgeStatus(rawStatus) ? rawStatus : undefined,
    module: str(sp.module) ?? null,
    project_name: str(sp.project_name) ?? null,
    page,
    pageSize: 20,
  };

  const [{ articles, total }, projects, modules] = await Promise.all([
    getKnowledgeArticles(filters),
    getKnowledgeProjectNames(),
    getKnowledgeModules(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">项目知识库</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          沉淀项目规则、技术规范、决策记录与问题复盘
        </p>
      </div>

      <Suspense>
        <KnowledgeListClient
          initialArticles={articles}
          total={total}
          currentPage={page}
          projects={projects}
          modules={modules}
        />
      </Suspense>
    </div>
  );
}
