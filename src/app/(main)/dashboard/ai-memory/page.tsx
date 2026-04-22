import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getAllMemories } from "@/lib/ai-memory";
import { AIMemoryClient } from "@/components/ai-memory-client";
import type { AIMemoryEntry } from "@/lib/ai-memory";

export default async function AIMemoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/dashboard");

  const memories = await getAllMemories();

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
              ← 驾驶舱
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">AI 组织记忆</h1>
          <p className="text-sm text-muted-foreground">
            AI 助理通过每日学习积累的关于团队、成员、项目和协作规律的认知
          </p>
        </div>
      </div>

      <AIMemoryClient initialMemories={memories as AIMemoryEntry[]} />
    </div>
  );
}
