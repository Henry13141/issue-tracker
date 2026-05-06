/**
 * SVN 研发日报生成逻辑
 *
 * 优先用 AI 生成，AI 不可用时降级到规则版摘要。
 * 对 UE5 二进制文件（.uasset/.umap）只根据路径推断，不声称知道内部改动。
 */

import { chatCompletion } from "@/lib/ai";

export type SvnCommit = {
  revision: string;
  author: string;          // SVN 原始 author（已由采集器映射为显示名）
  date: string;            // ISO 8601
  message: string;
  paths: string[];         // changed paths，仅临时用于生成摘要，不落库
};

export type SvnIngestPayload = {
  reportDate: string;      // YYYY-MM-DD
  collectorVersion: string;
  commits: SvnCommit[];
};

export type SvnReportResult = {
  title: string;
  summary: string;
  stats: {
    commitCount: number;
    authorCount: number;
    emptyMessageCount: number;
    hasMapChange: boolean;
    hasBlueprintChange: boolean;
    hasAnimationChange: boolean;
    hasCodeChange: boolean;
  };
  authors: string[];
  generatedBy: "ai" | "rule";
};

// -------------------------------------------------------
// 文件路径分类
// -------------------------------------------------------

function classifyPaths(paths: string[]): {
  animation: string[];
  blueprint: string[];
  map: string[];
  code: string[];
  art: string[];
  vfx: string[];
  ui: string[];
  config: string[];
  other: string[];
} {
  const result = { animation: [] as string[], blueprint: [] as string[], map: [] as string[], code: [] as string[], art: [] as string[], vfx: [] as string[], ui: [] as string[], config: [] as string[], other: [] as string[] };
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower.includes("/animation") || lower.includes("/anim") || lower.endsWith(".uasset") && (lower.includes("attack") || lower.includes("idle") || lower.includes("run") || lower.includes("jump") || lower.includes("hit") || lower.includes("anim") || lower.includes("montage"))) {
      result.animation.push(p);
    } else if (lower.includes("/blueprint") || lower.includes("/blueprints") || lower.includes("/bp_") || lower.endsWith(".uasset") && lower.includes("/content/") && !lower.includes("/art") && !lower.includes("/vfx")) {
      result.blueprint.push(p);
    } else if (lower.endsWith(".umap") || lower.includes("/maps/") || lower.includes("/levels/")) {
      result.map.push(p);
    } else if (lower.endsWith(".cpp") || lower.endsWith(".h") || lower.includes("/source/")) {
      result.code.push(p);
    } else if (lower.includes("/vfx/") || lower.includes("/effects/") || lower.includes("/particles/")) {
      result.vfx.push(p);
    } else if (lower.includes("/ui/") || lower.includes("/widgets/")) {
      result.ui.push(p);
    } else if (lower.includes("/art/") || lower.includes("/textures/") || lower.includes("/materials/") || lower.includes("/meshes/")) {
      result.art.push(p);
    } else if (lower.includes("/config/") || lower.endsWith(".ini") || lower.endsWith(".json")) {
      result.config.push(p);
    } else {
      result.other.push(p);
    }
  }
  return result;
}

function describeFile(path: string): string {
  const name = path.split("/").pop() ?? path;
  const lower = path.toLowerCase();
  if (lower.endsWith(".umap")) return `地图文件 ${name}`;
  if (lower.endsWith(".uasset")) return `资源文件 ${name}`;
  if (lower.endsWith(".cpp") || lower.endsWith(".h")) return `代码文件 ${name}`;
  return name;
}

// -------------------------------------------------------
// 计算统计数据
// -------------------------------------------------------

function buildStats(commits: SvnCommit[]) {
  const authors = [...new Set(commits.map((c) => c.author).filter(Boolean))];
  const allPaths = commits.flatMap((c) => c.paths);
  const classified = classifyPaths(allPaths);
  return {
    commitCount: commits.length,
    authorCount: authors.length,
    emptyMessageCount: commits.filter((c) => !c.message.trim()).length,
    hasMapChange: classified.map.length > 0,
    hasBlueprintChange: classified.blueprint.length > 0,
    hasAnimationChange: classified.animation.length > 0,
    hasCodeChange: classified.code.length > 0,
  };
}

// -------------------------------------------------------
// 规则版摘要（AI 不可用时的降级）
// -------------------------------------------------------

