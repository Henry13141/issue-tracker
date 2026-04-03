import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import {
  getOverviewStats,
  getPositiveStats,
  getHighRiskIssues,
  getMemberWorkload,
  getModuleCategoryStats,
  get7DayTrend,
  getNotificationHealth,
} from "@/lib/dashboard-queries";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { ISSUE_STATUS_LABELS, ISSUE_PRIORITY_LABELS } from "@/lib/constants";
import type { HighRiskIssue, TrendDay } from "@/lib/dashboard-queries";

export const dynamic = "force-dynamic";

// ─── 风险标签配色 ──────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  urgent:  "bg-red-100  text-red-800  border-red-200",
  overdue: "bg-orange-100 text-orange-800 border-orange-200",
  stale:   "bg-yellow-100 text-yellow-800 border-yellow-200",
  blocked: "bg-purple-100 text-purple-800 border-purple-200",
};
const RISK_LABELS: Record<string, string> = {
  urgent: "紧急", overdue: "逾期", stale: "3天未更新", blocked: "阻塞",
};

const STATUS_COLORS: Record<string, string> = {
  todo:           "bg-slate-100 text-slate-700",
  in_progress:    "bg-blue-100 text-blue-700",
  blocked:        "bg-purple-100 text-purple-700",
  pending_review: "bg-amber-100 text-amber-700",
  resolved:       "bg-green-100 text-green-700",
  closed:         "bg-gray-100 text-gray-500",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-600 font-bold",
  high:   "text-orange-600",
  medium: "text-yellow-600",
  low:    "text-gray-500",
};

const TRIGGER_LABELS: Record<string, string> = {
  cron_morning:              "早间摘要",
  cron_admin:                "推进跟踪",
  cron_daily:                "待推进提醒",
  issue_event:               "协作事件（旧）",
  "issue_event.status":      "事件·状态变更",
  "issue_event.priority":    "事件·优先级紧急",
  "issue_event.due_date":    "事件·截止提前",
  "issue_event.assignment":  "事件·负责人/评审",
  "issue_event.handover":    "事件·任务交接",
  "issue_event.created":     "事件·任务创建",
  manual_test:               "手动测试",
};

// ─── 趋势迷你条 ────────────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground w-4 text-right">{value}</span>
    </div>
  );
}

