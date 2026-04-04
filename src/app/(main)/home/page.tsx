import Link from "next/link";
import { WeatherWidget } from "@/components/weather-widget";
import { WorkbenchAvatar } from "@/components/workbench-avatar";
import { WorkbenchQuickActions } from "@/components/workbench-quick-actions";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { getMembers } from "@/actions/members";
import {
  formatWorkbenchEventLabel,
  getWorkbenchRecentEvents,
  getWorkbenchStats,
  getWorkbenchTaskGroups,
} from "@/lib/workbench-queries";
import { formatDateTime, formatDateOnly, getTenureDays } from "@/lib/dates";
import { StatusBadge } from "@/components/status-badge";
import { PriorityBadge } from "@/components/priority-badge";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";

export const dynamic = "force-dynamic";

export default async function HomeWorkbenchPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [members, stats, tasks, events] = await Promise.all([
    getMembers(),
    getWorkbenchStats(),
    getWorkbenchTaskGroups(),
    getWorkbenchRecentEvents(16),
  ]);

  const s = stats ?? {
    assignedOpen: 0,
    needUpdateToday: 0,
    overdue: 0,
    unreadReminders: 0,
  };

  const needUpdate = tasks?.needUpdate ?? [];
  const updatedToday = tasks?.updatedToday ?? [];
  const tenureDays = getTenureDays(user.created_at);

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="grid min-w-0 grid-cols-1 lg:grid-cols-[minmax(8rem,9.5rem)_minmax(0,1fr)]">
          <div className="border-b border-border/50 px-4 py-4 lg:border-b-0 lg:border-r lg:border-border/60 lg:bg-muted/[0.04] lg:px-4 lg:py-6">
            <WorkbenchAvatar user={{ name: user.name, avatar_url: user.avatar_url }} />
          </div>
          <div className="min-w-0 p-4 sm:p-5 lg:p-6">
            <WeatherWidget tenureDays={tenureDays} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold tracking-wide text-muted-foreground">今日概览</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/my-tasks">
            <StatCard title="负责中" value={s.assignedOpen} description="未关闭的工单" />
          </Link>
          <Link href="/my-tasks">
            <StatCard
              title="今日待同步"
              value={s.needUpdateToday}
              description="进行中且今日尚未写进展"
              className={s.needUpdateToday > 0 ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20" : undefined}
            />
          </Link>
          <Link href="/issues?risk=overdue">
            <StatCard
              title="已逾期"
              value={s.overdue}
              description="已过截止日期且未关闭"
              className={s.overdue > 0 ? "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20" : undefined}
            />
          </Link>
          <Link href="/reminders">
            <StatCard
              title="待你回应"
              value={s.unreadReminders}
              description="未读的协作提醒"
              className={s.unreadReminders > 0 ? "border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20" : undefined}
            />
          </Link>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-4">
          <h2 className="text-base font-semibold tracking-wide text-muted-foreground">我的推进</h2>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">今日建议先处理</CardTitle>
              <p className="text-xs text-muted-foreground">按优先级与截止日期排序，写完进展团队就能同步节奏</p>
            </CardHeader>
            <CardContent className="p-0">
              {needUpdate.length === 0 ? (
                <p className="px-6 pb-4 text-sm text-muted-foreground">
                  当前没有卡在「今日待同步」的活跃任务，或今日已全部推进过。
                </p>
              ) : (
                <ul className="divide-y">
                  {needUpdate.map((issue) => (
                    <li key={issue.id} className="px-6 py-3 hover:bg-muted/30">
                      <div className="flex flex-wrap items-start gap-2">
                        <Link
                          href={`/issues/${issue.id}`}
                          className="min-w-0 flex-1 font-medium text-sm hover:underline line-clamp-2"
                        >
                          {issue.title}
                        </Link>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                          <StatusBadge status={issue.status} />
                          <PriorityBadge priority={issue.priority} />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        截止 {formatDateOnly(issue.due_date)}
                        <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">等你更新今日进展</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {updatedToday.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">今日已推进 / 无需今日同步</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y">
                  {updatedToday.map((issue) => (
                    <li key={issue.id} className="px-6 py-2.5 hover:bg-muted/20">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Link href={`/issues/${issue.id}`} className="min-w-0 flex-1 font-medium hover:underline line-clamp-1">
                          {issue.title}
                        </Link>
                        <StatusBadge status={issue.status} />
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </section>

        <aside>
          <Card className="h-full">
            <CardContent className="pt-6">
              <WorkbenchQuickActions members={members} currentUser={user} />
            </CardContent>
          </Card>
        </aside>
      </div>

      <section>
        <h2 className="mb-3 text-base font-semibold tracking-wide text-muted-foreground">与我相关的动态</h2>
        <Card>
          <CardContent className="p-0">
            {events.length === 0 ? (
              <p className="px-6 py-8 text-sm text-muted-foreground">暂无最近动态</p>
            ) : (
              <ul className="divide-y">
                {events.map((ev) => (
                  <li key={ev.id} className="px-6 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="inline-flex items-center gap-2">
                        {ev.actor ? (
                          <UserAvatar user={ev.actor} className="h-7 w-7 shrink-0" fallbackClassName="text-[10px]" />
                        ) : null}
                        <span className="font-medium">{ev.actor?.name ?? "系统"}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatWorkbenchEventLabel(ev.event_type, ev.event_payload)}
                      </span>
                      {ev.issue ? (
                        <Link
                          href={`/issues/${ev.issue.id}`}
                          className={cn("min-w-0 font-medium text-primary hover:underline", "line-clamp-1")}
                        >
                          {ev.issue.title}
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
