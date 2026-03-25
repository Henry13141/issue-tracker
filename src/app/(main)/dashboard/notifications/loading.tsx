export default function NotificationsLoading() {
  return (
    <div className="space-y-4">
      <div className="mb-6">
        <div className="h-8 w-48 rounded bg-muted animate-pulse mb-1" />
        <div className="h-4 w-80 rounded bg-muted animate-pulse" />
      </div>
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="grid grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-muted animate-pulse" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 rounded-lg border bg-card animate-pulse" />
        ))}
      </div>
    </div>
  );
}
