/**
 * 工作时间工具（Asia/Shanghai，09:30–18:30）
 *
 * 用于通知发送的时间窗口控制：
 *   - isWithinBusinessHours()  判断当前是否在工作时间内
 *   - nextBusinessStart()      返回下一个工作时间开始点（下次 09:30 CST）
 */

export const WORK_START = { hour: 9,  minute: 30 } as const;
export const WORK_END   = { hour: 18, minute: 30 } as const;

/** 将 UTC 时间转换为上海时间各字段 */
function getShanghaiParts(now: Date): {
  year: number; month: number; day: number;
  hour: number; minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:  "Asia/Shanghai",
    year:      "numeric",
    month:     "2-digit",
    day:       "2-digit",
    hour:      "2-digit",
    minute:    "2-digit",
    hour12:    false,
  }).formatToParts(now);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year:   get("year"),
    month:  get("month"), // 1-12
    day:    get("day"),
    hour:   get("hour"),
    minute: get("minute"),
  };
}

/**
 * 当前时刻是否在工作时间内（09:30–18:30 上海时间）。
 * 工作时间不区分工作日/周末（如需区分可后续扩展）。
 */
export function isWithinBusinessHours(now = new Date()): boolean {
  const { hour, minute } = getShanghaiParts(now);
  const total      = hour * 60 + minute;
  const startTotal = WORK_START.hour * 60 + WORK_START.minute;
  const endTotal   = WORK_END.hour   * 60 + WORK_END.minute;
  return total >= startTotal && total < endTotal;
}

/**
 * 下一个工作时间开始点（上海时间 09:30）。
 * - 若当前上海时间 < 09:30，返回今天的 09:30
 * - 否则返回明天的 09:30
 */
export function nextBusinessStart(now = new Date()): Date {
  const { year, month, day, hour, minute } = getShanghaiParts(now);
  const total      = hour * 60 + minute;
  const startTotal = WORK_START.hour * 60 + WORK_START.minute;

  // 用带时区后缀的字符串构造 UTC 等价时间，避免手工计算偏移量
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const hh   = pad2(WORK_START.hour);
  const min  = pad2(WORK_START.minute);

  // 今天 09:30 CST
  const yyyy = String(year).padStart(4, "0");
  const mm   = pad2(month);
  const dd   = pad2(day);
  const todayStart = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:00+08:00`);

  if (total < startTotal) {
    // 今天的上班时间还未到
    return todayStart;
  } else {
    // 明天的上班时间（+24h，天然处理夏令时边界）
    return new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  }
}
