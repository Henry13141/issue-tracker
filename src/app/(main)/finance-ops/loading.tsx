import { PageHeaderSkeleton } from "@/components/skeleton-page";

export default function FinanceOpsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* 模式 Tab 骨架 */}
      <div className="flex gap-2">
        <div className="h-9 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-24 animate-pulse rounded bg-muted" />
        <div className="h-9 w-24 animate-pulse rounded bg-muted" />
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap gap-2">
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-9 w-36 animate-pulse rounded bg-muted" />
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="mb-2 h-4 w-20 animate-pulse rounded bg-muted" />
            <div className="h-8 w-14 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* 主列表 */}
      <div className="space-y-2 rounded-lg border p-4">
        <div className="h-10 w-full animate-pulse rounded bg-muted/60" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-12 w-full animate-pulse rounded bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
