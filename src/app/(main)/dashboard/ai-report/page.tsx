import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { AILongTermReport } from "@/components/ai-longterm-report";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AIReportPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.role !== "admin") redirect("/issues");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          管理驾驶舱
        </Link>
      </div>

      <AILongTermReport />
    </div>
  );
}
