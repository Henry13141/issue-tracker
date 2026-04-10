import type { User } from "@/types";

type FinanceOpsAccessUser = Pick<User, "role">;

export function canAccessFinanceOps(user: FinanceOpsAccessUser | null | undefined) {
  return Boolean(user && (user.role === "admin" || user.role === "finance"));
}

export function getUserRoleLabel(role: User["role"]) {
  if (role === "admin") return "管理员";
  if (role === "finance") return "财务人员";
  return "成员";
}
