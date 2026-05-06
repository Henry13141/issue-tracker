import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MainAppShell } from "@/components/main-app-shell";
import { getCurrentUser } from "@/lib/auth";

type MainLayoutProps = {
  children: React.ReactNode;
};

function MainLayoutFallback() {
  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-background">
      <aside className="hidden h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
          <div className="h-9 w-9 animate-pulse rounded bg-sidebar-accent" />
          <div className="space-y-1">
            <div className="h-3 w-16 animate-pulse rounded bg-sidebar-accent" />
            <div className="h-2.5 w-20 animate-pulse rounded bg-sidebar-accent/70" />
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-sidebar-accent/60" />
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
          <div className="size-11 animate-pulse rounded-md bg-sidebar-accent/70" />
          <div className="h-5 w-28 animate-pulse rounded bg-sidebar-accent/70" />
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-6">
            <div className="space-y-2">
              <div className="h-7 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted/60" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/40" />
              ))}
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="h-64 animate-pulse rounded-lg border bg-muted/30" />
              <div className="h-64 animate-pulse rounded-lg border bg-muted/30" />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

async function AuthenticatedMainLayout({ children }: MainLayoutProps) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  return <MainAppShell user={user}>{children}</MainAppShell>;
}

export default function MainLayout({
  children,
}: MainLayoutProps) {
  return (
    <Suspense fallback={<MainLayoutFallback />}>
      <AuthenticatedMainLayout>{children}</AuthenticatedMainLayout>
    </Suspense>
  );
}
