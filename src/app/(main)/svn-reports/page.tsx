import { getCurrentUser } from "@/lib/auth";
import { getSvnReports } from "@/actions/svn-reports";
import { SvnReportsClient } from "@/components/svn-reports-client";

export const metadata = { title: "研发日报" };

export default async function SvnReportsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const reportResult = await getSvnReports(60);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">研发日报</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          每天 18:50 自动从 SVN 仓库采集提交记录，由 AI 生成团队工作摘要
        </p>
      </div>
      <SvnReportsClient
        reports={reportResult.reports}
        setupMissing={reportResult.setupMissing}
        errorMessage={reportResult.errorMessage}
      />
    </div>
  );
}
