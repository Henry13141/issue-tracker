import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import {
  getDashboardStats,
  getStaleMembers,
  getRecentUpdates,
} from "@/actions/dashboard";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { formatDateTime } from "@/lib/dates";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") {
    redirect("/issues");
  }

  const [stats, staleMembers, recent] = await Promise.all([
    getDashboardStats(),
    getStaleMembers(),
    getRecentUpdates(25),
  ]);

  const allZero =
    stats.noUpdateToday === 0 &&
    stats.resolvedToday === 0 &&
    stats.overdue === 0 &&
    stats.blocked === 0 &&
    staleMembers.length === 0 &&
    recent.length === 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">管理看板</h1>
        <p className="text-sm text-muted-foreground">今日进度、风险与最新动态</p>
      </div>

      {allZero ? (
        <div className="mb-8">
          <EmptyState
            title="欢迎使用米伽米工单管理系统"
            description="创建工单并分配给成员后，这里将展示今日未更新、超期与最新进展等统计。"
          >
            <Link href="/issues" className={cn(buttonVariants())}>
              前往问题列表
            </Link>
          </EmptyState>
        </div>
      ) : null}

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="今日未更新（进行中）"
          value={stats.noUpdateToday}
          description="in_progress / blocked / pending_review 且无今日进度"
        />
        <StatCard title="今日已解决" value={stats.resolvedToday} description="resolved_at 落在今日" />
        <StatCard title="超期未关闭" value={stats.overdue} description="已过截止且未解决/关闭" />
        <StatCard title="卡住" value={stats.blocked} description="状态为 blocked" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>今日未更新员工</CardTitle>
          </CardHeader>
          <CardContent>
            {staleMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">全员已更新或暂无进行中任务</p>
            ) : (
              <ul className="space-y-3">
                {staleMembers.map((row) => (
                  <li
                    key={row.user.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <span className="font-medium">{row.user.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {row.staleIssueCount} 个问题待更新
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>最新进展（24 小时内）</CardTitle>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无动态</p>
            ) : (
              <ul className="space-y-4">
                {recent.map((r) => (
                  <li key={r.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">
                        {r.user?.name ?? "成员"}{" "}
                        <span className="font-normal text-muted-foreground">更新了</span>{" "}
                        {r.issue ? (
                          <Link
                            href={`/issues/${r.issue.id}`}
                            className="text-primary hover:underline"
                          >
                            {r.issue.title}
                          </Link>
                        ) : (
                          "问题"
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(r.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{r.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
