import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getIssueBasic } from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getIssueKnowledgeLinks } from "@/actions/knowledge";
import { getCurrentUser } from "@/lib/auth";
import { IssueDetailClient } from "@/components/issue-detail-client";
import { IssueSubtasksClient } from "@/components/issue-subtasks-client";
import { IssueUpdatesSection } from "@/components/issue-updates-section";
import { IssueEventsSection } from "@/components/issue-events-section";
import { IssueKnowledgeSection } from "@/components/issue-knowledge-section";
import { SkeletonLine } from "@/components/skeleton-page";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default async function IssueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    notFound();
  }

  const issue = await getIssueBasic(id);
  if (!issue) {
    notFound();
  }

  const [members, knowledgeLinks] = await Promise.all([
    getMembers(),
    getIssueKnowledgeLinks(id),
  ]);
  const sp = await searchParams;
  // 优先使用列表页传来的 from 参数（保留分页/筛选状态），否则 fallback 到 /issues
  // 只允许跳回 /issues 路径，防止开放重定向
  const rawFrom = typeof sp.from === "string" ? sp.from : undefined;
  const backHref =
    rawFrom && /^\/issues(\?|$)/.test(rawFrom) ? rawFrom : "/issues";

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <Link
          href={backHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← 返回列表
        </Link>
      </div>
      {issue.parent && (
        <p className="mb-2 text-sm text-muted-foreground">
          父问题：
          <Link href={`/issues/${issue.parent.id}`} className="text-primary hover:underline">
            {issue.parent.title}
          </Link>
        </p>
      )}
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{issue.title}</h1>
      <div className="space-y-6">
        {!issue.parent_issue_id && (
          <IssueSubtasksClient parentIssue={issue} currentUser={user} />
        )}

        {/* 基础信息：首屏即出，不等进度/事件 */}
        <IssueDetailClient issue={issue} members={members} currentUser={user} />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
          {/* 进度时间线：主阅读区，优先给更宽空间 */}
          <Suspense fallback={<TimelineSkeleton />}>
            <IssueUpdatesSection issue={issue} currentUser={user} />
          </Suspense>

          {/* 事件审计轨迹：放在侧边作为辅助信息 */}
          <Suspense fallback={<EventsSkeleton />}>
            <IssueEventsSection issueId={id} />
          </Suspense>
        </div>

        {/* 关联知识库 */}
        <IssueKnowledgeSection
          issueId={id}
          initialLinks={knowledgeLinks}
          currentUser={user}
          issueStatus={issue.status}
        />
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
