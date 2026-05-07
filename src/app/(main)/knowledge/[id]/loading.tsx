import { SkeletonLine } from "@/components/skeleton-page";

export default function KnowledgeDetailLoading() {
  return (
    <div className="space-y-6">
      <SkeletonLine className="w-24" />
      <SkeletonLine className="w-2/3" />
      <div className="space-y-2">
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-5/6" />
        <SkeletonLine className="w-4/5" />
        <SkeletonLine className="w-full" />
        <SkeletonLine className="w-3/4" />
      </div>
    </div>
  );
}
