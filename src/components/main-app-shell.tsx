"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Menu } from "lucide-react";
import { Sidebar, SidebarPanel } from "@/components/sidebar";
import { Button } from "@/components/ui/button";
import { AIAssistant } from "@/components/ai-assistant";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@/types";

export function MainAppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const interval = setInterval(() => {
      supabase.auth.getSession();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-[100dvh] min-h-0 overflow-hidden bg-background">
      <Sidebar user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sidebar-foreground shadow-sm md:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 shrink-0 border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => setMobileNavOpen(true)}
            aria-label="打开菜单"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <Image
              src="/mgm-logo.png"
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 object-contain drop-shadow-sm"
            />
            <span className="truncate text-sm font-semibold text-sidebar-foreground">协作推进台</span>
          </div>
        </header>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-6">
            {children}
          </div>
        </main>
      </div>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            aria-label="关闭菜单"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-sidebar-border bg-sidebar pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-xl md:hidden">
            <SidebarPanel user={user} onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </>
      ) : null}

      {/* AI 管理助理悬浮面板（仅管理员可见） */}
      {user.role === "admin" && <AIAssistant />}
    </div>
  );
}
