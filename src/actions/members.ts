"use server";

import { revalidatePath } from "next/cache";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@/types";

const getCachedMembers = unstable_cache(
  async (): Promise<User[]> => {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      if (error.message) console.error("getMembers:", error.message);
      return [];
    }
    return (data ?? []) as User[];
  },
  ["members-list"],
  { revalidate: 60, tags: ["members"] }
);

export async function getMembers(): Promise<User[]> {
  return getCachedMembers();
}

export async function updateUserDingtalkUserId(
  userId: string,
  dingtalkUserid: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { ok: false, error: "无权限" };
  }
  const trimmed = dingtalkUserid.trim();
  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({ dingtalk_userid: trimmed === "" ? null : trimmed })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath("/members");
  revalidatePath("/issues");
  return { ok: true };
}
