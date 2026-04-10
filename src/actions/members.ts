"use server";

import { cache } from "react";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";
import { getMemberWorkload, getNotificationCoverage } from "@/lib/dashboard-queries";
import type { MemberWorkloadRow, NotificationCoverage } from "@/lib/dashboard-queries";
import type { User, UserRole } from "@/types";

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
      `[getMembers] Supabase 网络请求失败（多为瞬时网络/DNS/防火墙；已降级为空列表）`,
      cause instanceof Error ? cause.message : cause != null ? String(cause) : ""
    );
    return;
  }

  console.error(`[getMembers:${scope}]`, err);
}

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

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me || me.role !== "admin") {
    return { ok: false, error: "无权限" };
  }
  if (!["admin", "finance", "member"].includes(role)) {
    return { ok: false, error: "角色无效" };
  }
  if (me.id === userId && role !== "admin") {
    return { ok: false, error: "不能取消自己的管理员角色" };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({
      role,
      can_access_finance_ops: role === "finance",
    })
    .eq("id", userId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/members");
  revalidatePath("/finance-ops");
  return { ok: true };
}
