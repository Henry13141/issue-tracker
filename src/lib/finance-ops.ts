import type {
  FinanceTaskArea,
  FinanceTaskCadence,
  FinanceTaskDisplayStatus,
  FinanceTaskInstanceStatus,
  FinanceTaskInstanceWithTemplate,
  FinanceTaskTemplate,
} from "@/types";

export type FinanceOpsView = "month" | "quarter" | "year" | "overdue" | "all";

export const FINANCE_OPS_VIEW_LABELS: Record<FinanceOpsView, string> = {
  month: "本月",
  quarter: "本季度",
  year: "本年度",
  overdue: "已逾期",
  all: "全部",
};

export const FINANCE_TASK_CADENCE_LABELS: Record<FinanceTaskCadence, string> = {
  weekly: "每周",
  monthly: "每月",
  quarterly: "每季度",
  yearly: "每年",
};

export const FINANCE_TASK_AREA_LABELS: Record<FinanceTaskArea, string> = {
  finance: "财务",
  cashier: "出纳",
  admin_hr: "行政人事",
  other: "其他",
};

export const FINANCE_TASK_STATUS_LABELS: Record<FinanceTaskDisplayStatus, string> = {
  pending: "待处理",
  in_progress: "进行中",
  completed: "已完成",
  skipped: "已跳过",
  overdue: "已逾期",
};

const CLOSED_STATUSES = new Set<FinanceTaskInstanceStatus>(["completed", "skipped"]);
const QUARTER_MONTH_LABELS = ["首月", "次月", "末月"] as const;
const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

function pad(num: number) {
  return String(num).padStart(2, "0");
}

export function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateOnly(value: string) {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  return new Date(year, Math.max(0, month - 1), day, 12, 0, 0, 0);
}

export function getQuarter(date: Date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

export function startOfQuarter(date: Date) {
  const year = date.getFullYear();
  const month = Math.floor(date.getMonth() / 3) * 3;
  return new Date(year, month, 1, 12, 0, 0, 0);
}

export function endOfQuarter(date: Date) {
  const start = startOfQuarter(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0, 12, 0, 0, 0);
}

function startOfWeek(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function endOfWeek(date: Date) {
  const start = startOfWeek(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 12, 0, 0, 0);
}

function getWeekInfo(date: Date) {
  const weekStart = startOfWeek(date);
  const thursday = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 3, 12, 0, 0, 0);
  const isoYear = thursday.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4, 12, 0, 0, 0);
  const firstWeekStart = startOfWeek(firstThursday);
  const diffMs = weekStart.getTime() - firstWeekStart.getTime();
  const week = Math.floor(diffMs / 604_800_000) + 1;
  return { isoYear, week, weekStart };
}

function getDaysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0, 12, 0, 0, 0).getDate();
}

function clampDay(year: number, monthIndex: number, day: number) {
  return Math.min(Math.max(1, day), getDaysInMonth(year, monthIndex));
}

export function buildFinanceTaskPeriod(
  template: Pick<FinanceTaskTemplate, "cadence" | "due_weekday" | "due_day" | "due_month_in_quarter" | "due_month">,
  anchorDate: Date = new Date()
) {
  const year = anchorDate.getFullYear();

  if (template.cadence === "weekly") {
    const { isoYear, week, weekStart } = getWeekInfo(anchorDate);
    const weekday = Math.min(Math.max(template.due_weekday ?? 1, 1), 7);
    const dueDate = new Date(
      weekStart.getFullYear(),
      weekStart.getMonth(),
      weekStart.getDate() + (weekday - 1),
      12,
      0,
      0,
      0
    );
    return {
      periodKey: `${isoYear}-W${pad(week)}`,
      periodStart: toDateOnly(weekStart),
      periodEnd: toDateOnly(endOfWeek(anchorDate)),
      dueDate: toDateOnly(dueDate),
    };
  }

  if (template.cadence === "monthly") {
    const monthIndex = anchorDate.getMonth();
    const dueDate = new Date(year, monthIndex, clampDay(year, monthIndex, template.due_day), 12, 0, 0, 0);
    return {
      periodKey: `${year}-${pad(monthIndex + 1)}`,
      periodStart: toDateOnly(new Date(year, monthIndex, 1, 12, 0, 0, 0)),
      periodEnd: toDateOnly(new Date(year, monthIndex + 1, 0, 12, 0, 0, 0)),
      dueDate: toDateOnly(dueDate),
    };
  }

  if (template.cadence === "quarterly") {
    const quarter = getQuarter(anchorDate);
    const quarterStartMonth = (quarter - 1) * 3;
    const dueMonthIndex = quarterStartMonth + ((template.due_month_in_quarter ?? 1) - 1);
    const dueDate = new Date(year, dueMonthIndex, clampDay(year, dueMonthIndex, template.due_day), 12, 0, 0, 0);
    return {
      periodKey: `${year}-Q${quarter}`,
      periodStart: toDateOnly(new Date(year, quarterStartMonth, 1, 12, 0, 0, 0)),
      periodEnd: toDateOnly(new Date(year, quarterStartMonth + 3, 0, 12, 0, 0, 0)),
      dueDate: toDateOnly(dueDate),
    };
  }

  const dueMonthIndex = Math.max(0, (template.due_month ?? 1) - 1);
  const dueDate = new Date(year, dueMonthIndex, clampDay(year, dueMonthIndex, template.due_day), 12, 0, 0, 0);
  return {
    periodKey: `${year}`,
    periodStart: toDateOnly(new Date(year, 0, 1, 12, 0, 0, 0)),
    periodEnd: toDateOnly(new Date(year, 11, 31, 12, 0, 0, 0)),
    dueDate: toDateOnly(dueDate),
  };
}

