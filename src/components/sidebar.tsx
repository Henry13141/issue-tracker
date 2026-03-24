"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { LayoutDashboard, ListTodo, Bell, LogOut, ClipboardList } from "lucide-react";

const nav = [
  { href: "/dashboard", label: "看板总览", icon: LayoutDashboard, adminOnly: true },
  { href: "/issues", label: "问题列表", icon: ListTodo },
  { href: "/my-tasks", label: "我的任务", icon: ClipboardList },
  { href: "/reminders", label: "提醒中心", icon: Bell },
];

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initials = user.name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
          IT
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold">问题跟踪</p>
          <p className="text-xs text-muted-foreground">内部催办</p>
        </div>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 p-2">
        {nav
          .filter((item) => !item.adminOnly || user.role === "admin")
          .map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
      </nav>
      <Separator />
      <div className="flex items-center gap-2 p-3">
        <Avatar className="h-9 w-9">
          <AvatarFallback>{initials || "?"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.role === "admin" ? "管理员" : "成员"}</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0" onClick={signOut} title="退出">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
