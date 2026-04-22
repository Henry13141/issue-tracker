import Link from "next/link";
import { redirect } from "next/navigation";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationHealth } from "@/lib/dashboard-queries";
import { isWecomWebhookConfigured } from "@/lib/wecom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/lib/button-variants";

export default async function WecomHealthPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/issues");

  const [members, health] = await Promise.all([getMembers(), getNotificationHealth()]);
  const missingWecom = members.filter((m) => !m.wecom_userid?.trim());
  const webhookOk = isWecomWebhookConfigured();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">企业微信接入健康</h1>
        <p className="text-sm text-muted-foreground">
          成员 userid 绑定与近期通知投递概况；送达链路仍需在企业微信后台配置可信 IP 等，详见仓库根目录{" "}
          <code className="rounded bg-muted px-1 text-xs">README.md</code> 中「企业微信集成」与「常见问题」。
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="成员总数" value={members.length} description="当前可见成员" />
        <StatCard
          title="未绑定企业微信 userid"
          value={missingWecom.length}
          description="将无法收到应用消息催办"
          className={missingWecom.length > 0 ? "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20" : undefined}
        />
        <StatCard
          title="群 Webhook"
          value={webhookOk ? "已配置" : "未配置"}
          description="群机器人汇总（可选）"
        />
        <StatCard
          title="今日通知失败"
          value={health.todayFailed}
          description={`成功率 ${health.todayTotal > 0 ? `${100 - (health.todayFailureRate ?? 0)}%` : "—"}`}
          className={health.todayFailed > 0 ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20" : undefined}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/members" className={cn(buttonVariants({ variant: "default", size: "sm" }))}>
          去成员管理补全 userid →
        </Link>
        <Link
          href="/dashboard/notifications?status=failed"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          查看失败投递记录 →
        </Link>
        <span className="text-xs text-muted-foreground self-center">
          出口 IP：部署环境可手动请求 <code className="rounded bg-muted px-1">/api/cron/check-ip</code>（需 CRON_SECRET）
        </span>
      </div>

      {missingWecom.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">未绑定 userid 的成员（前 20 名）</CardTitle>
            <p className="text-xs font-normal text-muted-foreground">
              在「成员与企业微信」页补全后，私信催办才能送达。
            </p>
          </CardHeader>
          <CardContent>
            <ul className="max-h-64 space-y-1 overflow-y-auto text-sm">
              {missingWecom.slice(0, 20).map((m) => (
                <li key={m.id} className="flex justify-between gap-2 border-b border-border/50 py-1.5 last:border-0">
                  <span className="font-medium">{m.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{m.email}</span>
                </li>
              ))}
            </ul>
            {missingWecom.length > 20 ? (
              <p className="mt-2 text-xs text-muted-foreground">另有 {missingWecom.length - 20} 人未展示，请在成员页查看全表。</p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">所有可见成员均已填写企业微信 userid。</p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">近 7 天通知错误 Top</CardTitle>
        </CardHeader>
        <CardContent>
          {health.topErrors.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无聚合错误码（或尚无投递记录）。</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {health.topErrors.map((e) => (
                <li key={e.code} className="flex justify-between gap-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-red-700">{e.code}</code>
                  <span className="font-medium">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
