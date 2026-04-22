import { SkeletonCard } from "@/components/skeleton-page";

export default function WecomHealthLoading() {
  return (
    <div className="space-y-8">
      {/* 标题 */}
      <div className="space-y-1">
        <div className="h-7 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-96 animate-pulse rounded bg-muted/60" />
      </div>

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* 健康详情 */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />
      </div>

      {/* 成员列表 */}
      <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />
    </div>
  );
}
