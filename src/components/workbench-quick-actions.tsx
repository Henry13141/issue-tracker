"use client";

import Link from "next/link";
import { ClipboardList, ListTodo, Bell, Sparkles } from "lucide-react";
import { IssueFormDialog } from "@/components/issue-form-dialog";
import type { User } from "@/types";
import { buttonVariants } from "@/lib/button-variants";
import { cn } from "@/lib/utils";

export function WorkbenchQuickActions({
  members,
  currentUser,
}: {
  members: User[];
  currentUser: User;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">快捷入口</p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <IssueFormDialog members={members} currentUser={currentUser} />
        </div>
        <Link
          href="/my-tasks"
          className={cn(buttonVariants({ variant: "outline" }), "justify-start gap-2")}
        >
          <ClipboardList className="h-4 w-4" />
          我的任务
        </Link>
        <Link
          href="/issues"
          className={cn(buttonVariants({ variant: "outline" }), "justify-start gap-2")}
        >
          <ListTodo className="h-4 w-4" />
          问题列表
        </Link>
        <Link
          href="/reminders"
          className={cn(buttonVariants({ variant: "outline" }), "justify-start gap-2")}
        >
          <Bell className="h-4 w-4" />
          待你回应
        </Link>
        <Link
          href="/seedance"
          className={cn(buttonVariants({ variant: "outline" }), "justify-start gap-2")}
        >
          <Sparkles className="h-4 w-4" />
          Seedance 2.0 体验
        </Link>
      </div>
    </div>
  );
}
