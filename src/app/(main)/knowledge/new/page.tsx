import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getMembers } from "@/actions/members";
import { KnowledgeArticleForm } from "@/components/knowledge-article-form";

export default async function NewKnowledgePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const members = await getMembers();
  const memberOptions = members.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">新建知识条目</h1>
        <p className="mt-1 text-sm text-muted-foreground">创建后状态为草稿，可提交审核后由管理员确认</p>
      </div>
      <KnowledgeArticleForm members={memberOptions} />
    </div>
  );
}
