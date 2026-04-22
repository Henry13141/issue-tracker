export default function AIMemoryLoading() {
  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="space-y-1">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
      </div>

      {/* 分类 Tab */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-muted" />
        ))}
      </div>

      {/* 记忆卡片列表 */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 animate-pulse rounded bg-muted/60" />
            </div>
            <div className="h-4 w-full animate-pulse rounded bg-muted/50" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
          </div>
        ))}
      </div>
    </div>
  );
}
