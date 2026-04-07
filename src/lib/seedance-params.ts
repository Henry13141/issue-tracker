/**
 * Seedance 视频生成参数约定（与火山方舟文档对齐，最终以接口返回为准）。
 * @see https://www.volcengine.com/docs/82379/1520757 — 创建视频生成任务 API
 * @see https://www.volcengine.com/docs/82379/1521309 — 查询视频生成任务 API
 * @see https://www.volcengine.com/docs/82379/2291680 — Seedance 2.0 系列教程
 */

export const SEEDANCE_MODEL_IDS = {
  /** 标准版（文档示例常用） */
  standard: "doubao-seedance-2-0-260128",
  /** 快速版（文档中的 fast 变体） */
  fast: "doubao-seedance-2-0-fast-260128",
} as const;

export type SeedanceModelId = (typeof SEEDANCE_MODEL_IDS)[keyof typeof SEEDANCE_MODEL_IDS];

export const DEFAULT_SEEDANCE_MODEL: SeedanceModelId = SEEDANCE_MODEL_IDS.standard;

/** 文档示例与控制台中出现的画幅；含 adaptive（由模型自适应）。 */
export const SEEDANCE_RATIO_OPTIONS = [
  "16:9",
  "9:16",
  "1:1",
  "3:4",
  "4:3",
  "21:9",
  "adaptive",
] as const;

export type SeedanceRatio = (typeof SEEDANCE_RATIO_OPTIONS)[number];

export const SEEDANCE_RESOLUTION_OPTIONS = ["480p", "720p"] as const;

export type SeedanceResolution = (typeof SEEDANCE_RESOLUTION_OPTIONS)[number];

/**
 * Seedance 2.0 官方教程列出的输出时长范围为 4–15 秒，最终仍以接口返回为准。
 */
export const SEEDANCE_20_DURATION = {
  minSeconds: 4,
  maxSeconds: 15,
  /** UI 快捷按钮（覆盖文档示例中的典型取值） */
  presets: [4, 5, 8, 10, 11, 15] as const,
  auto: -1,
} as const;

/** 官方文档中的多模态输入数量限制。 */
export const SEEDANCE_REFERENCE_LIMITS = {
  images: 9,
  videos: 3,
  audios: 3,
} as const;

export type SeedanceReferenceCounts = {
  images: number;
  videos: number;
  audios: number;
};

/** 异步任务轮询：文档未给固定 QPS；采用偏保守间隔并带抖动，遇 429 再退避。 */
export const SEEDANCE_POLL_INTERVAL_MS = 8000;
export const SEEDANCE_POLL_JITTER_MS = 1200;
export const SEEDANCE_POLL_429_BACKOFF_MAX_MS = 60_000;

export function isAllowedSeedanceModelId(model: string): model is SeedanceModelId {
  return (Object.values(SEEDANCE_MODEL_IDS) as string[]).includes(model);
}

export function isAllowedSeedanceRatio(ratio: string): ratio is SeedanceRatio {
  return (SEEDANCE_RATIO_OPTIONS as readonly string[]).includes(ratio);
}

export function isAllowedSeedanceResolution(
  resolution: string
): resolution is SeedanceResolution {
  return (SEEDANCE_RESOLUTION_OPTIONS as readonly string[]).includes(resolution);
}

export function isValidSeedance20DurationSeconds(duration: number): boolean {
  return (
    Number.isInteger(duration) &&
    duration >= SEEDANCE_20_DURATION.minSeconds &&
    duration <= SEEDANCE_20_DURATION.maxSeconds
  );
}

export function isValidSeedance20DurationValue(duration: number): boolean {
  return duration === SEEDANCE_20_DURATION.auto || isValidSeedance20DurationSeconds(duration);
}

export function canUseSeedanceWebSearch(counts: SeedanceReferenceCounts): boolean {
  return counts.images === 0 && counts.videos === 0 && counts.audios === 0;
}

export function validateSeedanceReferenceCounts(counts: SeedanceReferenceCounts): string | null {
  if (counts.images > SEEDANCE_REFERENCE_LIMITS.images) {
    return `参考图片最多支持 ${SEEDANCE_REFERENCE_LIMITS.images} 张。`;
  }
  if (counts.videos > SEEDANCE_REFERENCE_LIMITS.videos) {
    return `参考视频最多支持 ${SEEDANCE_REFERENCE_LIMITS.videos} 段。`;
  }
  if (counts.audios > SEEDANCE_REFERENCE_LIMITS.audios) {
    return `参考音频最多支持 ${SEEDANCE_REFERENCE_LIMITS.audios} 段。`;
  }
  if (counts.audios > 0 && counts.images === 0 && counts.videos === 0) {
    return "不支持仅用音频作为参考输入；请至少再提供 1 张图片或 1 段视频。";
  }
  return null;
}

export function nextPollDelayMs(baseMs: number, jitterMaxMs: number): number {
  return baseMs + Math.floor(Math.random() * jitterMaxMs);
}
