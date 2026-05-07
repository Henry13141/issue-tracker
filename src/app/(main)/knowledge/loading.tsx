import { SkeletonTable } from "@/components/skeleton-page";

export default function KnowledgeLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-36 animate-pulse rounded bg-muted" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted/60" />
      </div>
      <SkeletonTable rows={8} />
    </div>
  );
}
