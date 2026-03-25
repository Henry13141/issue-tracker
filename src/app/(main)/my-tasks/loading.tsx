import { PageHeaderSkeleton, SkeletonTable } from "@/components/skeleton-page";

export default function MyTasksLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <SkeletonTable rows={6} />
    </div>
  );
}
