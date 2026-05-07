import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getKnowledgeArticle } from "@/actions/knowledge";
import { getMembers } from "@/actions/members";
import { KnowledgeArticleForm } from "@/components/knowledge-article-form";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export default async function EditKnowledgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const article = await getKnowledgeArticle(id);
  if (!article) notFound();

  const isOwner = article.created_by === user.id || article.owner_id === user.id;
  const canEdit = user.role === "admin" || (isOwner && ["draft", "reviewing"].includes(article.status));

  if (!canEdit) {
    redirect(`/knowledge/${id}`);
  }

  const members = await getMembers();
  const memberOptions = members.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/knowledge/${id}`}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← 返回详情
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">编辑知识条目</h1>
        {article.status === "approved" && (
          <p className="mt-1 text-sm text-amber-600">
            注意：当前知识状态为「已确认」，修改后将自动存档旧版本。
          </p>
        )}
      </div>
      <KnowledgeArticleForm article={article} members={memberOptions} />
    </div>
  );
}
