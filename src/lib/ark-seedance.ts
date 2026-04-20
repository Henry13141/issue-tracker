const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export type SeedanceImageRole = "reference_image" | "first_frame" | "last_frame";
export type SeedanceReferenceRole = SeedanceImageRole | "reference_video" | "reference_audio";

export type SeedanceContentItem =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      role?: SeedanceImageRole;
      image_url: { url: string };
    }
  | {
      type: "video_url";
      role: Extract<SeedanceReferenceRole, "reference_video">;
      video_url: { url: string };
    }
  | {
      type: "audio_url";
      role: Extract<SeedanceReferenceRole, "reference_audio">;
      audio_url: { url: string };
    };

export type SeedanceTool = {
  type: "web_search";
};

export type SeedanceCreateTaskInput = {
  model: string;
  content: SeedanceContentItem[];
  generate_audio: boolean;
  ratio: string;
  duration: number;
  resolution?: "480p" | "720p" | "1080p";
  watermark: boolean;
  return_last_frame?: boolean;
  safety_identifier?: string;
  tools?: SeedanceTool[];
  /** 种子值 [-1, 2^32-1]；-1 表示随机。 */
  seed?: number;
};

export type SeedanceTaskSummary = {
  taskId: string;
  status: string;
  model: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  videoUrls: string[];
  lastFrameUrls: string[];
  message: string | null;
  resolution: string | null;
  ratio: string | null;
  durationSeconds: number | null;
  /** 创建时指定了 frames 时返回；与 durationSeconds 互斥（接口只会返回其中一个）。 */
  frames: number | null;
  framesPerSecond: number | null;
  /** 是否含音频，仅 seedance 2.0 / 2.0 fast / 1.5 pro 返回。 */
  generateAudio: boolean | null;
  /** 实际调用联网搜索次数；0 表示未搜索，null 表示未启用。 */
  toolUsageWebSearch: number | null;
  serviceTier: string | null;
  executionExpiresAfter: number | null;
  usageTokens: number | null;
  seed: number | null;
  raw: unknown;
};

export type SeedanceTaskListResult = {
  total: number;
  items: SeedanceTaskSummary[];
};

class ArkRequestError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "ArkRequestError";
    this.status = status;
    this.details = details;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function readDateString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value > 1e12 ? value : value * 1000;
      return new Date(millis).toISOString();
    }
  }
  return null;
}

function readNestedRecord(record: Record<string, unknown> | null, keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const nested = asRecord(record[key]);
    if (nested) return nested;
  }
  return null;
}

function readNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function readBoolean(record: Record<string, unknown> | null, keys: string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
  }
  return null;
}

function getArkApiKey(): string | null {
  const key = process.env.ARK_API_KEY?.trim();
  return key || null;
}

export function isSeedanceConfigured(): boolean {
  return Boolean(getArkApiKey());
}

function createArkHeaders() {
  const apiKey = getArkApiKey();
  if (!apiKey) {
    throw new ArkRequestError("服务端尚未配置 ARK_API_KEY。", 500, null);
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function parseJsonSafely(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { rawText: text };
  }
}

function extractErrorMessage(payload: unknown): string | null {
  const root = asRecord(payload);
  const nestedError = readNestedRecord(root, ["error"]);
  return (
    readString(nestedError, ["message", "type", "code"]) ??
    readString(root, ["message", "error", "detail"]) ??
    null
  );
}

function looksLikeVideoUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) && /\.(mp4|mov|webm|m3u8)(?:\?|#|$)/i.test(url);
}

function collectVideoUrls(value: unknown, results = new Set<string>()) {
  if (typeof value === "string") {
    if (looksLikeVideoUrl(value)) {
      results.add(value);
    }
    return results;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectVideoUrls(item, results);
    }
    return results;
  }

  const record = asRecord(value);
  if (!record) return results;

  const directUrl = readString(record, ["url", "video_url", "download_url"]);
  const mimeType = readString(record, ["mime_type", "content_type", "type"]);
  if (directUrl && (looksLikeVideoUrl(directUrl) || mimeType?.includes("video"))) {
    results.add(directUrl);
  }

  for (const nested of Object.values(record)) {
    collectVideoUrls(nested, results);
  }
  return results;
}

