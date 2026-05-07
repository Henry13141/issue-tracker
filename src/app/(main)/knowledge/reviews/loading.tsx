import { SkeletonTable } from "@/components/skeleton-page";

export default function KnowledgeReviewsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-28 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
      </div>
      <SkeletonTable rows={4} />
    </div>
  );
}
