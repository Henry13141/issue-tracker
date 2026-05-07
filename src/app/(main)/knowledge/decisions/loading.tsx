import { SkeletonTable } from "@/components/skeleton-page";

export default function KnowledgeDecisionsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted/60" />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}
