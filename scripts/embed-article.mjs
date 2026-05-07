#!/usr/bin/env node
/**
 * 对指定知识文章执行向量化（RAG embedding），写入 knowledge_chunks 表。
 * 用法：node scripts/embed-article.mjs <articleId>
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ARK_API_KEY) {
  console.error("缺少 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ARK_API_KEY 环境变量");
  process.exit(1);
}

const articleId = process.argv[2];
if (!articleId) {
  console.error("用法：node scripts/embed-article.mjs <articleId>");
  process.exit(1);
}

// ── Supabase REST 工具 ────────────────────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`);
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
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${await res.text()}`);
}

async function sbInsert(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`INSERT ${path} → ${res.status}: ${await res.text()}`);
}

// ── Embedding ─────────────────────────────────────────────────────────────────
// knowledge_chunks.embedding 是 vector(1024)，而模型返回 2048 维，截断前 1024 维适配。
const TARGET_DIMS = 1024;

async function createEmbedding(text) {
  const res = await fetch(ARK_EMBEDDING_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify({
      model: ARK_EMBEDDING_MODEL,
      input: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    console.error(`  embedding API ${res.status}: ${await res.text()}`);
    return null;
  }
  const json = await res.json();
  const full = json.data?.embedding ?? null;
  if (!full) return null;
  // 截断到目标维度
  return full.length > TARGET_DIMS ? full.slice(0, TARGET_DIMS) : full;
}

// ── 分块逻辑（与 knowledge.ts splitIntoChunks 一致）────────────────────────
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

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n▶ 开始向量化文章 ${articleId}\n`);

  // 1. 读取文章
  const rows = await sbGet(
    `/knowledge_articles?id=eq.${articleId}&select=id,title,summary,content,category,module,status,version`
  );
  if (!rows.length) {
    console.error("❌ 文章不存在");
    process.exit(1);
  }
  const article = rows[0];
  console.log(`  标题：${article.title}`);
  console.log(`  分类：${article.category}  状态：${article.status}`);

  // 2. 分块
  const fullText = [
    article.summary ? `摘要：${article.summary}` : "",
    article.content,
  ].filter(Boolean).join("\n\n");

  const chunks = splitIntoChunks(fullText, MAX_CHUNK_LEN).filter((c) => c.trim());
  console.log(`  分块数：${chunks.length}`);

  if (!chunks.length) {
    console.error("❌ 内容为空，无法向量化");
    process.exit(1);
  }

  // 3. 清除旧 chunks
  await sbDelete(`/knowledge_chunks?article_id=eq.${articleId}`);
  console.log("  已清除旧 chunks");

  // 4. 逐块 embedding 并写入
  let successCount = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i].trim();
    process.stdout.write(`  chunk ${i + 1}/${chunks.length} 向量化中...`);
    const embedding = await createEmbedding(chunkText);
    if (!embedding) {
      console.log(" ❌ 跳过（embedding 失败）");
      continue;
    }
    await sbInsert("/knowledge_chunks", {
      article_id: articleId,
      chunk_index: i,
      content: chunkText,
      category: article.category,
      module: article.module ?? null,
      status: article.status,
      version: article.version,
      metadata: { title: article.title, chunk_index: i, total_chunks: chunks.length },
      embedding,
    });
    successCount++;
    console.log(" ✓");
  }

  console.log(`\n✅ 完成！成功写入 ${successCount}/${chunks.length} 个 chunk\n`);
}

main().catch((e) => {
  console.error("❌ 出错：", e.message);
  process.exit(1);
});
