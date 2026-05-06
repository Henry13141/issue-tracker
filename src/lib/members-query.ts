import { cacheLife, cacheTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@/types";

function logMembersQueryError(scope: string, err: unknown) {
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : String(err ?? "");
  const cause =
    typeof err === "object" && err !== null && "cause" in err
      ? (err as { cause?: unknown }).cause
      : undefined;

  if (message.includes("fetch failed")) {
    console.warn(
      "[getMembers] Supabase 网络请求失败（多为瞬时网络/DNS/防火墙；已降级为空列表）",
      cause instanceof Error ? cause.message : cause != null ? String(cause) : ""
    );
    return;
  }

  console.error(`[getMembers:${scope}]`, err);
}

/** Cached cross-request member list. Invalidated by updateTag("members"). */
export async function getCachedMembers(): Promise<User[]> {
  "use cache";
  cacheTag("members");
  cacheLife({ stale: 60, revalidate: 60, expire: 3600 });

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (error) {
    logMembersQueryError("createClient", error);
    return [];
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      logMembersQueryError("query", error);
      return [];
    }

    return (data ?? []) as User[];
  } catch (error) {
    logMembersQueryError("query", error);
    return [];
  }
}
