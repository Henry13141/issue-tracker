import { PageHeaderSkeleton, SkeletonTable } from "@/components/skeleton-page";

export default function RemindersLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <SkeletonTable rows={5} />
    </div>
  );
}
