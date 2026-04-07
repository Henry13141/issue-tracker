"use client";

export type PromptBuilderMode = "structured" | "wizard" | "optimizer";

export type PromptDraft = {
  goal: string;
  subject: string;
  action: string;
  scene: string;
  style: string;
  camera: string;
  lighting: string;
  audio: string;
  textOverlay: string;
  imageReference: string;
  videoReference: string;
  constraints: string;
};

/** 主界面已填写的参考素材条数（与上传顺序一致，对应「图片1」「视频1」等）。 */
export type ReferenceAssetCounts = {
  images: number;
  videos: number;
  audios: number;
};

export const EMPTY_REFERENCE_COUNTS: ReferenceAssetCounts = {
  images: 0,
  videos: 0,
  audios: 0,
};

export const EMPTY_PROMPT_DRAFT: PromptDraft = {
  goal: "",
  subject: "",
  action: "",
  scene: "",
  style: "",
  camera: "",
  lighting: "",
  audio: "",
  textOverlay: "",
  imageReference: "",
  videoReference: "",
  constraints: "",
};

export type SeedancePromptOptimizationResult = {
  source?: "ai" | "fallback";
  ready: boolean;
  detectedScenario:
    | "general"
    | "multimodal_reference"
    | "video_edit"
    | "video_extend"
    | "video_stitch"
    | "first_frame"
    | "first_last_frame";
  optimizedPrompt: string;
  issues: string[];
  principles: string[];
  clarificationQuestions: string[];
};

export function normalizeSeedanceReferenceMentions(value: string) {
  return value.replace(/@(?=(图片|视频|音频)\d+\b)/g, "");
}

function clean(value: string) {
  return normalizeSeedanceReferenceMentions(value).replace(/\s+/g, " ").trim();
}

function withStop(value: string) {
  const normalized = clean(value);
  if (!normalized) return "";
  return /[。！？.!?]$/.test(normalized) ? normalized : `${normalized}。`;
}

function splitPromptClauses(value: string) {
  return value
    .split(/[\n。！？!?；;]+/)
    .flatMap((line) => line.split(/[，,]/))
    .map((item) => clean(item))
    .filter(Boolean);
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map((item) => clean(item)).filter(Boolean)));
}

export function hasPromptDraftContent(draft: PromptDraft) {
  return Object.values(draft).some((value) => clean(value).length > 0);
}

export function hasAnyReferenceAssets(counts: ReferenceAssetCounts) {
  return counts.images > 0 || counts.videos > 0 || counts.audios > 0;
}

/** 有结构化内容，或至少已上传参考素材，即可生成（后者会输出编号提示）。 */
export function canGenerateSeedancePrompt(draft: PromptDraft, counts: ReferenceAssetCounts) {
  return hasPromptDraftContent(draft) || hasAnyReferenceAssets(counts);
}

/**
 * 按 Seedance 官方提示词指南：多图/多视频按上传顺序指代为「图片1」「视频1」…
 */
export function buildAutoReferenceNumberingHint(counts: ReferenceAssetCounts): string {
  const lines: string[] = [];

  if (counts.images > 0) {
    const labels = Array.from({ length: counts.images }, (_, i) => `图片${i + 1}`).join("、");
    lines.push(
      `当前主界面已添加 ${counts.images} 张参考图，按上传顺序依次对应 ${labels}。可在提示词中明确指代，例如「主体外观参考图片1」「构图参考图片2」。`
    );
  }

  if (counts.videos > 0) {
    const labels = Array.from({ length: counts.videos }, (_, i) => `视频${i + 1}`).join("、");
    lines.push(
      `当前主界面已添加 ${counts.videos} 段参考视频，按上传顺序依次对应 ${labels}。可在提示词中明确指代，例如「动作参考视频1」「运镜参考视频2」「特效参考视频1」。`
    );
  }

  if (counts.audios > 0) {
    const labels = Array.from({ length: counts.audios }, (_, i) => `音频${i + 1}`).join("、");
    lines.push(
      `当前主界面已添加 ${counts.audios} 段参考音频，按上传顺序依次对应 ${labels}。可在提示词中指代节奏或旁白方向，例如「旁白节奏参考音频1」。`
    );
  }

  return lines.join("\n\n").trim();
}

