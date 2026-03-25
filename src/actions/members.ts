"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import type { User } from "@/types";

export const getMembers = cache(async (): Promise<User[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    if (error.message) console.error("getMembers:", error.message);
    return [];
  }
  return (data ?? []) as User[];
});

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
  return { ok: true };
}
