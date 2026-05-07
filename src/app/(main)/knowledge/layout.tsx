import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KnowledgeSubNav } from "@/components/knowledge-sub-nav";

export default async function KnowledgeLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-6">
      <Suspense>
        <KnowledgeSubNav user={user} />
      </Suspense>
      {children}
    </div>
  );
}
