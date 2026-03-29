import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getIssueBasic } from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { IssueDetailClient } from "@/components/issue-detail-client";
import { IssueUpdatesSection } from "@/components/issue-updates-section";
import { IssueEventsSection } from "@/components/issue-events-section";
import { SkeletonLine } from "@/components/skeleton-page";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [issue, members, user] = await Promise.all([
    getIssueBasic(id),
    getMembers(),
    getCurrentUser(),
  ]);

  if (!issue || !user) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/issues"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← 返回列表
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{issue.title}</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 基础信息 + 附件：首屏即出，不等进度/事件 */}
        <IssueDetailClient issue={issue} members={members} currentUser={user} />

        {/* 进度时间线：流式加载 */}
        <Suspense fallback={<TimelineSkeleton />}>
          <IssueUpdatesSection issue={issue} currentUser={user} />
        </Suspense>

        {/* 事件审计轨迹：流式加载 */}
        <Suspense fallback={<EventsSkeleton />}>
          <IssueEventsSection issueId={id} />
        </Suspense>
      </div>
    </div>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <SkeletonLine className="w-32" />
      <div className="h-20 animate-pulse rounded bg-muted/30" />
      <div className="h-20 animate-pulse rounded bg-muted/30" />
      <div className="h-20 animate-pulse rounded bg-muted/30" />
    </div>
  );
}

function EventsSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <SkeletonLine className="w-28" />
      <SkeletonLine className="w-3/4" />
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="w-3/4" />
      <SkeletonLine className="w-1/2" />
    </div>
  );
}
