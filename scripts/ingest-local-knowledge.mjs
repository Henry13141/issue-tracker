#!/usr/bin/env node
/**
 * 将本地 Markdown 项目资料写入知识库并生成 RAG 向量。
 *
 * 用法：
 *   node scripts/ingest-local-knowledge.mjs
 */

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function loadEnvFile(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "").replace(/\\n/g, "").trim();
    }
  } catch {
    // .env.local is optional when vars are provided by the shell.
  }
}

loadEnvFile(resolve(process.cwd(), ".env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_EMBEDDING_URL = "https://ark.cn-beijing.volces.com/api/v3/embeddings/multimodal";
const ARK_EMBEDDING_MODEL = "doubao-embedding-vision-251215";
const MAX_CHUNK_LEN = 600;
const TARGET_DIMS = 1024;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ARK_API_KEY) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ARK_API_KEY 环境变量");
  process.exit(1);
}

const KNOWLEDGE_FILES = [
  {
    title: "问题追踪平台项目理解报告",
    slug: "issue-tracker-project-understanding",
    project_name: "问题追踪平台",
    category: "project_overview",
    module: "平台架构",
    version: "2026-04-29",
    summary: "米伽米内部协作推进与问题跟踪平台的项目定位、技术栈、应用架构、认证权限、核心业务模块、AI 能力与部署方式总览。",
    path: "/Users/haoyi/issue-tracker/PROJECT_UNDERSTANDING_REPORT.md",
  },
  {
    title: "欢乐客栈 MDA 玩法体验设计随想",
    slug: "huanlekezhan-mda-gameplay-experience",
    project_name: "GameParty",
    category: "gameplay_rule",
    module: "玩法体验设计",
    version: "1.0",
    summary: "围绕拍巴掌等关卡，从 MDA 角度梳理目标体验、核心机制、玩家动态、心理博弈与体验节奏。",
    path: "/Users/haoyi/Library/Mobile Documents/iCloud~md~obsidian/Documents/Cursor/LLM-Wiki/raw/local/projects/米伽米/欢乐客栈/游戏设计MDA-欢乐客栈的应用随想.md",
  },
  {
    title: "欢乐客栈四个关卡战报信息设计总表",
    slug: "huanlekezhan-four-level-battle-report-info-design",
    project_name: "GameParty",
    category: "ui_spec",
    module: "战报与结算 UI",
    version: "1.0",
    summary: "统一四个关卡局后战报/结算页的信息结构，包括结果反馈、玩法反馈、世界观表达、核心数据、奖励与评价语。",
    path: "/Users/haoyi/Library/Mobile Documents/iCloud~md~obsidian/Documents/Cursor/LLM-Wiki/raw/local/projects/米伽米/欢乐客栈/《欢乐客栈》四个关卡战报信息设计总表.md",
  },
  {
    title: "欢乐客栈线下体验优化方案 V1.0",
    slug: "huanlekezhan-offline-experience-optimization-v1",
    project_name: "GameParty",
    category: "operation_guide",
    module: "线下体验与商业转化",
    version: "1.0",
    summary: "针对线下体验中的重度教学、快速上手、金币奖励意义、收费体系等问题，提出降低学习成本、统一操作语义和提升商业转化的优化方案。",
    path: "/Users/haoyi/Library/Mobile Documents/iCloud~md~obsidian/Documents/Cursor/LLM-Wiki/raw/local/projects/米伽米/欢乐客栈/《欢乐客栈》线下体验优化方案 V1.0.md",
  },
];

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sbDelete(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`DELETE ${path} -> ${res.status}: ${await res.text()}`);
}

