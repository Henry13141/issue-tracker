import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chatCompletion, isAIConfigured } from "@/lib/ai";
import {
  buildSeedanceOptimizationFallback,
  shouldUseRewrittenPrompt,
  type PromptDraft,
  type ReferenceAssetCounts,
  type SeedancePromptOptimizationResult,
} from "@/lib/seedance-prompt-builder";

type OptimizeRequestBody = {
  rawPrompt?: unknown;
  draft?: unknown;
  referenceCounts?: unknown;
};

function normalizeDraft(value: unknown): PromptDraft {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    goal: typeof record.goal === "string" ? record.goal : "",
    subject: typeof record.subject === "string" ? record.subject : "",
    action: typeof record.action === "string" ? record.action : "",
    scene: typeof record.scene === "string" ? record.scene : "",
    style: typeof record.style === "string" ? record.style : "",
    camera: typeof record.camera === "string" ? record.camera : "",
    lighting: typeof record.lighting === "string" ? record.lighting : "",
    audio: typeof record.audio === "string" ? record.audio : "",
    textOverlay: typeof record.textOverlay === "string" ? record.textOverlay : "",
    imageReference: typeof record.imageReference === "string" ? record.imageReference : "",
    videoReference: typeof record.videoReference === "string" ? record.videoReference : "",
    constraints: typeof record.constraints === "string" ? record.constraints : "",
  };
}