// ─── 页面主体 ──────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/issues");

  const [overview, positive, riskIssues, memberWorkload, moduleStats, trend, notifHealth] = await Promise.all([
    getOverviewStats(),
    getPositiveStats(),
    getHighRiskIssues(20),
    getMemberWorkload(),
    getModuleCategoryStats(),
    get7DayTrend(),
    getNotificationHealth(),
  ]);

  // 趋势图最大值（用于条形比例）
  const maxNew    = Math.max(1, ...trend.map((d: TrendDay) => d.newIssues));
  const maxClosed = Math.max(1, ...trend.map((d: TrendDay) => d.closedIssues));
  const maxRemind = Math.max(1, ...trend.map((d: TrendDay) => d.reminders));
  const maxNotif  = Math.max(1, ...trend.map((d: TrendDay) => d.notifFailed));

  return (
    <div className="space-y-8">
      {/* ── 标题 ── */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">管理驾驶舱</h1>
        <p className="text-sm text-muted-foreground">团队推进成果与待关注事项一览</p>
      </div>

      {/* ── 一、团队推进成果 ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-emerald-700 dark:text-emerald-400 tracking-wider">今日推进成果</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="今日进展更新"
            value={positive.todayProgressUpdates}
            description="团队成员提交的进展条数"
            className="border-emerald-200 bg-emerald-50/60"
          />
          <StatCard
            title="今日完成/关闭"
            value={positive.todayClosedResolved}
            description="今天解决或关闭的问题"
            className={positive.todayClosedResolved > 0 ? "border-emerald-300 bg-emerald-50" : undefined}
          />
          <StatCard
            title="近7天完成"
            value={positive.weekClosedResolved}
            description="本周解决或关闭的问题总数"
          />
          <StatCard
            title="近7天活跃成员"
            value={positive.activeContributors}
            description="有提交进展记录的成员数"
            className={positive.activeContributors > 0 ? "border-blue-200 bg-blue-50/60" : undefined}
          />
          <StatCard
            title="今日新录入"
            value={positive.todayNewIssues}
            description="今天新建的问题数量"
          />
          <StatCard
            title="今日交接完成"
            value={positive.todayHandovers}
            description="任务交接接力次数"
          />
          <Link href="/dashboard/notifications">
            <StatCard title="今日通知送达" value={overview.todayNotifTotal} description="全渠道通知投递数" />
          </Link>
          <StatCard title="今日提醒生成" value={overview.todayReminders} description="协作提醒写入数" />
        </div>
      </section>

      {/* ── 二、待关注事项 ── */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-muted-foreground tracking-wider">待关注事项</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Link href="/issues?risk=overdue">
            <StatCard
              title="已过截止日期"
              value={overview.overdueCount}
              description="超截止日期且未关闭"
              className={overview.overdueCount > 0 ? "border-orange-300 bg-orange-50" : undefined}
            />
          </Link>
          <Link href="/issues?status=blocked">
            <StatCard
              title="遇到阻塞"
              value={overview.blockedCount}
              description="需要协助排除阻塞"
              className={overview.blockedCount > 0 ? "border-purple-300 bg-purple-50" : undefined}
            />
          </Link>
          <Link href="/issues?priority=urgent">
            <StatCard
              title="紧急事项"
              value={overview.urgentCount}
              description="优先级为紧急且未关闭"
              className={overview.urgentCount > 0 ? "border-red-300 bg-red-50" : undefined}
            />
          </Link>
          <StatCard
            title="今日待同步"
            value={overview.noUpdateToday}
            description="活跃问题中今日尚未同步进展"
          />
          <StatCard
            title="3天未有进展"
            value={overview.stale3DaysCount}
            description="活跃问题超3天无人工更新"
            className={overview.stale3DaysCount > 0 ? "border-yellow-300 bg-yellow-50" : undefined}
          />
          <Link href="/dashboard/notifications?status=failed">
            <StatCard
              title="通知送达异常"
              value={overview.todayNotifFailed}
              description="今日未能成功送达的通知"
              className={overview.todayNotifFailed > 0 ? "border-red-200 bg-red-50" : undefined}
            />
          </Link>
        </div>
      </section>

      {/* ── 三、需关注事项详情 + 通知送达 ── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* 需关注事项列表 */}
        <section className="lg:col-span-2">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>需关注事项 Top {riskIssues.length}</CardTitle>
                <Link href="/issues?sortBy=last_activity_at&risk=overdue" className="text-xs text-muted-foreground hover:text-foreground">
                  查看全部 →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {riskIssues.length === 0 ? (
                <p className="px-6 pb-4 text-sm text-muted-foreground">当前没有需要特别关注的事项，团队状态不错</p>
              ) : (
                <div className="divide-y">
                  {riskIssues.map((issue: HighRiskIssue) => (
                    <div key={issue.id} className="px-6 py-3 hover:bg-muted/30 transition-colors">
                      <div className="flex flex-wrap items-start gap-2">
                        <Link href={`/issues/${issue.id}`} className="min-w-0 flex-1 font-medium text-sm hover:underline line-clamp-1" title={`风险排名分: ${issue.riskRankScore}`}>
                          {issue.title}
                        </Link>
                        <div className="flex shrink-0 gap-1 flex-wrap">
                          {issue.riskTags.map((tag) => (
                            <span key={tag} className={cn("inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium", RISK_COLORS[tag])}>
                              {RISK_LABELS[tag]}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className={cn("rounded px-1.5 py-0.5", STATUS_COLORS[issue.status])}>
                          {ISSUE_STATUS_LABELS[issue.status] ?? issue.status}
                        </span>
                        <span className={PRIORITY_COLORS[issue.priority]}>
                          {ISSUE_PRIORITY_LABELS[issue.priority] ?? issue.priority}
                        </span>
                        {issue.assigneeName && <span>负责：{issue.assigneeName}</span>}
                        {issue.reviewerName && <span>验收：{issue.reviewerName}</span>}
                        {issue.dueDate && <span className={issue.riskTags.includes("overdue") ? "text-orange-600" : ""}>截止 {issue.dueDate}</span>}
                        <span className={issue.daysSinceActivity > 3 ? "text-yellow-600" : ""}>
                          {issue.daysSinceActivity >= 999 ? "从未更新" : `${issue.daysSinceActivity}天前有动态`}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* 通知健康 */}
        <section>
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>通知送达情况</CardTitle>
                <Link href="/dashboard/notifications" className="text-xs text-muted-foreground hover:text-foreground">
                  查看日志 →
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 今日统计 */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-muted/50 p-2">
                  <div className="text-xl font-bold">{notifHealth.todayTotal}</div>
                  <div className="text-[10px] text-muted-foreground">今日总计</div>
                </div>
                <div className="rounded-lg bg-green-50 p-2">
                  <div className="text-xl font-bold text-green-700">{notifHealth.todaySuccess}</div>
                  <div className="text-[10px] text-muted-foreground">成功</div>
                </div>
                <div className={cn("rounded-lg p-2", notifHealth.todayFailed > 0 ? "bg-red-50" : "bg-muted/50")}>
                  <div className={cn("text-xl font-bold", notifHealth.todayFailed > 0 ? "text-red-600" : "")}>{notifHealth.todayFailed}</div>
                  <div className="text-[10px] text-muted-foreground">失败</div>
                </div>
              </div>

              {/* 失败率 */}
              {notifHealth.todayTotal > 0 && (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                  <span className="text-muted-foreground">今日失败率</span>
                  <span className={cn("font-semibold", (notifHealth.todayFailureRate ?? 0) > 10 ? "text-red-600" : (notifHealth.todayFailureRate ?? 0) > 0 ? "text-orange-500" : "text-green-600")}>
                    {notifHealth.todayFailureRate ?? 0}%
                  </span>
                </div>
              )}
              {notifHealth.weekTotal > 0 && (
                <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
                  <span className="text-muted-foreground">近7天失败率</span>
                  <span className={cn("font-semibold", (notifHealth.weekFailureRate ?? 0) > 10 ? "text-red-600" : (notifHealth.weekFailureRate ?? 0) > 0 ? "text-orange-500" : "text-green-600")}>
                    {notifHealth.weekFailureRate ?? 0}%
                    <span className="ml-1 font-normal text-muted-foreground">({notifHealth.weekFailed}/{notifHealth.weekTotal})</span>
                  </span>
                </div>
              )}

              {/* 近7天错误类型 */}
              {notifHealth.topErrors.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">近7天错误 Top {notifHealth.topErrors.length}</p>
                  <div className="space-y-1.5">
                    {notifHealth.topErrors.map((e) => (
                      <div key={e.code} className="flex items-center justify-between text-xs">
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-red-700">{e.code}</code>
                        <span className="font-medium">{e.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 最近失败记录 */}
              {notifHealth.recentFailures.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">最近失败</p>
                  <div className="space-y-1.5">
                    {notifHealth.recentFailures.slice(0, 5).map((f) => (
                      <div key={f.id} className="rounded-md border border-red-100 bg-red-50/50 px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-1">
                          <code className="font-mono text-red-700">{f.errorCode ?? "unknown"}</code>
                          <span className="text-muted-foreground shrink-0">{TRIGGER_LABELS[f.triggerSource] ?? f.triggerSource}</span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between text-muted-foreground">
                          <span>{f.targetUserName ?? f.targetWecomUserid ?? "—"}</span>
                          <span>{formatDateTime(f.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {notifHealth.todayTotal === 0 && notifHealth.topErrors.length === 0 && (
                <p className="text-sm text-muted-foreground">今日暂无通知记录</p>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {/* ── 四、成员协作概览 ── */}
      <section>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>成员协作概览</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {memberWorkload.length === 0 ? (
              <p className="px-6 pb-4 text-sm text-muted-foreground">暂无数据</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">成员</th>
                    <th className="px-3 py-2 text-center font-medium">负责中</th>
                    <th className="px-3 py-2 text-center font-medium">已过期</th>
                    <th className="px-3 py-2 text-center font-medium">待同步</th>
                    <th className="px-3 py-2 text-center font-medium">遇阻塞</th>
                    <th className="px-3 py-2 text-center font-medium">紧急</th>
                    <th className="px-3 py-2 text-center font-medium">7天推进</th>
                    <th className="px-4 py-2 text-left font-medium">最近活跃</th>
                    <th className="px-3 py-2 text-left font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {memberWorkload.map((m) => (
                    <tr key={m.userId} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{m.name}</div>
                        {!m.wecomUserId && (
                          <div className="text-[10px] text-orange-500">无企业微信 userid</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">{m.total}</td>
                      <td className="px-3 py-2.5 text-center">
                        {m.overdue > 0 ? <span className="font-medium text-orange-600">{m.overdue}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {m.stale > 0 ? <span className="font-medium text-yellow-600">{m.stale}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {m.blocked > 0 ? <span className="font-medium text-purple-600">{m.blocked}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {m.urgent > 0 ? <span className="font-bold text-red-600">{m.urgent}</span> : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {m.updates7Days > 0 ? m.updates7Days : <span className="text-muted-foreground">0</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {m.lastActivityAt ? formatDateTime(m.lastActivityAt) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/issues?assignee=${m.userId}`} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
                          查看工单 →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── 五、模块 / 分类分布 ── */}
      {(moduleStats.modules.length > 0 || moduleStats.categories.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <GroupStatsCard title="模块分布" rows={moduleStats.modules} />
          <GroupStatsCard title="分类分布" rows={moduleStats.categories} />
        </div>
      )}

      {/* ── 六、近7天推进趋势 ── */}
      <section>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>近 7 天推进趋势</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">日期</th>
                  <th className="px-4 py-2 font-medium">新录入</th>
                  <th className="px-4 py-2 font-medium">已完成</th>
                  <th className="px-4 py-2 font-medium">提醒生成</th>
                  <th className="px-4 py-2 font-medium">送达异常</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {trend.map((d: TrendDay) => (
                  <tr key={d.dateStr} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{d.dateStr}</td>
                    <td className="px-4 py-2.5"><MiniBar value={d.newIssues} max={maxNew} color="bg-blue-400" /></td>
                    <td className="px-4 py-2.5"><MiniBar value={d.closedIssues} max={maxClosed} color="bg-green-400" /></td>
                    <td className="px-4 py-2.5"><MiniBar value={d.reminders} max={maxRemind} color="bg-amber-400" /></td>
                    <td className="px-4 py-2.5"><MiniBar value={d.notifFailed} max={maxNotif} color="bg-red-400" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

// ─── 子组件：模块/分类分布卡片 ─────────────────────────────────────────────

function GroupStatsCard({ title, rows }: { title: string; rows: { label: string; total: number; overdue: number; blocked: number; urgent: number }[] }) {
  if (rows.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">{title.replace("分布", "")}</th>
              <th className="px-3 py-2 text-center font-medium">在办</th>
              <th className="px-3 py-2 text-center font-medium">逾期</th>
              <th className="px-3 py-2 text-center font-medium">阻塞</th>
              <th className="px-3 py-2 text-center font-medium">紧急</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.label} className="hover:bg-muted/20">
                <td className="px-4 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 text-center">{r.total}</td>
                <td className="px-3 py-2 text-center">{r.overdue > 0 ? <span className="text-orange-600 font-medium">{r.overdue}</span> : "—"}</td>
                <td className="px-3 py-2 text-center">{r.blocked > 0 ? <span className="text-purple-600 font-medium">{r.blocked}</span> : "—"}</td>
                <td className="px-3 py-2 text-center">{r.urgent > 0 ? <span className="text-red-600 font-bold">{r.urgent}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
