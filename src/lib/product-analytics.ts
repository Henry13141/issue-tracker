"use client";

import { track } from "@vercel/analytics";

/**
 * V3 优化相关自定义事件（Vercel Web Analytics）。
 * 事件名与属性需为扁平标量，见 @vercel/analytics track 约束。
 */
export function trackQuickIssueUpdateSubmit(source: string) {
  track("quick_issue_update_submit", { source });
}

export function trackDashboardInterventionClick(target: string) {
  track("dashboard_intervention_click", { target });
}
