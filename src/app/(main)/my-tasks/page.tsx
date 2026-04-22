import Link from "next/link";
import { getMyTasksBundle } from "@/actions/issues";
import { getCurrentUser } from "@/lib/auth";
import { MyTasksClient } from "@/components/my-tasks-client";

export default async function MyTasksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { needUpdate, updatedToday, following } = await getMyTasksBundle();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">我的任务</h1>
        <p className="text-sm text-muted-foreground">
          你负责事项的完整列表与快速写进展；今日优先建议在{" "}
          <Link href="/home" className="text-primary underline-offset-4 hover:underline">
            工作台
          </Link>{" "}
          先看一眼再回来处理细节。
        </p>
      </div>
      <MyTasksClient needUpdate={needUpdate} updatedToday={updatedToday} following={following} />
    </div>
  );
}
