import { getIssueUpdatesAndComments } from "@/actions/issues";
import { IssueUpdatesClient } from "@/components/issue-updates-client";
import type { IssueWithRelations, User } from "@/types";

export async function IssueUpdatesSection({
  issue,
  currentUser,
}: {
  issue: Pick<IssueWithRelations, "id" | "status" | "assignee_id" | "reviewer_id" | "creator_id">;
  currentUser: User;
}) {
  const updates = await getIssueUpdatesAndComments(issue.id);
  return <IssueUpdatesClient issue={issue} updates={updates} currentUser={currentUser} />;
}
