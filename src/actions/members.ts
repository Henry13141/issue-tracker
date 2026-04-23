"use server";

import { cache } from "react";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";

// 此版本的 Next.js (>=16) revalidateTag 需要第二个 profile 参数
const invalidateMembersCache = () => revalidateTag("members", {});
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

/**
 * 内部实现：从 DB 拉取成员列表。
 * 使用 unstable_cache 在请求之间缓存 60 秒，避免每次页面导航重复查询。
 * 当成员数据变更（增/删/改角色）时通过 revalidateTag("members") 失效缓存。
 */
const fetchMembersFromDB = unstable_cache(
  async (): Promise<User[]> => {
    // unstable_cache 内部不能调用 cookies()，必须用 admin client（service role key）
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
  },
  ["members-list"],
  { revalidate: 60, tags: ["members"] }
);

/** 获取成员列表；同一请求内通过 React cache 去重，跨请求通过 unstable_cache 缓存 60 秒。 */
export const getMembers = cache(fetchMembersFromDB);

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
  invalidateMembersCache();
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
  invalidateMembersCache();
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

  invalidateMembersCache();
  revalidatePath("/members");
  revalidatePath("/finance-ops");
  return { ok: true };
}
