import { getChinaDayBounds } from "@/lib/dates";
import type { IssueStatus } from "@/types";

const ACTIVE: IssueStatus[] = ["in_progress", "blocked", "pending_review", "pending_rework"];

/** YYYY-MM-DD in Asia/Shanghai for a given instant */
export function formatChinaDate(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${day}`;
}

export function chinaDateMinusDays(todayStr: string, n: number): string {
  const t0 = new Date(`${todayStr}T12:00:00+08:00`);
  const t1 = new Date(t0.getTime() - n * 86400000);
  return formatChinaDate(t1);
}

export function isActiveStatus(status: IssueStatus) {
  return ACTIVE.includes(status);
}

export { getChinaDayBounds };
