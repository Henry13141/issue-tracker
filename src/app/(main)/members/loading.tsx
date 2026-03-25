import { PageHeaderSkeleton, SkeletonTable } from "@/components/skeleton-page";

export default function MembersLoading() {
  return (
    <div>
      <PageHeaderSkeleton />
      <SkeletonTable rows={5} />
    </div>
  );
}