/** 火山方舟 Seedance 2.0 提示词指南中的典型句式，供一键插入对应字段。 */
export const SEEDANCE_DOC_SNIPPETS = {
  baseFormula:
    "先明确主体与动作，再补充环境、美学风格、镜头语言、声音设计与兜底约束，确保描述顺序清晰、层次分明。",
  slogan:
    "画面中部在结尾阶段显示广告语「快乐尽在 Seedance」，文字风格简洁醒目，与整体画风一致。",
  subtitle:
    "画面底部出现字幕，字幕内容与画外音或台词完全同步，随语音节奏逐句出现。",
  bubbleSpeech:
    "角色说话时，台词以对话气泡形式出现在角色附近，气泡内文字清晰可读。",
  actionFromVideo:
    "参考视频1的人物动作节奏与动作细节生成画面，保持动作轨迹和节奏一致。",
  cameraFromVideo:
    "参考视频1的运镜方式生成画面，整体镜头运动与参考一致，画面内容按上文描述展开。",
  vfxFromVideo:
    "参考视频1中的特效风格与轨迹，将同类特效应用到当前画面主体上，保持特效节奏一致。",
  subjectFromImages:
    "参考图片1、图片2中的主体形象生成画面，保持主体外观特征一致。",
  storyboardFromImages:
    "参考图片1、图片2、图片3的分镜构图顺序生成画面，各分镜按顺序出现后自然衔接。",
  logoReference:
    "画面结尾出现图片1中的 Logo，Logo 清晰完整，位置稳定，与整体画面风格协调。",
  addElementEdit:
    "在视频1的指定空间位置增加目标元素，其他主体动作和运镜保持不变。",
  replaceElementEdit:
    "将视频1中的目标元素替换为指定新元素，其余动作、光影和镜头节奏保持一致。",
  removeElementEdit:
    "删除视频1中的指定元素，保留原视频其余内容不变，画面衔接自然。",
  extendVideo:
    "生成视频1之后的内容，延续当前动作和情绪发展，保持主体、场景和运镜连续。",
  stitchVideos:
    "视频1与视频2之间加入自然过渡画面完成衔接，保持动作、视线、光影或特效连续。",
} as const;

export function buildSeedancePrompt(draft: PromptDraft) {
  const goal = clean(draft.goal);
  const subject = clean(draft.subject);
  const action = clean(draft.action);
  const scene = clean(draft.scene);
  const style = clean(draft.style);
  const camera = clean(draft.camera);
  const lighting = clean(draft.lighting);
  const audio = clean(draft.audio);
  const textOverlay = clean(draft.textOverlay);
  const imageReference = clean(draft.imageReference);
  const videoReference = clean(draft.videoReference);
  const constraints = clean(draft.constraints);

  const paragraphs: string[] = [];

  if (goal) {
    paragraphs.push(withStop(`目标是生成一个${goal}`));
  }

  const storySegments = [
    subject ? `主体是${subject}` : "",
    action ? `正在${action}` : "",
    scene ? `场景为${scene}` : "",
  ].filter(Boolean);
  if (storySegments.length > 0) {
    paragraphs.push(withStop(storySegments.join("，")));
  }

  const visualSegments = [
    style ? `整体风格为${style}` : "",
    lighting ? `光影与氛围为${lighting}` : "",
    camera ? `镜头语言采用${camera}` : "",
  ].filter(Boolean);
  if (visualSegments.length > 0) {
    paragraphs.push(withStop(visualSegments.join("，")));
  }

  if (audio) {
    paragraphs.push(withStop(`声音与节奏要求：${audio}`));
  }

  if (textOverlay) {
    paragraphs.push(withStop(`文字与字幕要求：${textOverlay}`));
  }

  const references = [
    imageReference ? `图片参考：${imageReference}` : "",
    videoReference ? `视频参考：${videoReference}` : "",
  ].filter(Boolean);
  if (references.length > 0) {
    paragraphs.push(withStop(references.join("；")));
  }

  if (constraints) {
    paragraphs.push(withStop(`额外约束：${constraints}`));
  }

  return paragraphs.filter(Boolean).join("\n\n").trim();
}

