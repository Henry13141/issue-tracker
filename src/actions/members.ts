"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import { getCachedMembers } from "@/lib/members-query";
import { notifyNewMemberWelcome } from "@/lib/new-member-welcome";
import { getMemberWorkload, getNotificationCoverage } from "@/lib/dashboard-queries";
import type { MemberWorkloadRow, NotificationCoverage } from "@/lib/dashboard-queries";
import type { User, UserRole } from "@/types";

const MEMBER_DEPENDENT_PATHS = [
  "/members",
  "/home",
  "/issues",
  "/my-tasks",
  "/dashboard",
  "/dashboard/notifications",
  "/dashboard/wecom-health",
  "/finance-ops",
];

function invalidateMembersCache() {
  updateTag("members");
  for (const path of MEMBER_DEPENDENT_PATHS) {
    revalidatePath(path);
  }
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

/** 获取成员列表；跨请求通过 Next 16 Cache Components 缓存 60 秒。 */
export async function getMembers(): Promise<User[]> {
  return getCachedMembers();
}

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
  invalidateMembersCache();
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
  invalidateMembersCache();
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
  invalidateMembersCache();
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

  invalidateMembersCache();
  return { ok: true };
}
