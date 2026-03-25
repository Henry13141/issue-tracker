import { SkeletonLine } from "@/components/skeleton-page";

export default function IssueDetailLoading() {
  return (
    <div>
      <div className="mb-6">
        <div className="h-8 w-20 animate-pulse rounded bg-muted" />
      </div>
      <div className="mb-6 h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4 rounded-lg border p-4">
          <SkeletonLine className="w-24" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="w-1/2" />
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
        </div>
        <div className="space-y-3 rounded-lg border p-4">
          <SkeletonLine className="w-32" />
          <div className="h-20 animate-pulse rounded bg-muted/30" />
          <div className="h-20 animate-pulse rounded bg-muted/30" />
          <div className="h-20 animate-pulse rounded bg-muted/30" />
        </div>
      </div>
    </div>
  );
}
