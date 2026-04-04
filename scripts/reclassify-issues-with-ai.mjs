#!/usr/bin/env node

/**
 * 一次性脚本：用 AI 重新判断全部 issues 的分类 (category) 和模块 (module)。
 *
 * 用法：
 *   node scripts/reclassify-issues-with-ai.mjs
 *
 * 需要环境变量（来自 .env.local）：
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   MOONSHOT_API_KEY
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { writeFileSync } from "fs";

// ─── 常量（与 src/lib/constants.ts 保持一致）────────────────────────────────

const ISSUE_CATEGORIES = ["财务", "行政", "动作设计", "图片设计", "程序开发"];

const ISSUE_MODULES = [
  "立项与需求", "玩法与系统设计", "关卡与世界构建", "角色与动画",
  "UI 与交互", "美术资产生产", "特效与渲染", "音频与音乐",
  "程序框架与工具链", "核心玩法程序", "AI 与行为系统", "物理与运动",
  "网络与多人联机", "存档与数据系统", "平台与性能优化", "测试与质量保障",
  "构建发布与运维", "商业化与运营",
];

function isValidCategory(v) { return ISSUE_CATEGORIES.includes(v); }
function isValidModule(v) { return ISSUE_MODULES.includes(v); }

// ─── 初始化 ─────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const moonshotKey = process.env.MOONSHOT_API_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!moonshotKey) {
  console.error("缺少 MOONSHOT_API_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const openai = new OpenAI({
  apiKey: moonshotKey,
  baseURL: "https://api.moonshot.cn/v1",
});

// ─── AI 调用 ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "你是 UE 游戏项目的问题分类助手。根据问题的完整上下文，判断最合适的「分类」和「模块」。",
  "",
  "旧的分类/模块仅供参考，不要因为旧值存在就沿用——必须独立判断。",
  "",
  `可选分类（只能从中选一个）：${ISSUE_CATEGORIES.join("、")}`,
  "",
  `可选模块（只能从中选一个）：${ISSUE_MODULES.join("、")}`,
  "",
  "严格只输出一行 JSON，不要 markdown 包裹：",
  '{"category":"分类名","module":"模块名","reason":"一句话理由"}',
].join("\n");

async function askAI(userContent) {
  try {
    const res = await openai.chat.completions.create({
      model: "kimi-k2.5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 256,
      thinking: { type: "disabled" },
    });
    const text = res.choices?.[0]?.message?.content?.trim();
    if (!text) return null;
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("[ai] 调用失败:", e.message ?? e);
    return null;
  }
}

// ─── 构建上下文 ─────────────────────────────────────────────────────────────

function buildContext(issue, updates, attachments) {
  const lines = [];
  lines.push(`标题：${issue.title}`);
  lines.push(`描述：${issue.description || "无"}`);
  lines.push(`当前分类：${issue.category || "未设置"}（仅供参考）`);
  lines.push(`当前模块：${issue.module || "未设置"}（仅供参考）`);
  lines.push(`状态：${issue.status}  优先级：${issue.priority}`);

  if (attachments.length > 0) {
    lines.push("");
    lines.push(`附件：${attachments.map((a) => a.filename).join("、")}`);
  }

  if (updates.length > 0) {
    lines.push("");
    lines.push("最近进展记录（从新到旧）：");
    for (const u of updates) {
      const when = (u.created_at || "").slice(0, 10);
      lines.push(`- [${when}] ${(u.content || "").slice(0, 300)}`);
    }
  }

  return lines.join("\n");
}

// ─── 分布统计 ────────────────────────────────────────────────────────────────

function calcDistribution(items, field) {
  const map = {};
  for (const it of items) {
    const val = it[field] || "(未设置)";
    map[val] = (map[val] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function printDistribution(title, dist) {
  console.log(`\n=== ${title} ===`);
  for (const [k, v] of dist) {
    const bar = "█".repeat(Math.min(v, 40));
    console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)} ${bar}`);
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 开始批量 AI 重判分类/模块...\n");

  // 1. 读取全部 issues
  const { data: issues, error: issuesErr } = await supabase
    .from("issues")
    .select("id, title, description, status, priority, category, module")
    .order("created_at", { ascending: true });

  if (issuesErr) {
    console.error("读取 issues 失败:", issuesErr.message);
    process.exit(1);
  }

  console.log(`共 ${issues.length} 条任务\n`);

  // 2. 重判前快照 + 分布
  const snapshot = issues.map((i) => ({
    id: i.id,
    title: i.title,
    old_category: i.category,
    old_module: i.module,
    new_category: null,
    new_module: null,
    reason: null,
    status: "pending",
  }));

  const beforeCatDist = calcDistribution(issues, "category");
  const beforeModDist = calcDistribution(issues, "module");
  printDistribution("重判前 — 分类分布", beforeCatDist);
  printDistribution("重判前 — 模块分布", beforeModDist);

  // 3. 批量读取进展记录和附件名
  const issueIds = issues.map((i) => i.id);

  const { data: allUpdates } = await supabase
    .from("issue_updates")
    .select("issue_id, content, created_at")
    .in("issue_id", issueIds)
    .eq("is_system_generated", false)
    .order("created_at", { ascending: false });

  const { data: allAttachments } = await supabase
    .from("issue_attachments")
    .select("issue_id, filename")
    .in("issue_id", issueIds);

  const updatesByIssue = {};
  for (const u of allUpdates ?? []) {
    const list = updatesByIssue[u.issue_id] ?? [];
    if (list.length < 10) list.push(u);
    updatesByIssue[u.issue_id] = list;
  }

  const attachmentsByIssue = {};
  for (const a of allAttachments ?? []) {
    const list = attachmentsByIssue[a.issue_id] ?? [];
    list.push(a);
    attachmentsByIssue[a.issue_id] = list;
  }

  // 4. 逐条调 AI
  let successCount = 0;
  let failCount = 0;
  const failures = [];

  for (let idx = 0; idx < issues.length; idx++) {
    const issue = issues[idx];
    const updates = updatesByIssue[issue.id] ?? [];
    const attachments = attachmentsByIssue[issue.id] ?? [];

    const context = buildContext(issue, updates, attachments);
    const result = await askAI(context);

    const entry = snapshot[idx];

    if (!result || !result.category || !result.module) {
      entry.status = "ai_failed";
      failCount++;
      failures.push({ id: issue.id, title: issue.title, reason: "AI 无返回" });
      console.log(`  [${idx + 1}/${issues.length}] ❌ ${issue.title.slice(0, 30)} — AI 无返回`);
      continue;
    }

    const cat = isValidCategory(result.category) ? result.category : null;
    const mod = isValidModule(result.module) ? result.module : null;

    if (!cat || !mod) {
      entry.status = "invalid_value";
      entry.new_category = result.category;
      entry.new_module = result.module;
      entry.reason = result.reason ?? "";
      failCount++;
      failures.push({
        id: issue.id,
        title: issue.title,
        reason: `非法值: cat=${result.category}, mod=${result.module}`,
      });
      console.log(`  [${idx + 1}/${issues.length}] ⚠️  ${issue.title.slice(0, 30)} — 非法值`);
      continue;
    }

    // 写回
    const { error: updateErr } = await supabase
      .from("issues")
      .update({ category: cat, module: mod })
      .eq("id", issue.id);

    if (updateErr) {
      entry.status = "write_failed";
      failCount++;
      failures.push({ id: issue.id, title: issue.title, reason: updateErr.message });
      console.log(`  [${idx + 1}/${issues.length}] ❌ ${issue.title.slice(0, 30)} — 写回失败`);
      continue;
    }

    entry.new_category = cat;
    entry.new_module = mod;
    entry.reason = result.reason ?? "";
    entry.status = "success";
    successCount++;

    const catChanged = cat !== issue.category ? " [分类变]" : "";
    const modChanged = mod !== issue.module ? " [模块变]" : "";
    console.log(
      `  [${idx + 1}/${issues.length}] ✅ ${issue.title.slice(0, 30)} → ${cat} / ${mod}${catChanged}${modChanged}`
    );

    // 避免 API 限流
    if (idx < issues.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 5. 重判后分布
  const afterData = snapshot
    .filter((s) => s.status === "success")
    .map((s) => ({ category: s.new_category, module: s.new_module }));
  const unchanged = snapshot
    .filter((s) => s.status !== "success")
    .map((s) => ({ category: s.old_category, module: s.old_module }));
  const combined = [...afterData, ...unchanged];

  const afterCatDist = calcDistribution(combined, "category");
  const afterModDist = calcDistribution(combined, "module");

  printDistribution("重判后 — 分类分布", afterCatDist);
  printDistribution("重判后 — 模块分布", afterModDist);

  // 6. 输出失败清单
  if (failures.length > 0) {
    console.log("\n=== 失败/跳过清单 ===");
    for (const f of failures) {
      console.log(`  ${f.title.slice(0, 40)} — ${f.reason}`);
    }
  }

  // 7. 保存快照文件
  const snapshotPath = `scripts/reclassify-snapshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

  console.log(`\n=== 汇总 ===`);
  console.log(`  总数: ${issues.length}`);
  console.log(`  成功写回: ${successCount}`);
  console.log(`  失败/跳过: ${failCount}`);
  console.log(`  快照已保存: ${snapshotPath}`);
  console.log("\n完成。");
}

main().catch((e) => {
  console.error("脚本异常退出:", e);
  process.exit(1);
});
