import { PageHeaderSkeleton, SkeletonTable } from "@/components/skeleton-page";

export default function IssuesLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <div className="mb-4 flex gap-2">
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-9 w-48 animate-pulse rounded bg-muted" />
      </div>
      <SkeletonTable rows={10} />
    </div>
  );
}
