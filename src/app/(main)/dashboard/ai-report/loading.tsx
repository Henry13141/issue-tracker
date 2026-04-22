export default function AIReportLoading() {
  return (
    <div className="space-y-6">
      {/* 面包屑 */}
      <div className="h-4 w-24 animate-pulse rounded bg-muted/60" />

      {/* 标题 */}
      <div className="space-y-2">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted/60" />
      </div>

      {/* 报告内容区域 */}
      <div className="rounded-xl border p-6 space-y-4">
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className={`h-4 animate-pulse rounded bg-muted/50 ${i % 3 === 2 ? "w-2/3" : "w-full"}`}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-xl border bg-muted/30" />
        <div className="h-40 animate-pulse rounded-xl border bg-muted/30" />
      </div>
    </div>
  );
}
