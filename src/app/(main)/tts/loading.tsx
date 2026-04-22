export default function TTSLoading() {
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <div className="h-12 w-12 animate-pulse rounded-full bg-muted" />
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="h-4 w-56 animate-pulse rounded bg-muted/60" />
    </div>
  );
}