async function sbPost(path, body, prefer = "return=representation") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${await res.text()}`);
  return prefer.includes("return=representation") ? res.json() : null;
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createEmbedding(text) {
  const res = await fetch(ARK_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: ARK_EMBEDDING_MODEL,
      input: [{ type: "text", text: text.slice(0, 4000) }],
    }),
  });
  if (!res.ok) {
    console.error(`embedding API ${res.status}: ${await res.text()}`);
    return null;
  }
  const json = await res.json();
  const full = json.data?.embedding ?? null;
  if (!full) return null;
  return full.length > TARGET_DIMS ? full.slice(0, TARGET_DIMS) : full;
}

function splitIntoChunks(text, maxLen) {
  const sections = text.split(/(?=^#{2,3} )/m).filter(Boolean);
  const result = [];

  for (const section of sections) {
    if (section.length <= maxLen) {
      result.push(section);
      continue;
    }
    const paragraphs = section.split(/\n{2,}/);
    let current = "";
    for (const para of paragraphs) {
      if ((current + "\n\n" + para).length > maxLen && current) {
        result.push(current.trim());
        current = para;
      } else {
        current = current ? `${current}\n\n${para}` : para;
      }
    }
    if (current.trim()) result.push(current.trim());
  }

  return result.flatMap((chunk) => {
    if (chunk.length <= maxLen) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += maxLen) {
      parts.push(chunk.slice(i, i + maxLen));
    }
    return parts;
  });
}

async function getAdminUserId() {
  const rows = await sbGet("/users?role=eq.admin&select=id&limit=1");
  if (!rows[0]?.id) throw new Error("未找到 admin 用户，无法创建知识文章");
  return rows[0].id;
}

async function upsertArticle(file, adminUserId) {
  const content = readFileSync(file.path, "utf8").trim();
  if (!content) throw new Error(`${file.path} 内容为空`);

  const existing = await sbGet(
    `/knowledge_articles?slug=eq.${encodeURIComponent(file.slug)}&select=id,title`
  );

  const payload = {
    title: file.title,
    slug: file.slug,
    project_name: file.project_name,
    category: file.category,
    module: file.module,
    status: "approved",
    version: file.version,
    summary: file.summary,
    content,
    is_pinned: false,
    is_ai_searchable: true,
    source_type: "manual",
  };

  if (existing[0]?.id) {
    const rows = await sbPatch(`/knowledge_articles?id=eq.${existing[0].id}`, payload);
    return rows[0];
  }

  const rows = await sbPost("/knowledge_articles", {
    ...payload,
    owner_id: adminUserId,
    created_by: adminUserId,
  });
  return rows[0];
}

async function embedArticle(article) {
  const fullText = [
    article.summary ? `摘要：${article.summary}` : "",
    article.content,
  ].filter(Boolean).join("\n\n");

  const chunks = splitIntoChunks(fullText, MAX_CHUNK_LEN).filter((c) => c.trim());
  await sbDelete(`/knowledge_chunks?article_id=eq.${article.id}`);

  let success = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].trim();
    process.stdout.write(`    chunk ${i + 1}/${chunks.length}...`);
    const embedding = await createEmbedding(chunkText);
    if (!embedding) {
      console.log(" 跳过");
      continue;
    }
    await sbPost("/knowledge_chunks", {
      article_id: article.id,
      chunk_index: i,
      content: chunkText,
      category: article.category,
      module: article.module ?? null,
      status: article.status,
      version: article.version,
      metadata: {
        title: article.title,
        source_file: basename(article.slug),
        chunk_index: i,
        total_chunks: chunks.length,
      },
      embedding,
    }, "return=minimal");
    success++;
    console.log(" ✓");
  }
  return { total: chunks.length, success };
}

async function main() {
  const adminUserId = await getAdminUserId();
  const results = [];

  for (const file of KNOWLEDGE_FILES) {
    console.log(`\n▶ 入库：${file.title}`);
    const article = await upsertArticle(file, adminUserId);
    console.log(`  article_id=${article.id}`);
    const embed = await embedArticle(article);
    results.push({ title: file.title, id: article.id, ...embed });
    console.log(`  完成：${embed.success}/${embed.total} chunks`);
  }

  console.log("\n✅ 本地资料入库完成：");
  for (const item of results) {
    console.log(`- ${item.title}: ${item.success}/${item.total} chunks (${item.id})`);
  }
}

main().catch((error) => {
  console.error("\n❌ 入库失败：", error.message);
  process.exit(1);
});