/** 结构化正文 + 参考素材编号提示（若有）。 */
export function buildSeedancePromptWithReferenceHint(
  draft: PromptDraft,
  counts: ReferenceAssetCounts
): string {
  const body = buildSeedancePrompt(draft);
  const hint = buildAutoReferenceNumberingHint(counts);
  if (!body) return hint;
  if (!hint) return body;
  return `${body}\n\n---\n${hint}`.trim();
}

function detectScenario(rawPrompt: string, counts: ReferenceAssetCounts): SeedancePromptOptimizationResult["detectedScenario"] {
  const text = clean(rawPrompt);
  if (/轨道补齐|接视频\d|接\s*视频|衔接|拼接|过渡画面/.test(text)) return "video_stitch";
  if (/延长|向前|向后|之前的内容|之后的内容/.test(text)) return "video_extend";
  if (/替换|修改|删除|去掉|刷成|改成|重绘|修复|编辑/.test(text)) return "video_edit";
  if (counts.images >= 2 && counts.videos === 0 && counts.audios === 0) return "first_last_frame";
  if (counts.images === 1 && counts.videos === 0 && counts.audios === 0) return "first_frame";
  if (counts.images > 0 || counts.videos > 0 || counts.audios > 0) return "multimodal_reference";
  return "general";
}

function buildScenarioSpecificQuestions(
  scenario: SeedancePromptOptimizationResult["detectedScenario"],
  text: string,
  counts: ReferenceAssetCounts
) {
  const questions: string[] = [];

  if (scenario === "first_frame" && counts.images < 1) {
    questions.push("首帧图生视频至少需要 1 张图片参考，是否需要先补一张首帧图？");
  }

  if (scenario === "first_last_frame" && counts.images < 2) {
    questions.push("首尾帧生视频通常需要 2 张图片，是否需要分别提供首帧和尾帧参考？");
  }

  if (scenario === "video_extend" && counts.videos < 1) {
    questions.push("视频延长需要至少 1 段参考视频，是否需要先补充视频素材？");
  }

  if (scenario === "video_stitch" && counts.videos < 2) {
    questions.push("轨道补齐通常至少需要 2 段视频，是否需要补充第二段参考视频？");
  }

  if (scenario === "video_edit" && !/增加|删除|替换|修改|改成|去掉/.test(text)) {
    questions.push("这次视频编辑是增加元素、删除元素，还是替换元素？请明确编辑类型。");
  }

  if ((scenario === "video_edit" || scenario === "video_stitch") && !/位置|左侧|右侧|中间|前景|背景|台面|桌面|镜头前/.test(text)) {
    questions.push("是否需要明确空间位置或过渡节点，以减少编辑和衔接歧义？");
  }

  return questions;
}

function buildConstraintLine(
  scenario: SeedancePromptOptimizationResult["detectedScenario"],
  clauses: string[]
) {
  const explicit = uniqueStrings(
    clauses.filter((clause) => /保持|不要|避免|稳定|清晰|一致|突出|不变|自然|完整/.test(clause))
  );
  if (explicit.length > 0) {
    return explicit.join("，");
  }

  if (scenario === "video_edit") {
    return "除指定编辑内容外，其余主体动作、镜头节奏与空间关系保持不变，编辑边缘自然干净。";
  }
  if (scenario === "video_extend") {
    return "保持主体形象、动作走势、光线和镜头节奏连续，延长段与原视频自然衔接。";
  }
  if (scenario === "video_stitch") {
    return "保持前后段动作、视线、光影或特效连续，过渡自然，不要生硬跳切。";
  }
  return "保持主体一致，动作衔接自然，关键元素清晰稳定，不要出现多余人物或明显画面跳变。";
}

