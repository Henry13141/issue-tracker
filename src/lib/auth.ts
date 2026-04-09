import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@/types";

/** 与中间件「有 Supabase 会话」相比，业务接口还要求 public.users 有对应行。 */
export type SessionGateResult =
  | { status: "ok"; user: User }
  | { status: "unauthenticated" }
  | { status: "profile_missing"; authUserId: string };

const resolveSessionUser = cache(async (): Promise<SessionGateResult> => {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return { status: "unauthenticated" };
  }

  let authUser;
  try {
    const { data } = await supabase.auth.getUser();
    authUser = data.user;
  } catch {
    return { status: "unauthenticated" };
  }
  if (!authUser) return { status: "unauthenticated" };

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error || !data) {
    return { status: "profile_missing", authUserId: authUser.id };
  }
  return { status: "ok", user: data as User };
});

/** 区分「未登录」与「已登录但 users 表无资料」；与 getCurrentUser 共用同一缓存。 */
export async function getSessionGate(): Promise<SessionGateResult> {
  return resolveSessionUser();
}

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const gate = await resolveSessionUser();
  return gate.status === "ok" ? gate.user : null;
});
