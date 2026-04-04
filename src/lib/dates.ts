/** Bounds for "today" in Asia/Shanghai (for daily update / reminder logic). */
export function getChinaDayBounds() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  const dateStr = `${y}-${m}-${d}`;
  const startIso = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
  const endIso = new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();
  return { startIso, endIso, dateStr };
}

/** 上海时区星期：0=周日 … 6=周六（与 Date.getDay 一致） */
export function getChinaWeekday(now = new Date()): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday:  "short",
  }).format(now);
  const map: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  return map[short] ?? 0;
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(iso));
}

export function formatDateOnly(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeZone: "Asia/Shanghai",
  }).format(new Date(iso));
}

/**
 * 自账号创建日起，按 Asia/Shanghai 日历计算的「入职第几天」。
 * 创建当日为第 1 天。
 */
export function getTenureDays(createdAtIso: string): number {
  const start = new Date(createdAtIso);
  const now = new Date();
  const tz = "Asia/Shanghai";
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const a = fmt(start);
  const b = fmt(now);
  const t0 = new Date(`${a}T00:00:00+08:00`).getTime();
  const t1 = new Date(`${b}T00:00:00+08:00`).getTime();
  const diff = Math.floor((t1 - t0) / 86_400_000);
  return Math.max(1, diff + 1);
}