function collectNamedUrls(
  value: unknown,
  targetKeys: string[],
  results = new Set<string>()
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectNamedUrls(item, targetKeys, results);
    }
    return results;
  }

  const record = asRecord(value);
  if (!record) return results;

  for (const key of targetKeys) {
    const maybeUrl = record[key];
    if (typeof maybeUrl === "string" && /^https?:\/\//i.test(maybeUrl)) {
      results.add(maybeUrl);
    }
  }

  for (const nested of Object.values(record)) {
    collectNamedUrls(nested, targetKeys, results);
  }

  return results;
}

function normalizeTaskSummary(payload: unknown): SeedanceTaskSummary {
  const root = asRecord(payload);
  const dataNode = readNestedRecord(root, ["data", "task", "result"]);
  const primary = dataNode ?? root ?? {};

  const taskId =
    readString(primary, ["id", "task_id", "taskId"]) ??
    readString(root, ["id", "task_id", "taskId"]) ??
    "";
  const status =
    readString(primary, ["status", "state"]) ??
    readString(root, ["status", "state"]) ??
    "unknown";
  const model =
    readString(primary, ["model"]) ??
    readString(root, ["model"]);
  const createdAt =
    readDateString(primary, ["created_at", "createdAt"]) ??
    readDateString(root, ["created_at", "createdAt"]);
  const updatedAt =
    readDateString(primary, ["updated_at", "updatedAt"]) ??
    readDateString(root, ["updated_at", "updatedAt"]);
  const usage = readNestedRecord(primary, ["usage"]) ?? readNestedRecord(root, ["usage"]);
  const toolUsage = readNestedRecord(usage, ["tool_usage"]);
  const message =
    extractErrorMessage(payload) ??
    readString(primary, ["reason", "failure_reason", "fail_reason", "message"]);

  return {
    taskId,
    status,
    model,
    createdAt,
    updatedAt,
    videoUrls: Array.from(collectVideoUrls(payload)),
    lastFrameUrls: Array.from(collectNamedUrls(payload, ["last_frame_url", "lastFrameUrl"])),
    message,
    resolution:
      readString(primary, ["resolution"]) ??
      readString(root, ["resolution"]),
    ratio:
      readString(primary, ["ratio"]) ??
      readString(root, ["ratio"]),
    durationSeconds:
      readNumber(primary, ["duration"]) ??
      readNumber(root, ["duration"]),
    frames:
      readNumber(primary, ["frames"]) ??
      readNumber(root, ["frames"]),
    framesPerSecond:
      readNumber(primary, ["framespersecond", "frames_per_second", "fps"]) ??
      readNumber(root, ["framespersecond", "frames_per_second", "fps"]),
    generateAudio:
      readBoolean(primary, ["generate_audio", "generateAudio"]) ??
      readBoolean(root, ["generate_audio", "generateAudio"]),
    toolUsageWebSearch:
      readNumber(toolUsage, ["web_search"]) ?? null,
    serviceTier:
      readString(primary, ["service_tier", "serviceTier"]) ??
      readString(root, ["service_tier", "serviceTier"]),
    executionExpiresAfter:
      readNumber(primary, ["execution_expires_after", "executionExpiresAfter"]) ??
      readNumber(root, ["execution_expires_after", "executionExpiresAfter"]),
    usageTokens:
      readNumber(usage, ["total_tokens", "completion_tokens", "tokens"]) ??
      readNumber(primary, ["total_tokens", "completion_tokens"]) ??
      readNumber(root, ["total_tokens", "completion_tokens"]),
    seed:
      readNumber(primary, ["seed"]) ??
      readNumber(root, ["seed"]),
    raw: payload,
  };
}

export function isSeedanceTerminalStatus(status: string | null | undefined) {
  return Boolean(status && ["succeeded", "failed", "cancelled", "expired"].includes(status));
}

