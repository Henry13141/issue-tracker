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

type SeedancePromptLayoutDiagnosticEvent = {
  trigger: "auto_scrollbar_overlap" | "manual_report";
  promptLengthBucket: "0" | "1_80" | "81_160" | "161_320" | "321_plus";
  mentionCountBucket: "0" | "1" | "2_3" | "4_plus";
  hasVerticalScrollbar: "yes" | "no";
  scrollbarWidthBucket: "0" | "1_12" | "13_20" | "21_plus";
  widthMismatchBucket: "0" | "1_8" | "9_20" | "21_plus";
};

export function trackSeedancePromptLayoutDiagnostic(
  event: SeedancePromptLayoutDiagnosticEvent
) {
  track("seedance_prompt_layout_diagnostic", event);
}
