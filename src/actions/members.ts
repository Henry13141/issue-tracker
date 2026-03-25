"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";
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

export async function updateUserWecomUserId(
  userId: string,
  wecomUserid: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { ok: false, error: "无权限" };
  }
  const trimmed = wecomUserid.trim();
  const supabase = await createClient();
  const { data: beforeRow } = await supabase
    .from("users")
    .select("name, wecom_userid")
    .eq("id", userId)
    .single();

  const hadWecom = Boolean((beforeRow?.wecom_userid as string | null)?.trim());
  const { error } = await supabase
    .from("users")
    .update({ wecom_userid: trimmed === "" ? null : trimmed })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  if (trimmed && !hadWecom) {
    notifyNewMemberWelcome(trimmed, (beforeRow?.name as string) || "同事");
  }
  revalidatePath("/members");
  return { ok: true };
}
