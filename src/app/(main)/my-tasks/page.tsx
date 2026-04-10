import Link from "next/link";
import { getIssueIdsWithUpdateTodayAmong, getMyOpenIssues, getMyFollowingIssues } from "@/actions/issues";
import { getCurrentUser } from "@/lib/auth";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { MyTasksClient } from "@/components/my-tasks-client";
import type { IssueWithRelations } from "@/types";

const ACTIVE_SET = new Set<string>(ACTIVE_STATUSES);

export default async function MyTasksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [issues, following] = await Promise.all([
    getMyOpenIssues(),
    getMyFollowingIssues(),
  ]);
  const needUpdate: IssueWithRelations[] = [];
  const updatedToday: IssueWithRelations[] = [];

  const activeIds = issues.filter((i) => ACTIVE_SET.has(i.status)).map((i) => i.id);
  const updatedIds = await getIssueIdsWithUpdateTodayAmong(activeIds);

  for (const issue of issues) {
    if (ACTIVE_SET.has(issue.status)) {
      if (updatedIds.has(issue.id)) updatedToday.push(issue);
      else needUpdate.push(issue);
    } else {
      updatedToday.push(issue);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">我的任务</h1>
        <p className="text-sm text-muted-foreground">
          你负责事项的完整列表与快速写进展；今日优先建议在{" "}
          <Link href="/home" className="text-primary underline-offset-4 hover:underline">
            工作台
          </Link>{" "}
          先看一眼再回来处理细节。
        </p>
      </div>
      <MyTasksClient needUpdate={needUpdate} updatedToday={updatedToday} following={following} />
    </div>
  );
}