export function formatFinanceCadenceRule(
  template: Pick<FinanceTaskTemplate, "cadence" | "due_weekday" | "due_day" | "due_month_in_quarter" | "due_month">
) {
  if (template.cadence === "weekly") {
    return `每周 ${WEEKDAY_LABELS[Math.max(0, (template.due_weekday ?? 1) - 1)] ?? "周一"}`;
  }
  if (template.cadence === "monthly") {
    return `每月 ${template.due_day} 号`;
  }
  if (template.cadence === "quarterly") {
    const quarterMonthLabel = QUARTER_MONTH_LABELS[Math.max(0, (template.due_month_in_quarter ?? 1) - 1)] ?? "当季";
    return `每季度${quarterMonthLabel} ${template.due_day} 号`;
  }
  return `每年 ${template.due_month ?? 1} 月 ${template.due_day} 号`;
}

export function isFinanceTaskClosedStatus(status: FinanceTaskInstanceStatus) {
  return CLOSED_STATUSES.has(status);
}

export function isFinanceTaskOverdue(
  instance: Pick<FinanceTaskInstanceWithTemplate, "due_date" | "status">,
  todayDate: string = toDateOnly(new Date())
) {
  return !isFinanceTaskClosedStatus(instance.status) && instance.due_date < todayDate;
}

export function getFinanceTaskDisplayStatus(
  instance: Pick<FinanceTaskInstanceWithTemplate, "due_date" | "status">,
  todayDate: string = toDateOnly(new Date())
): FinanceTaskDisplayStatus {
  return isFinanceTaskOverdue(instance, todayDate) ? "overdue" : instance.status;
}

export function formatFinancePeriodLabel(
  instance: Pick<FinanceTaskInstanceWithTemplate, "period_key" | "source"> & {
    template?: Pick<FinanceTaskTemplate, "cadence"> | null;
  }
) {
  if (instance.source === "manual") {
    return "临时待办";
  }
  const cadence = instance.template?.cadence;
  if (cadence === "monthly") {
    const [year, month] = instance.period_key.split("-");
    return `${year} 年 ${Number(month)} 月`;
  }
  if (cadence === "weekly") {
    const [year, week] = instance.period_key.split("-W");
    return `${year} 年第 ${Number(week)} 周`;
  }
  if (cadence === "quarterly") {
    const [year, quarter] = instance.period_key.split("-Q");
    return `${year} 年第 ${quarter} 季度`;
  }
  return `${instance.period_key} 年度`;
}

export function matchesFinanceOpsView(
  instance: Pick<FinanceTaskInstanceWithTemplate, "due_date" | "status">,
  view: FinanceOpsView,
  today: Date = new Date()
) {
  if (view === "all") return true;
  if (view === "overdue") return isFinanceTaskOverdue(instance, toDateOnly(today));

  const dueDate = parseDateOnly(instance.due_date);
  const dueYear = dueDate.getFullYear();
  const currentYear = today.getFullYear();

  if (view === "year") {
    return dueYear === currentYear;
  }

  if (view === "month") {
    return dueYear === currentYear && dueDate.getMonth() === today.getMonth();
  }

  const start = startOfQuarter(today);
  const end = endOfQuarter(today);
  return dueDate >= start && dueDate <= end;
}

export function sortFinanceInstances(a: FinanceTaskInstanceWithTemplate, b: FinanceTaskInstanceWithTemplate) {
  const aDisplay = getFinanceTaskDisplayStatus(a);
  const bDisplay = getFinanceTaskDisplayStatus(b);
  const aUrgentScore = aDisplay === "overdue" ? 0 : isFinanceTaskClosedStatus(a.status) ? 2 : 1;
  const bUrgentScore = bDisplay === "overdue" ? 0 : isFinanceTaskClosedStatus(b.status) ? 2 : 1;
  if (aUrgentScore !== bUrgentScore) return aUrgentScore - bUrgentScore;
  if (a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  return (a.title ?? a.template?.title ?? "").localeCompare(b.title ?? b.template?.title ?? "", "zh-CN");
}
