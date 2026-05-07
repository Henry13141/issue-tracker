"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { User } from "@/types";
import { BookOpen, Lightbulb, ShieldCheck, Sparkles } from "lucide-react";

const tabs = [
  { href: "/knowledge",           label: "知识列表", icon: BookOpen,     exact: true },
  { href: "/knowledge/decisions", label: "决策记录", icon: Lightbulb,    exact: false },
  { href: "/knowledge/reviews",   label: "审核队列", icon: ShieldCheck,  exact: false, adminOnly: true },
  { href: "/knowledge/ask",       label: "AI 问答",  icon: Sparkles,     exact: false },
];

export function KnowledgeSubNav({ user }: { user: User }) {
  const pathname = usePathname();
  const isAdmin = user.role === "admin";

  return (
    <div className="flex gap-0.5 border-b">
      {tabs
        .filter((t) => !t.adminOnly || isAdmin)
        .map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Link>
          );
        })}
    </div>
  );
}
