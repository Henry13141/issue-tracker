"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { LayoutDashboard, ListTodo, Bell, LogOut, ClipboardList, Users, Send } from "lucide-react";

const nav = [
  { href: "/dashboard",               label: "看板总览",   icon: LayoutDashboard, adminOnly: true },
  { href: "/members",                 label: "成员与钉钉", icon: Users,            adminOnly: true },
  { href: "/dashboard/notifications", label: "通知日志",   icon: Send,             adminOnly: true },
  { href: "/issues",                  label: "问题列表",   icon: ListTodo },
  { href: "/my-tasks",                label: "我的任务",   icon: ClipboardList },
  { href: "/reminders",               label: "待你回应",   icon: Bell },
];

export function Sidebar({ user }: { user: User }) {
  const pathname = usePathname();

  useEffect(() => {
    const supabase = createClient();
    const interval = setInterval(() => {
      supabase.auth.getSession();
    }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
        <Image src="/mgm-logo.png" alt="米伽米" width={36} height={36} className="h-9 w-9 object-contain" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">米伽米</p>
          <p className="text-xs text-sidebar-foreground/60">协作推进台</p>
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
      <div className="border-t border-sidebar-border" />
      <div className="flex items-center gap-2 p-3">
        <Avatar className="h-9 w-9 border border-sidebar-border">
          <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs">{initials || "?"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">{user.role === "admin" ? "管理员" : "成员"}</p>
        </div>
        <Button variant="ghost" size="icon" className="shrink-0 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent" onClick={signOut} title="退出">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}
