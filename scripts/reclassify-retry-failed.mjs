#!/usr/bin/env node

/**
 * 重跑上轮失败的任务（从快照文件读取失败 ID），
 * 使用更强的提示词 + 模糊匹配修正空格问题。
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";

// ─── 常量 ────────────────────────────────────────────────────────────────────

const ISSUE_CATEGORIES = ["财务", "行政", "动作设计", "图片设计", "程序开发"];

const ISSUE_MODULES = [
  "立项与需求", "玩法与系统设计", "关卡与世界构建", "角色与动画",
  "UI 与交互", "美术资产生产", "特效与渲染", "音频与音乐",
  "程序框架与工具链", "核心玩法程序", "AI 与行为系统", "物理与运动",
  "网络与多人联机", "存档与数据系统", "平台与性能优化", "测试与质量保障",
  "构建发布与运维", "商业化与运营",
];

function fuzzyMatchCategory(v) {
  if (!v) return null;
  const trimmed = v.trim();
  const found = ISSUE_CATEGORIES.find((c) => c === trimmed);
  if (found) return found;
  return null;
}

function fuzzyMatchModule(v) {
  if (!v) return null;
  const trimmed = v.trim();
  const found = ISSUE_MODULES.find((m) => m === trimmed);
  if (found) return found;
  const normalized = trimmed.replace(/\s+/g, "");
  const match = ISSUE_MODULES.find((m) => m.replace(/\s+/g, "") === normalized);
  if (match) return match;
  return null;
}

// ─── 初始化 ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const openai = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: "https://api.moonshot.cn/v1",
});

// ─── 更强的提示词 ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是 UE 游戏项目的问题分类助手。你需要判断每个问题的「分类」和「模块」。

⚠️ 重要规则：
1. 「分类」和「模块」是两个完全不同的维度，不要混淆！
2. 「分类」是"哪个部门/工种负责"，只有以下 5 个选项：
   - 财务（财务报销、薪资、社保等）
   - 行政（行政事务、文案策划、文字工作、制度流程等）
   - 动作设计（角色动作、动画制作）
   - 图片设计（UI 图片、图标、海报、视觉素材等）
   - 程序开发（代码编写、功能实现、Bug 修复）

3. 「模块」是"属于游戏开发哪个技术/制作环节"，只有以下 18 个选项：
   ${ISSUE_MODULES.map((m, i) => `${i + 1}. ${m}`).join("\n   ")}

4. 举例——"XXX文案需要新增/修改/补充"：
   分类 = 行政（文案属于文字策划工作）
   模块 = 视任务内容而定（UI提示文案→"UI 与交互"，玩法规则文案→"玩法与系统设计"，关卡结算文案→"关卡与世界构建"等）

5. 举例——"更换高清视频/更换背景底图"：
   分类 = 图片设计（视觉素材制作）
   模块 = 美术资产生产

6. 模块名中"UI 与交互"和"AI 与行为系统"在"与"前面有空格，你必须原样输出。

严格只输出一行 JSON（不要 markdown 包裹）：
{"category":"分类名","module":"模块名","reason":"一句话理由"}`;

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

function buildContext(issue, updates, attachments) {
  const lines = [];
  lines.push(`标题：${issue.title}`);
  lines.push(`描述：${issue.description || "无"}`);
  lines.push(`状态：${issue.status}  优先级：${issue.priority}`);

  if (attachments.length > 0) {
    lines.push(`附件：${attachments.map((a) => a.filename).join("、")}`);
  }

  if (updates.length > 0) {
    lines.push("\n最近进展记录：");
    for (const u of updates) {
      const when = (u.created_at || "").slice(0, 10);
      lines.push(`- [${when}] ${(u.content || "").slice(0, 300)}`);
    }
  }

  return lines.join("\n");
}

// ─── 主流程 ──────────────────────────────────────────────────────────────────

async function main() {
  const snapshotFile = "scripts/reclassify-snapshot-2026-03-31-15-30-28.json";
  const prevSnapshot = JSON.parse(readFileSync(snapshotFile, "utf-8"));
  const failedIds = new Set(
    prevSnapshot.filter((s) => s.status !== "success").map((s) => s.id)
  );

  console.log(`📋 上次快照: ${prevSnapshot.length} 条，其中 ${failedIds.size} 条需要重跑\n`);

  const { data: issues } = await supabase
    .from("issues")
    .select("id, title, description, status, priority, category, module")
    .in("id", [...failedIds])
    .order("created_at", { ascending: true });

  if (!issues || issues.length === 0) {
    console.log("没有需要重跑的任务");
    return;
  }

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

  let successCount = 0;
  let failCount = 0;
  const failures = [];
  const results = [];

  for (let idx = 0; idx < issues.length; idx++) {
    const issue = issues[idx];
    const updates = updatesByIssue[issue.id] ?? [];
    const attachments = attachmentsByIssue[issue.id] ?? [];

    const context = buildContext(issue, updates, attachments);
    const result = await askAI(context);

    if (!result || !result.category || !result.module) {
      failCount++;
      failures.push({ id: issue.id, title: issue.title, reason: "AI 无返回" });
      console.log(`  [${idx + 1}/${issues.length}] ❌ ${issue.title.slice(0, 30)} — AI 无返回`);
      continue;
    }

    const cat = fuzzyMatchCategory(result.category);
    const mod = fuzzyMatchModule(result.module);

    if (!cat || !mod) {
      failCount++;
      failures.push({
        id: issue.id,
        title: issue.title,
        reason: `非法值: cat=${result.category}, mod=${result.module}`,
      });
      console.log(`  [${idx + 1}/${issues.length}] ⚠️  ${issue.title.slice(0, 30)} — 非法值 cat=${result.category}, mod=${result.module}`);
      continue;
    }

    const { error: updateErr } = await supabase
      .from("issues")
      .update({ category: cat, module: mod })
      .eq("id", issue.id);

    if (updateErr) {
      failCount++;
      failures.push({ id: issue.id, title: issue.title, reason: updateErr.message });
      console.log(`  [${idx + 1}/${issues.length}] ❌ ${issue.title.slice(0, 30)} — 写回失败`);
      continue;
    }

    results.push({
      id: issue.id,
      title: issue.title,
      old_category: issue.category,
      old_module: issue.module,
      new_category: cat,
      new_module: mod,
      reason: result.reason ?? "",
    });
    successCount++;

    const catChanged = cat !== issue.category ? " [分类变]" : "";
    const modChanged = mod !== issue.module ? " [模块变]" : "";
    console.log(
      `  [${idx + 1}/${issues.length}] ✅ ${issue.title.slice(0, 30)} → ${cat} / ${mod}${catChanged}${modChanged}`
    );

    if (idx < issues.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // 重判后从 DB 读取最终分布
  const { data: allIssues } = await supabase
    .from("issues")
    .select("category, module");

  if (allIssues) {
    const catDist = {};
    const modDist = {};
    for (const i of allIssues) {
      const c = i.category || "(未设置)";
      const m = i.module || "(未设置)";
      catDist[c] = (catDist[c] || 0) + 1;
      modDist[m] = (modDist[m] || 0) + 1;
    }

    console.log("\n=== 最终分类分布 ===");
    for (const [k, v] of Object.entries(catDist).sort((a, b) => b[1] - a[1])) {
      const bar = "█".repeat(Math.min(v, 40));
      console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)} ${bar}`);
    }
    console.log("\n=== 最终模块分布 ===");
    for (const [k, v] of Object.entries(modDist).sort((a, b) => b[1] - a[1])) {
      const bar = "█".repeat(Math.min(v, 40));
      console.log(`  ${k.padEnd(14)} ${String(v).padStart(3)} ${bar}`);
    }
  }

  if (failures.length > 0) {
    console.log("\n=== 仍失败清单 ===");
    for (const f of failures) {
      console.log(`  ${f.title.slice(0, 40)} — ${f.reason}`);
    }
  }

  const retrySnapshotPath = `scripts/reclassify-retry-snapshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.json`;
  writeFileSync(retrySnapshotPath, JSON.stringify({ results, failures }, null, 2), "utf-8");

  console.log(`\n=== 重跑汇总 ===`);
  console.log(`  重跑: ${issues.length}`);
  console.log(`  成功: ${successCount}`);
  console.log(`  失败: ${failCount}`);
  console.log(`  快照: ${retrySnapshotPath}`);
}

main().catch((e) => {
  console.error("脚本异常退出:", e);
  process.exit(1);
});