function buildScenarioRewrite(
  sourcePrompt: string,
  counts: ReferenceAssetCounts,
  scenario: SeedancePromptOptimizationResult["detectedScenario"]
) {
  const clauses = splitPromptClauses(sourcePrompt);
  if (clauses.length === 0) return "";

  const referenceClauses = uniqueStrings(
    clauses.filter((clause) => /图片\d|视频\d|音频\d|首帧|尾帧|Logo|分镜/.test(clause))
  );
  const cameraClauses = uniqueStrings(
    clauses.filter((clause) => /镜头|特写|推|拉|摇|移|跟拍|环绕|俯冲|横摇|横移|第一视角|近景|中景|远景/.test(clause))
  );
  const styleClauses = uniqueStrings(
    clauses.filter((clause) => /风格|真实|自然|写实|电影感|赛博朋克|暖色|冷色|明亮|柔和|高级|质感|光线|氛围|空间|背景|场景|办公室|发布会|工业/.test(clause))
  );
  const audioClauses = uniqueStrings(
    clauses.filter((clause) => /音频|配音|旁白|背景音乐|口播|节奏|字幕|台词|广告语|文字|Logo/.test(clause))
  );
  const actionClauses = uniqueStrings(
    clauses.filter(
      (clause) =>
        !referenceClauses.includes(clause) &&
        !cameraClauses.includes(clause) &&
        !styleClauses.includes(clause) &&
        !audioClauses.includes(clause) &&
        !/保持|不要|避免|稳定|清晰|一致|不变|自然/.test(clause)
    )
  );

  const headlineParts: string[] = [];
  if (actionClauses[0]) headlineParts.push(actionClauses[0]);
  if (styleClauses[0] && !headlineParts.includes(styleClauses[0])) headlineParts.push(styleClauses[0]);
  if (headlineParts.length === 0 && clauses[0]) headlineParts.push(clauses[0]);

  const sections: string[] = [];
  sections.push(withStop(`主体与目标：${headlineParts.join("，")}`));

  const actionBody = actionClauses.slice(1).length > 0 ? actionClauses.slice(1) : actionClauses.slice(0, 1);
  if (actionBody.length > 0) {
    sections.push(withStop(`动作与分镜：${actionBody.join("，")}`));
  }

  if (styleClauses.length > 0) {
    sections.push(withStop(`环境与美学：${styleClauses.join("，")}`));
  }

  if (referenceClauses.length > 0 || counts.images > 0 || counts.videos > 0 || counts.audios > 0) {
    const referenceSummary = buildAutoReferenceNumberingHint(counts);
    const body = uniqueStrings([...referenceClauses, referenceSummary]).join("，");
    sections.push(withStop(`参考素材：${body}`));
  }

  if (cameraClauses.length > 0) {
    sections.push(withStop(`镜头设计：${cameraClauses.join("，")}`));
  }

  if (audioClauses.length > 0) {
    sections.push(withStop(`声音与文字：${audioClauses.join("，")}`));
  }

  sections.push(withStop(`稳定约束：${buildConstraintLine(scenario, clauses)}`));
  return sections.filter(Boolean).join("\n\n").trim();
}

export function shouldUseRewrittenPrompt(rawPrompt: string, optimizedPrompt: string) {
  const raw = clean(rawPrompt);
  const optimized = clean(optimizedPrompt);
  if (!optimized) return true;
  if (raw && raw === optimized) return true;
  if (!/主体与目标：|动作与分镜：|环境与美学：|镜头设计：|声音与文字：|稳定约束：/.test(optimized)) {
    return optimized.length <= raw.length * 1.05;
  }
  return false;
}

