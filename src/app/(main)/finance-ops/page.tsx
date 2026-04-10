import { redirect } from "next/navigation";
import { getMembers } from "@/actions/members";
import { FinanceOpsModeTabs, type FinanceOpsMode } from "@/components/finance-ops-mode-tabs";
import { FinanceOpsClient } from "@/components/finance-ops-client";
import { PettyCashClient } from "@/components/petty-cash-client";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getFinanceOpsBundle } from "@/lib/finance-ops-queries";
import { getPettyCashBundle } from "@/lib/petty-cash-queries";
import { canAccessFinanceOps } from "@/lib/permissions";
import type { FinanceOpsView } from "@/lib/finance-ops";

export const dynamic = "force-dynamic";

function parseView(value: string | string[] | undefined): FinanceOpsView {
  if (typeof value !== "string") return "month";
  if (value === "quarter" || value === "year" || value === "overdue" || value === "all") return value;
  return "month";
}

function parseMode(value: string | string[] | undefined): FinanceOpsMode {
  if (value === "petty-cash") return "petty-cash";
  return "tasks";
}

export default async function FinanceOpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!canAccessFinanceOps(user)) redirect("/home");

  const sp = await searchParams;
  const view = parseView(sp.view);
  const mode = parseMode(sp.mode);
  const [members, tasksBundle, pettyCashBundle] = await Promise.all([
    getMembers(),
    mode === "tasks" ? getFinanceOpsBundle(view) : Promise.resolve(null),
    mode === "petty-cash" ? getPettyCashBundle() : Promise.resolve(null),
  ]);

  if (mode === "tasks" && !tasksBundle) redirect("/home");
  if (mode === "petty-cash" && !pettyCashBundle) redirect("/home");

  const schemaReady = mode === "tasks" ? tasksBundle?.schemaReady : pettyCashBundle?.schemaReady;
  const setupMessage = mode === "tasks" ? tasksBundle?.setupMessage : pettyCashBundle?.setupMessage;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">财务行政待办</h1>
        <p className="text-sm text-muted-foreground">
          聚焦财务、出纳、行政人事的固定节点与临时事项，同时补充垫付与发票跟踪台账。
        </p>
      </div>
      <div className="mb-6">
        <FinanceOpsModeTabs currentMode={mode} />
      </div>
      {!schemaReady ? (
        <Card>
          <CardContent className="space-y-2 py-6">
            <p className="font-medium">{mode === "tasks" ? "财务行政待办尚未完成初始化" : "备用金登记尚未完成初始化"}</p>
            <p className="text-sm text-muted-foreground">
              {setupMessage ?? "请先完成数据库迁移后再进入该页面。"}
            </p>
          </CardContent>
        </Card>
      ) : mode === "tasks" && tasksBundle ? (
        <FinanceOpsClient bundle={tasksBundle} members={members} currentView={view} />
      ) : (
        pettyCashBundle && <PettyCashClient bundle={pettyCashBundle} members={members} />
      )}
    </div>
  );
}