export async function createSeedanceTask(input: SeedanceCreateTaskInput): Promise<SeedanceTaskSummary> {
  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: "POST",
    headers: createArkHeaders(),
    body: JSON.stringify(input),
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    throw new ArkRequestError(
      extractErrorMessage(payload) ?? "创建 Seedance 任务失败。",
      response.status,
      payload
    );
  }

  return normalizeTaskSummary(payload);
}

export async function getSeedanceTask(taskId: string): Promise<SeedanceTaskSummary> {
  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: createArkHeaders(),
    cache: "no-store",
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    throw new ArkRequestError(
      extractErrorMessage(payload) ?? "查询 Seedance 任务失败。",
      response.status,
      payload
    );
  }

  return normalizeTaskSummary(payload);
}

export async function deleteSeedanceTask(taskId: string): Promise<void> {
  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    headers: createArkHeaders(),
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    throw new ArkRequestError(
      extractErrorMessage(payload) ?? "删除或取消 Seedance 任务失败。",
      response.status,
      payload
    );
  }
}

export type SeedanceListFilter = {
  /** 按任务状态过滤。 */
  status?: "queued" | "running" | "cancelled" | "succeeded" | "failed" | "expired";
  /** 按任务 ID 精确查询，支持多个。 */
  taskIds?: string[];
  /** 按推理接入点 ID（非模型名）精确查询。 */
  model?: string;
  /** 按服务等级过滤。 */
  serviceTier?: "default" | "flex";
};

export async function listSeedanceTasks(params?: {
  pageNum?: number;
  pageSize?: number;
  filter?: SeedanceListFilter;
}): Promise<SeedanceTaskListResult> {
  const pageNum = params?.pageNum ?? 1;
  const pageSize = params?.pageSize ?? 12;
  const search = new URLSearchParams({
    page_num: String(pageNum),
    page_size: String(pageSize),
  });

  const filter = params?.filter;
  if (filter?.status) search.set("filter.status", filter.status);
  if (filter?.model) search.set("filter.model", filter.model);
  if (filter?.serviceTier) search.set("filter.service_tier", filter.serviceTier);
  // filter.task_ids uses repeated keys: &filter.task_ids=id1&filter.task_ids=id2
  if (filter?.taskIds?.length) {
    for (const id of filter.taskIds) {
      search.append("filter.task_ids", id);
    }
  }

  const response = await fetch(`${ARK_BASE_URL}/contents/generations/tasks?${search.toString()}`, {
    method: "GET",
    headers: createArkHeaders(),
    cache: "no-store",
  });

  const payload = await parseJsonSafely(response);
  if (!response.ok) {
    throw new ArkRequestError(
      extractErrorMessage(payload) ?? "查询 Seedance 历史任务失败。",
      response.status,
      payload
    );
  }

  const root = asRecord(payload);
  const items = Array.isArray(root?.items) ? root.items : [];
  const total = typeof root?.total === "number" && Number.isFinite(root.total) ? root.total : items.length;

  return {
    total,
    items: items.map((item) => normalizeTaskSummary(item)),
  };
}

function translateArkError(message: string): string {
  if (/video total duration.*must be less than or equal to/i.test(message)) {
    const match = message.match(/less than or equal to ([\d.]+)/i);
    const limit = match ? match[1] : "15.2";
    return `参考视频总时长超出限制：所有参考视频合计不得超过 ${limit} 秒，请裁剪后重试。`;
  }
  if (/The parameter `content` specified in the request is not valid/i.test(message)) {
    return `请求参数无效（content）：${message.replace(/.*is not valid:\s*/i, "")}`;
  }
  if (/AuthenticationError|api key/i.test(message)) {
    return "API Key 认证失败，请联系管理员检查配置。";
  }
  if (/RateLimitError|rate limit/i.test(message)) {
    return "请求频率超限，请稍后重试。";
  }
  if (/insufficient.*balance|quota/i.test(message)) {
    return "账户余额不足或配额超限，请联系管理员充值。";
  }
  return message;
}

export function toArkErrorResponse(error: unknown) {
  if (error instanceof ArkRequestError) {
    return {
      status: error.status,
      body: {
        error: translateArkError(error.message),
        details: error.details,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: error instanceof Error ? translateArkError(error.message) : "未知错误",
    },
  };
}