export function buildSeedanceOptimizationFallback(params: {
  rawPrompt: string;
  draft: PromptDraft;
  counts: ReferenceAssetCounts;
}): SeedancePromptOptimizationResult {
  const rawPrompt = clean(params.rawPrompt);
  const generated = buildSeedancePromptWithReferenceHint(params.draft, params.counts);
  const sourcePrompt = rawPrompt || generated;
  const issues: string[] = [];
  const clarificationQuestions: string[] = [];
  const scenario = detectScenario(sourcePrompt, params.counts);
  const optimizedPrompt = buildScenarioRewrite(sourcePrompt, params.counts, scenario) || sourcePrompt;

  if (!sourcePrompt) {
    issues.push("当前没有可优化的提示词内容。");
    clarificationQuestions.push("你想生成什么视频？主体是谁，在什么场景里发生什么动作？");
  } else {
    if (!/主体|人物|角色|产品|相机|杯子|女生|男生|女孩|男孩|猫|狗/.test(sourcePrompt)) {
      issues.push("主体描述不够聚焦，模型可能无法稳定锁定谁是画面主角。");
      clarificationQuestions.push("这条视频的主角是谁？外观或身份特征是什么？");
    }
    if (!/动作|走|跑|看|说|转身|拿起|展示|伸手|吃|飞|打斗|变成|切换/.test(sourcePrompt)) {
      issues.push("动作过程不够明确，模型难以稳定推演画面发展。");
      clarificationQuestions.push("主体具体在做什么？动作要分几步发生？");
    }
    if (!/环境|场景|背景|室内|室外|公寓|草原|咖啡店|霓虹|桌面|餐厅|操场/.test(sourcePrompt)) {
      issues.push("环境描述偏少，空间背景和氛围可能不稳定。");
      clarificationQuestions.push("发生在什么环境里？背景、时间或空间质感是什么？");
    }
    if (!/镜头|特写|推|拉|摇|移|跟拍|环绕|固定机位/.test(sourcePrompt)) {
      issues.push("镜头语言不够明确，容易导致运镜随机。");
      clarificationQuestions.push("希望镜头怎么拍？例如固定机位、缓慢推近、环绕运镜。");
    }
    if (!/风格|写实|电影感|卡通|赛博朋克|光影|色调/.test(sourcePrompt)) {
      issues.push("风格和光影描述偏少，可能导致画面气质不稳定。");
      clarificationQuestions.push("你希望整体风格更偏写实、电影感、卡通还是别的风格？");
    }
    if (!/不要|保持|稳定|清晰|无穿模|一致/.test(sourcePrompt)) {
      issues.push("缺少兜底约束，角色一致性和细节稳定性可能不足。");
    }
    if (/字幕|台词|广告语|Logo|文字/.test(sourcePrompt) && /[^\u0000-\u007F]/.test(sourcePrompt) && /[^\u4e00-\u9fa5a-zA-Z0-9\s，。！？、“”‘’《》【】（）()\-:：,.!?'"`]/.test(sourcePrompt)) {
      issues.push("文字生成内容里可能含有特殊符号或非常规字符，最终呈现稳定性可能下降。");
    }
    if (params.counts.audios > 0 && !/音频|配音|旁白|背景音乐|节奏|字幕/.test(sourcePrompt)) {
      issues.push("已存在音频参考，但提示词没有说明音频应如何参与生成。");
      clarificationQuestions.push("音频1 是要作为背景音乐、旁白节奏，还是角色台词参考？");
    }
  }

  for (const question of buildScenarioSpecificQuestions(scenario, sourcePrompt, params.counts)) {
    if (!clarificationQuestions.includes(question)) clarificationQuestions.push(question);
  }

  return {
    ready: clarificationQuestions.length === 0 && Boolean(sourcePrompt),
    detectedScenario: scenario,
    optimizedPrompt,
    issues,
    principles: [
      "优先使用“主体 + 动作 + 环境/美学 + 镜头 + 音频/文字 + 约束”的基础公式组织提示词。",
      "参考素材使用项目内的“图片1 / 视频1 / 音频1”编号习惯，避免无语义 ID 直接进入描述。",
      "优先保证单一时间片内只有一种主运镜，减少模型理解冲突。",
      "当涉及视频编辑、延长或轨道补齐时，优先写清参考对象、位置、时间段和需要保持不变的部分。",
    ],
    clarificationQuestions,
  };
}
