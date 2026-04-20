import { SEEDANCE_MODEL_IDS, type SeedanceRatio, type SeedanceResolution } from "@/lib/seedance-params";

type FixedRatio = Exclude<SeedanceRatio, "adaptive">;

/**
 * 定价来源：https://www.volcengine.com/docs/82379/1544106
 * Seedance 2.0 标准版在 1080p 分辨率下有独立价格档位；
 * Fast 版不支持 1080p。
 */
const SEEDANCE_TOKEN_PRICES: Record<
  string,
  {
    withoutVideo: number;
    withVideo: number;
    /** 1080p 时无视频输入单价（元/百万 tokens），仅标准版支持 1080p */
    withoutVideo1080p?: number;
    /** 1080p 时含视频输入单价（元/百万 tokens），仅标准版支持 1080p */
    withVideo1080p?: number;
  }
> = {
  [SEEDANCE_MODEL_IDS.standard]: {
    withoutVideo: 46,
    withVideo: 28,
    withoutVideo1080p: 51,
    withVideo1080p: 31,
  },
  [SEEDANCE_MODEL_IDS.fast]: {
    withoutVideo: 37,
    withVideo: 22,
    // fast 不支持 1080p，无需额外档位
  },
};

const SEEDANCE_OUTPUT_PIXELS: Record<SeedanceResolution, Record<FixedRatio, { width: number; height: number }>> = {
  "480p": {
    "16:9": { width: 864, height: 496 },
    "4:3": { width: 752, height: 560 },
    "1:1": { width: 640, height: 640 },
    "3:4": { width: 560, height: 752 },
    "9:16": { width: 496, height: 864 },
    "21:9": { width: 992, height: 432 },
  },
  "720p": {
    "16:9": { width: 1280, height: 720 },
    "4:3": { width: 1112, height: 834 },
    "1:1": { width: 960, height: 960 },
    "3:4": { width: 834, height: 1112 },
    "9:16": { width: 720, height: 1280 },
    "21:9": { width: 1470, height: 630 },
  },
  // seedance 2.0 standard 支持；fast 不支持（已在 isResolutionAllowedForModel 中限制）
  "1080p": {
    "16:9": { width: 1920, height: 1080 },
    "4:3": { width: 1664, height: 1248 },
    "1:1": { width: 1440, height: 1440 },
    "3:4": { width: 1248, height: 1664 },
    "9:16": { width: 1080, height: 1920 },
    "21:9": { width: 2206, height: 946 },
  },
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

export function getSeedanceUnitPriceYuanPerMillionTokens(
  model: string,
  hasVideoInput: boolean,
  resolution?: string
): number | null {
  const price = SEEDANCE_TOKEN_PRICES[model];
  if (!price) return null;
  if (resolution === "1080p") {
    if (hasVideoInput && price.withVideo1080p != null) return price.withVideo1080p;
    if (!hasVideoInput && price.withoutVideo1080p != null) return price.withoutVideo1080p;
  }
  return hasVideoInput ? price.withVideo : price.withoutVideo;
}

export function getSeedanceOutputPixels(
  resolution: SeedanceResolution,
  ratio: FixedRatio
): { width: number; height: number } {
  return SEEDANCE_OUTPUT_PIXELS[resolution][ratio];
}

export function estimateSeedance20TokensFromOutput(params: {
  resolution: SeedanceResolution;
  ratio: FixedRatio;
  durationSeconds: number;
}): number {
  const { width, height } = getSeedanceOutputPixels(params.resolution, params.ratio);
  return (params.durationSeconds * width * height * 24) / 1024;
}

export function estimateSeedance20CostFromOutputOnly(params: {
  model: string;
  resolution: SeedanceResolution;
  ratio: FixedRatio;
  durationSeconds: number;
}): { estimatedTokens: number; estimatedCostYuan: number; unitPriceYuanPerMillionTokens: number } | null {
  // 输入不含视频；resolution 影响 1080p 定价档位（仅标准版）
  const unitPriceYuanPerMillionTokens = getSeedanceUnitPriceYuanPerMillionTokens(
    params.model,
    false,
    params.resolution
  );
  if (unitPriceYuanPerMillionTokens == null) return null;
  const estimatedTokens = estimateSeedance20TokensFromOutput(params);
  return {
    estimatedTokens,
    estimatedCostYuan: (estimatedTokens / 1_000_000) * unitPriceYuanPerMillionTokens,
    unitPriceYuanPerMillionTokens,
  };
}

export function extractSeedanceUsageTokens(payload: unknown): number | null {
  const root = asRecord(payload);
  const usage = asRecord(root?.usage);
  return (
    readFiniteNumber(usage, ["total_tokens", "tokens", "completion_tokens"]) ??
    readFiniteNumber(root, ["total_tokens", "tokens"])
  );
}

export function payloadContainsReferenceVideo(payload: unknown): boolean {
  if (Array.isArray(payload)) {
    return payload.some((item) => payloadContainsReferenceVideo(item));
  }

  const record = asRecord(payload);
  if (!record) return false;

  if (record.role === "reference_video" || record.type === "video_url") {
    return true;
  }

  return Object.values(record).some((value) => payloadContainsReferenceVideo(value));
}

export function estimateSeedance20TaskCostFromUsage(
  model: string,
  payload: unknown,
  resolution?: string
) {
  const usageTokens = extractSeedanceUsageTokens(payload);
  if (usageTokens == null) return null;

  const hasVideoInput = payloadContainsReferenceVideo(payload);
  const unitPriceYuanPerMillionTokens = getSeedanceUnitPriceYuanPerMillionTokens(
    model,
    hasVideoInput,
    resolution
  );
  if (unitPriceYuanPerMillionTokens == null) return null;

  return {
    usageTokens,
    hasVideoInput,
    unitPriceYuanPerMillionTokens,
    estimatedCostYuan: (usageTokens / 1_000_000) * unitPriceYuanPerMillionTokens,
  };
}
