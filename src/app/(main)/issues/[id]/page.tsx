import { notFound } from "next/navigation";
import Link from "next/link";
import { getIssueDetail, getIssueEvents } from "@/actions/issues";
import { getMembers } from "@/actions/members";
import { getCurrentUser } from "@/lib/auth";
import { IssueDetailClient } from "@/components/issue-detail-client";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [issue, members, user, events] = await Promise.all([
    getIssueDetail(id),
    getMembers(),
    getCurrentUser(),
    getIssueEvents(id),
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
      <IssueDetailClient issue={issue} members={members} currentUser={user} events={events} />
    </div>
  );
}
