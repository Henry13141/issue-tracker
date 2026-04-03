import { getMyOpenIssues, issueHasUpdateToday } from "@/actions/issues";
import { getCurrentUser } from "@/lib/auth";
import { MyTasksClient } from "@/components/my-tasks-client";
import type { IssueWithRelations } from "@/types";

export default async function MyTasksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const issues = await getMyOpenIssues();
  const needUpdate: IssueWithRelations[] = [];
  const updatedToday: IssueWithRelations[] = [];

  for (const issue of issues) {
    const active =
      issue.status === "in_progress" ||
      issue.status === "blocked" ||
      issue.status === "pending_review";
    if (active) {
      const ok = await issueHasUpdateToday(issue.id);
      if (ok) updatedToday.push(issue);
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
          你负责的事项都在这里，每次更新都会让协作更顺畅
        </p>
      </div>
      <MyTasksClient needUpdate={needUpdate} updatedToday={updatedToday} />
    </div>
  );
}
