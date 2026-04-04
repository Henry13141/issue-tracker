export default function HomeLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 max-w-2xl animate-pulse rounded-xl bg-muted" />
      </div>
      <div>
        <div className="mb-3 h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="mb-2 h-4 w-20 animate-pulse rounded bg-muted" />
              <div className="h-9 w-12 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-lg border lg:col-span-2">
          <div className="space-y-2 border-b p-6">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          </div>
          <div className="space-y-3 p-6">
            <div className="h-14 w-full animate-pulse rounded bg-muted" />
            <div className="h-14 w-full animate-pulse rounded bg-muted" />
            <div className="h-14 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="rounded-lg border p-6">
          <div className="mb-3 h-4 w-20 animate-pulse rounded bg-muted" />
          <div className="h-10 w-full animate-pulse rounded bg-muted" />
          <div className="mt-2 h-10 w-full animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
