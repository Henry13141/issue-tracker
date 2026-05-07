import type { User } from "@/types";

type FinanceOpsAccessUser = Pick<User, "role">;

export function canAccessFinanceOps(user: FinanceOpsAccessUser | null | undefined) {
  return Boolean(user && (user.role === "admin" || user.role === "finance"));
}

type SeedanceAccessUser = Pick<User, "role" | "can_access_seedance">;

export function canAccessSeedance(user: SeedanceAccessUser | null | undefined) {
  return Boolean(user && (user.role === "admin" || user.can_access_seedance));
}

export function getUserRoleLabel(role: User["role"]) {
  if (role === "admin") return "管理员";
  if (role === "finance") return "财务人员";
  return "成员";
}
