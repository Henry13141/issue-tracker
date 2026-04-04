"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { User } from "@/types";

export function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

type UserLike = Pick<User, "name" | "avatar_url"> | null | undefined;

export function UserAvatar({
  user,
  className,
  fallbackClassName,
}: {
  user: UserLike;
  className?: string;
  fallbackClassName?: string;
}) {
  const name = user?.name ?? "";
  return (
    <Avatar className={cn(className)}>
      {user?.avatar_url ? (
        <AvatarImage src={user.avatar_url} alt="" className="object-cover" />
      ) : null}
      <AvatarFallback className={cn(fallbackClassName)}>{initialsFromName(name)}</AvatarFallback>
    </Avatar>
  );
}
