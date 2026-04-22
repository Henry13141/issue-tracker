export default function SeedanceLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-2 pb-16 sm:px-4">
      {/* 标题区 */}
      <div className="space-y-3">
        <div className="h-7 w-32 animate-pulse rounded-full bg-muted" />
        <div className="h-10 w-72 animate-pulse rounded bg-muted" />
        <div className="h-5 w-full max-w-lg animate-pulse rounded bg-muted/60" />
      </div>

      {/* 输入区 */}
      <div className="space-y-3 rounded-xl border p-6">
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="h-24 w-full animate-pulse rounded-lg bg-muted/50" />
        <div className="flex gap-3">
          <div className="h-9 w-32 animate-pulse rounded bg-muted" />
          <div className="h-9 w-32 animate-pulse rounded bg-muted" />
          <div className="ml-auto h-9 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>

      {/* 视频预览区 */}
      <div className="h-64 w-full animate-pulse rounded-xl border bg-muted/30" />
    </div>
  );
}
