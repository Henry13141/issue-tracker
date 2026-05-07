import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import {
  getKnowledgeArticle,
  getKnowledgeVersions,
  getArticleIssueLinks,
} from "@/actions/knowledge";
import { getDecisionsByArticle } from "@/actions/knowledge-decisions";
import { KnowledgeDetailClient } from "@/components/knowledge-detail-client";
import { KnowledgeVersionHistory } from "@/components/knowledge-version-history";
import { KnowledgeArticleIssueLinks } from "@/components/knowledge-article-issue-links";
import { KnowledgeArticleDecisions } from "@/components/knowledge-article-decisions";
import { SkeletonLine } from "@/components/skeleton-page";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";

export default async function KnowledgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) notFound();

  const article = await getKnowledgeArticle(id);
  if (!article) notFound();

  const isOwner = article.created_by === user.id || article.owner_id === user.id;
  const canEdit = user.role === "admin" || (isOwner && ["draft", "reviewing"].includes(article.status));

  // 版本历史 + issue 关联 + 决策 并行加载
  const [versions, issueLinks, decisions] = await Promise.all([
    getKnowledgeVersions(id),
    getArticleIssueLinks(id),
    getDecisionsByArticle(id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/knowledge"
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          ← 返回列表
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
      </div>

      {/* 元信息 + 操作区 */}
      <KnowledgeDetailClient article={article} currentUser={user} />

      <Separator />

      {/* 正文 */}
      <div className="prose prose-sm dark:prose-invert max-w-none">
        {/* Markdown 渲染：以 pre 临时展示，后续可接入 react-markdown */}
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
          {article.content}
        </pre>
      </div>

      <Separator />

      {/* 关联 Issue */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">关联任务</h2>
        <KnowledgeArticleIssueLinks
          articleId={id}
          links={issueLinks}
          canEdit={canEdit}
        />
      </section>

      <Separator />

      {/* 关联决策 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">关联决策</h2>
        <KnowledgeArticleDecisions decisions={decisions} />
      </section>

      <Separator />

      {/* 版本历史 */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">版本历史</h2>
        <Suspense fallback={<SkeletonLine className="w-full" />}>
          <KnowledgeVersionHistory versions={versions} currentVersion={article.version} />
        </Suspense>
      </section>
    </div>
  );
}
