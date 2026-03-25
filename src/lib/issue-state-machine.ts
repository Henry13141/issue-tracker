import type { IssueStatus } from "@/types";

/**
 * 合法状态流转表
 * key: 当前状态 → value: 允许切换到的目标状态列表
 */
export const STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  todo:           ["in_progress", "blocked", "closed"],
  in_progress:    ["blocked", "pending_review", "resolved", "closed"],
  blocked:        ["in_progress", "closed"],
  pending_review: ["in_progress", "resolved", "closed"],
  resolved:       ["closed", "in_progress"],
  closed:         ["in_progress"], // reopen
};

export type TransitionErrorCode =
  | "INVALID_TRANSITION"
  | "BLOCKED_REASON_REQUIRED"
  | "CLOSED_REASON_REQUIRED"
  | "UPDATE_REQUIRED";

export interface TransitionError {
  code: TransitionErrorCode;
  message: string;
}

/** 判断从 from → to 是否合法（相同状态视为无操作，直接通过） */
export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  if (from === to) return true;
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 完整校验状态切换的所有业务规则
 * 返回 null 表示校验通过；返回 TransitionError 说明失败原因
 */
export function validateTransition(
  from: IssueStatus,
  to: IssueStatus,
  opts: {
    blockedReason?: string | null;
    closedReason?: string | null;
    /** 当前 issue 是否已存在至少一条非系统生成的进度更新 */
    hasNonSystemUpdate?: boolean;
  }
): TransitionError | null {
  if (from === to) return null;

  if (!canTransition(from, to)) {
    return {
      code: "INVALID_TRANSITION",
      message: `不允许从「${statusLabel(from)}」切换到「${statusLabel(to)}」`,
    };
  }

  if (to === "blocked" && !opts.blockedReason?.trim()) {
    return {
      code: "BLOCKED_REASON_REQUIRED",
      message: "切换到「已阻塞」状态时，必须填写阻塞原因",
    };
  }

  if (to === "closed" && !opts.closedReason?.trim()) {
    return {
      code: "CLOSED_REASON_REQUIRED",
      message: "关闭问题时必须填写关闭原因",
    };
  }

  if (
    (to === "pending_review" || to === "resolved") &&
    opts.hasNonSystemUpdate === false
  ) {
    const label = to === "pending_review" ? "待验证" : "已解决";
    return {
      code: "UPDATE_REQUIRED",
      message: `切换到「${label}」状态前，至少需要存在一条人工进度更新`,
    };
  }

  return null;
}

/** 判断是否是 reopen 操作（closed → in_progress） */
export function isReopenTransition(from: IssueStatus, to: IssueStatus): boolean {
  return from === "closed" && to === "in_progress";
}

function statusLabel(s: IssueStatus): string {
  const labels: Record<IssueStatus, string> = {
    todo:           "待处理",
    in_progress:    "处理中",
    blocked:        "已阻塞",
    pending_review: "待验证",
    resolved:       "已解决",
    closed:         "已关闭",
  };
  return labels[s] ?? s;
}

/** 前端用：根据当前状态返回允许切换到的选项 */
export function getAllowedNextStatuses(current: IssueStatus): IssueStatus[] {
  return STATUS_TRANSITIONS[current] ?? [];
}
