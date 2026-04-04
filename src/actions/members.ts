"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";
import { getMemberWorkload, getNotificationCoverage } from "@/lib/dashboard-queries";
import type { MemberWorkloadRow, NotificationCoverage } from "@/lib/dashboard-queries";
import type { User } from "@/types";

export async function getMemberWorkloadForPage(): Promise<MemberWorkloadRow[]> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return [];
  return getMemberWorkload();
}

export async function getNotificationCoverageForPage(): Promise<NotificationCoverage> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return { total: 0, withWecom: 0, withoutWecom: 0, coverageRate: 0 };
  return getNotificationCoverage();
}

export const getMembers = cache(async (): Promise<User[]> => {
  let supabase;
  try {
    supabase = await createClient();
  } catch (e) {
    console.error("getMembers: createClient", e);
    return [];
  }
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

export async function updateUserName(
  userId: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { ok: false, error: "无权限" };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "名称不能为空" };
  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ name: trimmed })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
}

export async function removeMember(
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") return { ok: false, error: "无权限" };
  if (me.id === userId) return { ok: false, error: "不能移除自己" };
  const admin = createAdminClient();
  // 同时删除 Auth 用户（级联删除 users 表记录）
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/members");
  return { ok: true };
}

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
