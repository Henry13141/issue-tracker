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

/** 未完成（问题列表里「未完成」的全部状态，含待处理） */
export const INCOMPLETE_ISSUE_STATUSES: IssueStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "pending_review",
];

export const ISSUE_CATEGORIES = [
  "财务",
  "行政",
  "动作设计",
  "图片设计",
  "程序开发",
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export function isIssueCategory(value: string): value is IssueCategory {
  return ISSUE_CATEGORIES.includes(value as IssueCategory);
}

export const ISSUE_MODULES = [
  "立项与需求",
  "玩法与系统设计",
  "关卡与世界构建",
  "角色与动画",
  "UI 与交互",
  "美术资产生产",
  "特效与渲染",
  "音频与音乐",
  "程序框架与工具链",
  "核心玩法程序",
  "AI 与行为系统",
  "物理与运动",
  "网络与多人联机",
  "存档与数据系统",
  "平台与性能优化",
  "测试与质量保障",
  "构建发布与运维",
  "商业化与运营",
] as const;

export type IssueModule = (typeof ISSUE_MODULES)[number];

export function isIssueModule(value: string): value is IssueModule {
  return ISSUE_MODULES.includes(value as IssueModule);
}