function normalizeReferenceCounts(value: unknown): ReferenceAssetCounts {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const readCount = (key: keyof ReferenceAssetCounts) => {
    const next = Number(record[key]);
    return Number.isFinite(next) && next >= 0 ? next : 0;
  };
  return {
    images: readCount("images"),
    videos: readCount("videos"),
    audios: readCount("audios"),
  };
}

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function parseOptimizationResult(text: string): SeedancePromptOptimizationResult | null {
  try {
    const parsed = JSON.parse(stripCodeFence(text)) as Record<string, unknown>;
    const ensureStringArray = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
    const detectedScenario = parsed.detectedScenario;
    if (
      detectedScenario !== "general" &&
      detectedScenario !== "multimodal_reference" &&
      detectedScenario !== "video_edit" &&
      detectedScenario !== "video_extend" &&
      detectedScenario !== "video_stitch" &&
      detectedScenario !== "first_frame" &&
      detectedScenario !== "first_last_frame"
    ) {
      return null;
    }
    return {
      source: "ai",
      ready: Boolean(parsed.ready),
      detectedScenario,
      optimizedPrompt: typeof parsed.optimizedPrompt === "string" ? parsed.optimizedPrompt.trim() : "",
      issues: ensureStringArray(parsed.issues),
      principles: ensureStringArray(parsed.principles),
      clarificationQuestions: ensureStringArray(parsed.clarificationQuestions),
    };
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `
你是 Seedance 2.0 视频提示词优化器，工作方式参考 sd2-pe 技能，但必须适配当前项目的约定。

官方使用要领：
1. 文本指令优先按“主体 + 动作 + 环境/美学 + 运镜/音频”组织，再补充文字内容和兜底约束。
2. 多模态参考必须清楚指代对象，例如“构图参考图片1”“动作参考视频1”“节奏参考音频1”。
3. 当涉及广告语、字幕、气泡台词时，要明确文字内容、出现时机、位置、方式；尽量避免生僻字和特殊符号。
4. 当涉及图片参考时，要明确是主体参考、Logo 参考、多图元素参考还是分镜顺序参考。
5. 当涉及视频参考时，要明确是动作参考、运镜参考还是特效参考。
6. 当涉及视频编辑时，要明确是增加、删除、替换元素，或视频延长、轨道补齐；并写清位置、时间段、衔接方式以及“不变部分”。
7. Seedance 2.0 原生支持音频与视频联合生成，因此如存在音频参考，需说明音频承担的角色：背景音乐、旁白、口播、节奏或字幕同步。

你的任务：
1. 分析用户的原始提示词、结构化草稿和参考素材数量。
2. 判断这是普通生成、多模态参考、视频编辑、视频延长、轨道补齐、首帧图生视频、首尾帧生视频中的哪一种。
3. 检查是否缺少关键信息，是否存在镜头冲突或描述歧义。
4. 生成适合直接提交到 Seedance API 的优化后提示词。

强制要求：
- 永远使用简体中文。
- 项目内素材引用必须使用“图片1 / 视频1 / 音频1”格式，不要使用 @图1，也不要输出 asset id。
- 不要静默编造缺失事实；如果信息不足，请在 clarificationQuestions 中提出 1-4 个明确问题。
- 如果已经足够生成，也要指出原提示词存在的问题，并给出优化原则。
- 优化后提示词使用工程化表达：主体与目标、动作/分镜、环境与美学、镜头设计、声音/字幕、兜底约束。
- 避免同一时间片里塞多个互相冲突的运镜。
- 如存在多图或多视频，优先保持上传顺序语义，不要擅自重排。
- 如果是视频编辑或轨道补齐，必须强调“其余部分保持不变”或“过渡自然连续”这类稳定约束。
- 最终只输出 JSON，不要输出 Markdown，不要输出解释。

JSON 结构必须严格如下：
{
  "ready": true,
  "detectedScenario": "general" | "multimodal_reference" | "video_edit" | "video_extend" | "video_stitch" | "first_frame" | "first_last_frame",
  "optimizedPrompt": "string",
  "issues": ["string"],
  "principles": ["string"],
  "clarificationQuestions": ["string"]
}
`;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "未登录，无法使用提示词优化。" }, { status: 401 });
  }

  let body: OptimizeRequestBody;
  try {
    body = (await request.json()) as OptimizeRequestBody;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON。" }, { status: 400 });
  }

  const rawPrompt = typeof body.rawPrompt === "string" ? body.rawPrompt.trim() : "";
  const draft = normalizeDraft(body.draft);
  const referenceCounts = normalizeReferenceCounts(body.referenceCounts);
  const fallback = buildSeedanceOptimizationFallback({ rawPrompt, draft, counts: referenceCounts });

  if (!isAIConfigured()) {
    return NextResponse.json({ result: { ...fallback, source: "fallback" } });
  }

  const userPrompt = [
    "请根据以下输入返回优化结果。",
    "",
    "原始提示词：",
    rawPrompt || "（空）",
    "",
    "结构化草稿：",
    JSON.stringify(draft, null, 2),
    "",
    "参考素材数量：",
    JSON.stringify(referenceCounts, null, 2),
    "",
    "补充约定：",
    "- 如果主界面有图片、视频、音频素材，请在提示词里用“图片1 / 视频1 / 音频1”引用。",
    "- 如果素材数量不足以支撑首帧或首尾帧场景，请在 clarificationQuestions 里指出。",
    "- 如果用户明显在做视频拼接、接续、轨道补齐，请返回 detectedScenario=video_stitch。",
    "- 如果用户要生成字幕、广告语、气泡台词，请把文字内容、出现方式、时机和位置写具体。",
    "- 如果用户传了音频素材，请明确音频在结果中承担的作用。",
    "- optimizedPrompt 应尽量可直接回填到项目主输入框。",
  ].join("\n");

  const content = await chatCompletion(SYSTEM_PROMPT, userPrompt, {
    maxTokens: 1800,
    disableThinking: true,
  });

  const parsed = content ? parseOptimizationResult(content) : null;
  if (!parsed) {
    return NextResponse.json({ result: { ...fallback, source: "fallback" } });
  }

  if (shouldUseRewrittenPrompt(rawPrompt, parsed.optimizedPrompt)) {
    return NextResponse.json({
      result: {
        ...parsed,
        optimizedPrompt: fallback.optimizedPrompt,
        principles: Array.from(new Set([...parsed.principles, "原始优化稿改写幅度不足，已自动替换为结构化重写版本。"])),
      },
    });
  }

  return NextResponse.json({ result: parsed });
}
