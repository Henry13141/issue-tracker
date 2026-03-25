import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationDeliveries } from "@/actions/notifications";
import { getMembers } from "@/actions/members";
import { NotificationsClient } from "@/components/notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/issues");

  const sp = await searchParams;

  const page          = Number(typeof sp.page === "string" ? sp.page : "1") || 1;
  const status        = typeof sp.status  === "string" && sp.status  ? sp.status  : undefined;
  const channel       = typeof sp.channel === "string" && sp.channel ? sp.channel : undefined;
  const triggerSource = typeof sp.trigger === "string" && sp.trigger ? sp.trigger : undefined;
  const targetUserId  = typeof sp.user    === "string" && sp.user    ? sp.user    : undefined;
  const dateFrom      = typeof sp.from    === "string" && sp.from    ? sp.from    : undefined;
  const dateTo        = typeof sp.to      === "string" && sp.to      ? sp.to      : undefined;

  const [result, members] = await Promise.all([
    getNotificationDeliveries({ page, status, channel, triggerSource, targetUserId, dateFrom, dateTo }),
    getMembers(),
  ]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">通知投递日志</h1>
        <p className="text-sm text-muted-foreground">查看所有企业微信通知的投递状态，可重试 failed 记录</p>
      </div>
      <NotificationsClient
        initialResult={result}
        members={members}
        filters={{ status, channel, triggerSource, targetUserId, dateFrom, dateTo, page }}
      />
    </div>
  );
}
