import type { IssuePriority, IssueStatus } from "@/types";

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  todo: "待处理",
  in_progress: "处理中",
  blocked: "卡住",
  pending_review: "待验证",
  resolved: "已解决",
  closed: "已关闭",
};

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

export const REMINDER_TYPE_LABELS: Record<string, string> = {
  no_update_today: "今日未更新",
  overdue: "超期",
  stale_3_days: "连续3天未更新",
};

export const ACTIVE_STATUSES: IssueStatus[] = [
  "in_progress",
  "blocked",
  "pending_review",
];

export const TERMINAL_STATUSES: IssueStatus[] = ["resolved", "closed"];
