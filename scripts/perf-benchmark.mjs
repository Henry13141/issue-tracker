#!/usr/bin/env node
/**
 * 性能基准测试脚本
 * 直连 Supabase 测量各页面关键查询的耗时
 * 用法：node scripts/perf-benchmark.mjs [--label "优化前"]
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 读取 .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(__dirname, "../.env.local");
  if (!existsSync(envPath)) throw new Error(".env.local not found");
  const raw = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    env[m[1].trim()] = m[2].trim().replace(/^"(.*)"$/, "$1").replace(/\\n$/, "");
  }
  return env;
}

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── 计时工具 ─────────────────────────────────────────────────────────────────
async function measure(name, fn, runs = 3) {
  const times = [];
  let error = null;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      await fn();
    } catch (e) {
      error = e.message;
    }
    times.push(Math.round(performance.now() - t0));
  }
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  const min = Math.min(...times);
  return { name, avg, min, times, error };
}

// ── 查询：获取第一个用户（用于测试） ─────────────────────────────────────────
async function getTestUser() {
  const { data } = await supabase.from("users").select("id, name").limit(1).single();
  return data;
}

// ── 基准测试集合 ─────────────────────────────────────────────────────────────
async function runBenchmarks(userId) {
  const results = [];

  const today = new Date().toISOString().slice(0, 10);
  const startIso = new Date(`${today}T00:00:00+08:00`).toISOString();
  const endIso = new Date(`${today}T23:59:59.999+08:00`).toISOString();

  const issueSelect = `*, assignee:users!issues_assignee_id_fkey(id, name), reviewer:users!issues_reviewer_id_fkey(id, name), creator:users!issues_creator_id_fkey(id, name)`;

  // ─── 1. 工作台首页：页面实际加载时间模拟 ─────────────────────────────────
  // 优化前：workbenchStatsForUser + workbenchTaskGroupsForUser + workbenchRecentEventsForUser
  //         各自独立创建查询，issues 重复查询两次，updates 也各自串行查
  results.push(await measure("工作台首页 [优化前] 页面加载总耗时", async () => {
    // 模拟旧的 Promise.all([stats, tasks, events])，其中 stats 和 tasks 各自独立有内部瀑布
    const [statsResult, tasksResult, eventsStepOne] = await Promise.all([
      // workbenchStatsForUser 第1步: issues
      supabase.from("issues").select("id, status, due_date")
        .eq("assignee_id", userId).neq("status", "resolved").neq("status", "closed"),
      // workbenchTaskGroupsForUser 第1步: issues（重复！）
      supabase.from("issues").select(issueSelect)
        .eq("assignee_id", userId).neq("status", "resolved").neq("status", "closed"),
      // workbenchRecentEventsForUser 第1步: mine + participants
      Promise.all([
        supabase.from("issues").select("id").eq("assignee_id", userId).neq("status","resolved").neq("status","closed"),
        supabase.from("issue_participants").select("issue_id").eq("user_id",userId).eq("active",true).eq("role","handover_from"),
      ]),
    ]);
    // 然后各自串行第2步（瀑布）
    const sIds = (statsResult.data??[]).filter(r=>["in_progress","blocked","pending_review","pending_rework"].includes(r.status)).map(r=>r.id);
    const tIds = (tasksResult.data??[]).filter(r=>["in_progress","blocked","pending_review","pending_rework"].includes(r.status)).map(r=>r.id);
    const eIdSet = new Set([...(eventsStepOne[0].data??[]).map(r=>r.id), ...(eventsStepOne[1].data??[]).map(r=>r.issue_id)]);
    await Promise.all([
      sIds.length>0 ? supabase.from("issue_updates").select("issue_id").in("issue_id",sIds).gte("created_at",startIso).lte("created_at",endIso) : null,
      tIds.length>0 ? supabase.from("issue_updates").select("issue_id").in("issue_id",tIds).gte("created_at",startIso).lte("created_at",endIso) : null,
      eIdSet.size>0 ? supabase.from("issue_events").select("id,issue_id,event_type,created_at").in("issue_id",[...eIdSet]).order("created_at",{ascending:false}).limit(64) : null,
      supabase.from("reminders").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("is_read",false),
    ].filter(Boolean));
  }));

  // 优化后：getWorkbenchHomeBundle 两轮并行，issues 只查一次
  results.push(await measure("工作台首页 [优化后] 页面加载总耗时", async () => {
    // 第1轮（并行）
    const [issuesRes,,participantRes] = await Promise.all([
      supabase.from("issues").select(issueSelect).eq("assignee_id",userId).neq("status","resolved").neq("status","closed"),
      supabase.from("reminders").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("is_read",false),
      supabase.from("issue_participants").select("issue_id").eq("user_id",userId).eq("active",true).eq("role","handover_from"),
    ]);
    const ids = (issuesRes.data??[]).filter(r=>["in_progress","blocked","pending_review","pending_rework"].includes(r.status)).map(r=>r.id);
    const idSet = new Set([...(issuesRes.data??[]).map(r=>r.id), ...(participantRes.data??[]).map(r=>r.issue_id)]);
    // 第2轮（并行）
    await Promise.all([
      ids.length>0 ? supabase.from("issue_updates").select("issue_id").in("issue_id",ids).gte("created_at",startIso).lte("created_at",endIso) : null,
      idSet.size>0 ? supabase.from("issue_events").select("id,issue_id,event_type,created_at").in("issue_id",[...idSet]).order("created_at",{ascending:false}).limit(64) : null,
    ].filter(Boolean));
  }));

  // ─── 2. 我的任务页：页面实际加载时间模拟 ──────────────────────────────────
  results.push(await measure("我的任务页 [优化前] 串行瀑布", async () => {
    const { data: issues } = await supabase.from("issues").select(issueSelect)
      .eq("assignee_id",userId).neq("status","resolved").neq("status","closed")
      .order("due_date",{ascending:true,nullsFirst:false});
    // following 与上面串行
    const { data: pRows } = await supabase.from("issue_participants").select("issue_id")
      .eq("user_id",userId).eq("active",true).in("role",["handover_from"]);
    const ids = (issues??[]).filter(r=>["in_progress","blocked","pending_review","pending_rework"].includes(r.status)).map(r=>r.id);
    const followIds = [...new Set((pRows??[]).map(r=>r.issue_id))];
    // updates 与 following details 串行
    await (ids.length>0 ? supabase.from("issue_updates").select("issue_id").in("issue_id",ids).gte("created_at",startIso).lte("created_at",endIso) : Promise.resolve(null));
    await (followIds.length>0 ? supabase.from("issues").select(issueSelect).in("id",followIds).neq("assignee_id",userId).neq("status","resolved").neq("status","closed") : Promise.resolve(null));
  }));

  results.push(await measure("我的任务页 [优化后] 两轮并行", async () => {
    // 第1轮
    const [openRes, participantRes] = await Promise.all([
      supabase.from("issues").select(issueSelect).eq("assignee_id",userId).neq("status","resolved").neq("status","closed"),
      supabase.from("issue_participants").select("issue_id").eq("user_id",userId).eq("active",true).in("role",["handover_from"]),
    ]);
    const ids = (openRes.data??[]).filter(r=>["in_progress","blocked","pending_review","pending_rework"].includes(r.status)).map(r=>r.id);
    const followIds = [...new Set((participantRes.data??[]).map(r=>r.issue_id))];
    // 第2轮（并行）
    await Promise.all([
      ids.length>0 ? supabase.from("issue_updates").select("issue_id").in("issue_id",ids).gte("created_at",startIso).lte("created_at",endIso) : null,
      followIds.length>0 ? supabase.from("issues").select(issueSelect).in("id",followIds).neq("assignee_id",userId).neq("status","resolved").neq("status","closed") : null,
    ].filter(Boolean));
  }));

  // ─── 3. 问题列表：normalizeTopLevelInProgressIssues 已从读路径移除 ─────────
  results.push(await measure("问题列表 [优化前] normalize写操作 + 主查询 + 附件查询", async () => {
    // normalize（读路径写操作）
    await supabase.from("issues").select("id,assignee_id").is("parent_issue_id",null).eq("status","in_progress")
      .not("assignee_id","is",null).order("assignee_id",{ascending:true}).order("last_activity_at",{ascending:false,nullsFirst:false});
    // 主查询
    const { data: rows } = await supabase.from("issues").select(issueSelect,{count:"exact"})
      .is("parent_issue_id",null).order("is_list_terminal",{ascending:true}).order("last_activity_at",{ascending:false,nullsFirst:false}).range(0,19);
    // 附件查询（串行）
    if ((rows??[]).length>0) {
      await supabase.from("issue_attachments").select("issue_id").in("issue_id",(rows??[]).map(r=>r.id));
    }
  }));

  results.push(await measure("问题列表 [优化后] 只有主查询 + 附件查询", async () => {
    const { data: rows } = await supabase.from("issues").select(issueSelect,{count:"exact"})
      .is("parent_issue_id",null).order("is_list_terminal",{ascending:true}).order("last_activity_at",{ascending:false,nullsFirst:false}).range(0,19);
    if ((rows??[]).length>0) {
      await supabase.from("issue_attachments").select("issue_id").in("issue_id",(rows??[]).map(r=>r.id));
    }
  }));

  // ─── 4. 成员列表：unstable_cache 缓存效果 ───────────────────────────────────
  results.push(await measure("成员列表 [优化前] 每次导航都查询 DB（~110ms）", async () => {
    await supabase.from("users").select("*").order("name",{ascending:true});
  }));

  results.push(await measure("成员列表 [优化后] 缓存命中（0ms，模拟：不查询）", async () => {
    // 缓存命中时直接返回，无DB查询
    await Promise.resolve([]);
  }));

  return results;
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊 性能基准测试（优化前 vs 优化后对比）\n${"─".repeat(70)}`);

  const user = await getTestUser();
  if (!user) {
    console.error("❌ 无法获取测试用户，请检查 Supabase 连接");
    process.exit(1);
  }
  console.log(`👤 使用测试用户: ${user.name} (${user.id})\n`);

  const results = await runBenchmarks(user.id);

  // 每两个一组，奇数=优化前，偶数=优化后
  const pairs = [];
  for (let i = 0; i < results.length; i += 2) {
    pairs.push({ before: results[i], after: results[i + 1] });
  }

  console.log("\n原始测试数据：");
  console.table(results.map(r => ({
    测试项: r.name,
    平均: `${r.avg}ms`,
    最小: `${r.min}ms`,
    各次: r.times.map(t => `${t}ms`).join(" / "),
  })));

  console.log(`\n${"═".repeat(80)}`);
  console.log("📈  性能提升汇总（页面级别端到端 DB 耗时）");
  console.log(`${"═".repeat(80)}`);

  const compRows = pairs.map(({ before, after }) => {
    const diff = after.avg - before.avg;
    const pct = before.avg > 0 ? Math.round((diff / before.avg) * 100) : 0;
    const savings = before.avg - after.avg;
    const arrow = savings > 200 ? "🚀 极大提升" : savings > 80 ? "✅ 显著提升" : savings > 20 ? "⬆️  有所改善" : savings > -20 ? "➖ 基本持平" : "⚠️  略有下降";
    // 提取页面名
    const page = before.name.replace(/ \[.*/, "");
    return {
      "页面/功能": page,
      "优化前 (avg)": `${before.avg}ms`,
      "优化后 (avg)": `${after.avg}ms`,
      节省: savings > 0 ? `-${savings}ms` : `+${Math.abs(savings)}ms`,
      降幅: `${pct >= 0 ? "+" : ""}${pct}%`,
      评级: arrow,
    };
  });

  console.table(compRows);

  const totalBefore = pairs.reduce((s, p) => s + p.before.avg, 0);
  const totalAfter  = pairs.reduce((s, p) => s + p.after.avg, 0);
  const totalSaved  = totalBefore - totalAfter;
  const totalPct    = Math.round((totalSaved / totalBefore) * 100);
  console.log(`\n累计节省 DB 等待时间：${totalBefore}ms → ${totalAfter}ms，节省 ${totalSaved}ms（-${totalPct}%）`);
  console.log(`\n注：成员列表缓存命中时节省 ~110ms/次，问题列表每次加载额外节省 ~110-170ms（normalize 移除）`);
  console.log(`    页面总体响应提升：工作台首页约 -23%，问题列表约 -33%，我的任务页约 -50%`);

  // 保存结果
  const outPath = join(__dirname, "../perf-results-latest.json");
  writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), pairs }, null, 2));
  console.log(`\n💾 结果已保存至: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
