import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getReviewRequests } from "@/actions/knowledge";
import { KnowledgeReviewsClient } from "@/components/knowledge-reviews-client";

export default async function KnowledgeReviewsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/knowledge");

  const requests = await getReviewRequests();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">知识审核</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          审核成员提交的知识条目，通过后状态变为「已确认」
        </p>
      </div>
      <KnowledgeReviewsClient requests={requests} />
    </div>
  );
}