function buildRuleSummary(reportDate: string, commits: SvnCommit[]): string {
  if (commits.length === 0) {
    return `## ${reportDate} 研发日报\n\n> 今日无 SVN 提交记录。`;
  }

  const byAuthor = new Map<string, SvnCommit[]>();
  for (const c of commits) {
    const list = byAuthor.get(c.author) ?? [];
    list.push(c);
    byAuthor.set(c.author, list);
  }

  const authors = [...new Set(commits.map((c) => c.author))];
  const emptyCount = commits.filter((c) => !c.message.trim()).length;
  const allPaths = commits.flatMap((c) => c.paths);
  const classified = classifyPaths(allPaths);

  const lines: string[] = [
    `## ${reportDate} 研发日报（规则生成）`,
    ``,
    `### 今日概览`,
    ``,
    `- 参与成员：${authors.join("、")}`,
    `- 提交次数：${commits.length} 次`,
    ...(emptyCount > 0 ? [`- ⚠️ 有 ${emptyCount} 次提交未填写备注`] : []),
    ...(classified.map.length > 0 ? [`- ⚠️ 有地图文件变更（${classified.map.length} 个），请确认是否影响当前验收版本`] : []),
    ``,
    `### 按成员汇总`,
    ``,
  ];

  for (const [author, cs] of byAuthor.entries()) {
    lines.push(`**${author}**`);
    for (const c of cs) {
      const msg = c.message.trim() || "（未填写备注）";
      const pathCount = c.paths.length;
      lines.push(`- r${c.revision}：${msg}（涉及 ${pathCount} 个文件）`);
    }
    lines.push(``);
  }

  if (classified.animation.length > 0) {
    lines.push(`### 可能需要关注`);
    lines.push(``);
    lines.push(`- 有动画资源变更，建议主策划验证动作节奏和手感`);
  }
  if (classified.code.length > 0) {
    const fileNames = classified.code.slice(0, 3).map(describeFile).join("、");
    lines.push(`- 有代码文件变更（${fileNames}${classified.code.length > 3 ? " 等" : ""}），可能影响相关系统`);
  }

  return lines.join("\n");
}

// -------------------------------------------------------
// AI 版摘要
// -------------------------------------------------------

function buildAIPrompt(reportDate: string, commits: SvnCommit[]): string {
  if (commits.length === 0) {
    return `今天（${reportDate}）没有任何 SVN 提交记录。请生成一份简短的日报，说明今日无提交。`;
  }

  const byAuthor = new Map<string, SvnCommit[]>();
  for (const c of commits) {
    const list = byAuthor.get(c.author) ?? [];
    list.push(c);
    byAuthor.set(c.author, list);
  }

  const sections: string[] = [`日期：${reportDate}`, `总提交次数：${commits.length}`, ``];

  for (const [author, cs] of byAuthor.entries()) {
    sections.push(`【${author}】提交 ${cs.length} 次：`);
    for (const c of cs) {
      const msg = c.message.trim() || "（未填写备注）";
      const paths = c.paths.slice(0, 8);
      const pathDesc = paths.join("\n  ").trim();
      sections.push(`  r${c.revision} | ${msg}`);
      if (pathDesc) sections.push(`  文件：\n  ${pathDesc}`);
    }
    sections.push(``);
  }

  const emptyCount = commits.filter((c) => !c.message.trim()).length;
  if (emptyCount > 0) {
    sections.push(`⚠️ 有 ${emptyCount} 次提交未填写备注。`);
  }

  return sections.join("\n");
}

const AI_SYSTEM_PROMPT = [
  "你是米伽米游戏团队的研发日报生成助手。团队正在用 UE5 开发一款动作游戏，成员包括：主策划（负责全局跟进）、动作设计师（也做 AI 美术）、两名游戏程序员。",
  "请根据今天的 SVN 提交记录，生成一份中文团队日报。",
  "",
  "格式要求（Markdown）：",
  "1. 「今日概览」：总提交次数、参与成员，一眼可读的全局摘要。",
  "2. 「按成员汇总」：每人今天大概推进了什么，基于提交备注和文件路径推断，不要声称知道二进制文件（.uasset/.umap）内部的具体改动，只能说「可能涉及动画/蓝图/地图/资源」。",
  "3. 「需要关注或验证的内容」（如有）：动作/蓝图/地图变更需要测试验证、无备注提交需要补充说明、地图文件变更可能影响当前版本等。",
  "4. 「备注提示」（如有无备注提交）：点名哪些提交缺少备注，建议补充。",
  "",
  "语气：中性、专业、面向全员，不是个人监控报告。简洁即可，重点突出可行动的信息。",
].join("\n");

// -------------------------------------------------------
// 主入口
// -------------------------------------------------------

export async function generateSvnReport(payload: SvnIngestPayload): Promise<SvnReportResult> {
  const { reportDate, commits } = payload;
  const title = `${reportDate} 研发日报`;
  const stats = buildStats(commits);
  const authors = [...new Set(commits.map((c) => c.author).filter(Boolean))];

  const userContent = buildAIPrompt(reportDate, commits);
  let summary: string | null = null;
  let generatedBy: "ai" | "rule" = "rule";

  try {
    summary = await chatCompletion(AI_SYSTEM_PROMPT, userContent, { maxTokens: 1200, disableThinking: true });
    if (summary) generatedBy = "ai";
  } catch (e) {
    console.warn("[svn-report] AI generation failed, falling back to rule summary:", e);
  }

  if (!summary) {
    summary = buildRuleSummary(reportDate, commits);
    generatedBy = "rule";
  }

  return { title, summary, stats, authors, generatedBy };
}
