import { SEEDANCE_MODEL_IDS, type SeedanceRatio, type SeedanceResolution } from "@/lib/seedance-params";

type FixedRatio = Exclude<SeedanceRatio, "adaptive">;

const SEEDANCE_TOKEN_PRICES: Record<
  string,
  {
    withoutVideo: number;
    withVideo: number;
  }
> = {
  [SEEDANCE_MODEL_IDS.standard]: {
    withoutVideo: 46,
    withVideo: 28,
  },
  [SEEDANCE_MODEL_IDS.fast]: {
    withoutVideo: 37,
    withVideo: 22,
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

export function getSeedanceUnitPriceYuanPerMillionTokens(model: string, hasVideoInput: boolean): number | null {
  const price = SEEDANCE_TOKEN_PRICES[model];
  if (!price) return null;
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
  const unitPriceYuanPerMillionTokens = getSeedanceUnitPriceYuanPerMillionTokens(params.model, false);
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

export function estimateSeedance20TaskCostFromUsage(model: string, payload: unknown) {
  const usageTokens = extractSeedanceUsageTokens(payload);
  if (usageTokens == null) return null;

  const hasVideoInput = payloadContainsReferenceVideo(payload);
  const unitPriceYuanPerMillionTokens = getSeedanceUnitPriceYuanPerMillionTokens(model, hasVideoInput);
  if (unitPriceYuanPerMillionTokens == null) return null;

  return {
    usageTokens,
    hasVideoInput,
    unitPriceYuanPerMillionTokens,
    estimatedCostYuan: (usageTokens / 1_000_000) * unitPriceYuanPerMillionTokens,
  };
}
