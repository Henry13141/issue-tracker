import { SkeletonCard } from "@/components/skeleton-page";

export default function DashboardLoading() {
  return (
    <div>
      <div className="mb-6 space-y-2">
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-44 animate-pulse rounded bg-muted/60" />
      </div>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg border bg-muted/30" />
        <div className="h-64 animate-pulse rounded-lg border bg-muted/30" />
      </div>
    </div>
  );
}
