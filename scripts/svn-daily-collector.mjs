#!/usr/bin/env node
/**
 * SVN 每日研发日报采集器
 *
 * 用法：
 *   node svn-daily-collector.mjs [选项]
 *
 * 选项：
 *   --config <path>      配置文件路径（默认：同目录下 svn-collector.config.json）
 *   --dry-run            只解析数据，不推送到平台（用于调试）
 *   --fixture <path>     使用模拟 SVN XML 文件替代真实 svn log 命令（用于 MacBook 测试）
 *   --date <YYYY-MM-DD>  指定采集日期（默认：今天，北京时间）
 *
 * 示例：
 *   node svn-daily-collector.mjs --dry-run
 *   node svn-daily-collector.mjs --fixture ./svn-fixture.xml --dry-run
 *   node svn-daily-collector.mjs --config D:\svn-collector.config.json
 *
 * 配置文件格式：见 svn-collector.config.example.json
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── 参数解析 ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

const isDryRun = args.includes("--dry-run");
const fixturePath = getArg("--fixture");
const configPath = getArg("--config") ?? resolve(__dirname, "svn-collector.config.json");
const dateArg = getArg("--date");

// ─── 日志工具 ───────────────────────────────────────────────────────────────

let logFile = null;

function log(level, ...parts) {
  const ts = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const line = `[${ts}] [${level}] ${parts.join(" ")}`;
  console.log(line);
  if (logFile) {
    appendFileSync(logFile, line + "\n", "utf8");
  }
}

function info(...parts) { log("INFO", ...parts); }
function warn(...parts) { log("WARN", ...parts); }
function error(...parts) { log("ERROR", ...parts); }

// ─── 配置加载 ───────────────────────────────────────────────────────────────

function loadConfig(allowMinimal = false) {
  if (!existsSync(configPath)) {
    if (allowMinimal) {
      info("未找到配置文件，使用最小配置（dry-run 模式）");
      return { workingCopyPath: "", platformUrl: "", ingestSecret: "", authorMap: {}, timezone: "Asia/Shanghai", logDir: null };
    }
    throw new Error(`配置文件不存在：${configPath}\n请先复制 svn-collector.config.example.json 并填写配置`);
  }
  const raw = readFileSync(configPath, "utf8");
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`配置文件不是有效 JSON：${msg}`);
  }

  // dry-run + fixture 模式下不要求平台相关配置
  if (!allowMinimal) {
    const required = ["workingCopyPath", "platformUrl", "ingestSecret"];
    for (const key of required) {
      if (!cfg[key]) throw new Error(`配置项 ${key} 不能为空`);
    }
  }

  cfg.authorMap = cfg.authorMap ?? {};
  cfg.timezone = cfg.timezone ?? "Asia/Shanghai";
  cfg.logDir = cfg.logDir ?? null;

  return cfg;
}

// ─── 日期工具 ───────────────────────────────────────────────────────────────

function getChinaToday() {
  return new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .slice(0, 10); // YYYY-MM-DD
}

function validateReportDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`日期格式不正确：${dateStr}，应为 YYYY-MM-DD`);
  }
  return dateStr;
}

function getDayBounds(dateStr) {
  // 返回北京时间当天 00:00 和 23:59:59 的 ISO 格式
  const start = `${dateStr}T00:00:00+08:00`;
  const end = `${dateStr}T23:59:59+08:00`;
  return { start, end };
}

// ─── SVN 预检 ───────────────────────────────────────────────────────────────

function checkSvnAvailable() {
  try {
    execFileSync("svn", ["--version", "--quiet"], { stdio: "pipe", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function checkWorkingCopy(wcPath) {
  if (!existsSync(wcPath)) {
    throw new Error(`SVN 工作副本路径不存在：${wcPath}`);
  }
  try {
    execFileSync("svn", ["info", wcPath], { stdio: "pipe", timeout: 15000 });
  } catch {
    throw new Error(`路径 ${wcPath} 不是有效的 SVN 工作副本，请确认路径正确`);
  }
}

// ─── SVN 日志读取 ───────────────────────────────────────────────────────────

function fetchSvnLogXml(wcPath, dateStr) {
  const { start, end } = getDayBounds(dateStr);
  // -r {DATE}:{DATE} 按时间范围过滤，-v 显示文件列表，--xml 输出 XML
  const args = ["log", wcPath, "-r", `{${start}}:{${end}}`, "-v", "--xml", "--limit", "500"];
  info(`执行命令：svn ${args.map((arg) => (arg.includes(" ") ? `"${arg}"` : arg)).join(" ")}`);
  try {
    const output = execFileSync("svn", args, {
      timeout: 60000,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return output;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`SVN 命令执行失败：${msg}`);
  }
}

// ─── XML 解析 ───────────────────────────────────────────────────────────────

function parseSvnLogXml(xml, authorMap) {
  const commits = [];

  // 简单正则解析，避免引入 XML 解析库依赖
  const entryRegex = /<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const revision = match[1];
    const body = match[2];

    const author = extractTag(body, "author") ?? "unknown";
    const date = extractTag(body, "date") ?? "";
    const message = (extractTag(body, "msg") ?? "").trim();

    const paths = [];
    const pathRegex = /<path[^>]*>([^<]+)<\/path>/g;
    let pm;
    while ((pm = pathRegex.exec(body)) !== null) {
      paths.push(decodeXmlText(pm[1].trim()));
    }

    const displayName = authorMap[author] ?? author;

    commits.push({ revision, author: displayName, date, message, paths });
  }

  return commits;
}

function extractTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`).exec(xml);
  return m ? decodeXmlText(m[1].trim()) : null;
}

function decodeXmlText(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// ─── 推送到平台 ─────────────────────────────────────────────────────────────

const PUSH_MAX_RETRIES = 3;
const PUSH_RETRY_DELAY_MS = 3000;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pushToPlatform(cfg, reportDate, commits) {
  const payload = {
    reportDate,
    collectorVersion: "1.0.0",
    commits,
  };

  const url = cfg.platformUrl.replace(/\/$/, "") + "/api/svn/daily-ingest";
  info(`推送到平台：${url}`);
  info(`提交数量：${commits.length}`);

  let lastError;
  for (let attempt = 1; attempt <= PUSH_MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      info(`第 ${attempt} 次重试，等待 ${PUSH_RETRY_DELAY_MS / 1000}s…`);
      await sleep(PUSH_RETRY_DELAY_MS);
    }

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-svn-ingest-secret": cfg.ingestSecret,
        },
        body: JSON.stringify(payload),
      });
    } catch (fetchErr) {
      lastError = new Error(`网络请求失败：${fetchErr.message}`);
      warn(`推送失败（attempt ${attempt}/${PUSH_MAX_RETRIES}）：${lastError.message}`);
      continue;
    }

    const text = await res.text();

    // 4xx 鉴权/参数错误不重试，直接抛出
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`平台返回 ${res.status}（不重试）：${text}`);
    }

    if (!res.ok) {
      lastError = new Error(`平台返回错误 ${res.status}：${text}`);
      warn(`推送失败（attempt ${attempt}/${PUSH_MAX_RETRIES}）：${lastError.message}`);
      continue;
    }

    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = text;
    }
    return result;
  }

  throw lastError ?? new Error("推送失败，已用尽重试次数");
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

async function main() {
  info("=== SVN 研发日报采集器启动 ===");
  if (isDryRun) info("【演练模式】只解析数据，不推送到平台");
  if (fixturePath) info(`【Fixture 模式】使用模拟数据：${fixturePath}`);

  // 1. 加载配置（dry-run + fixture 模式允许无配置文件）
  const allowMinimal = isDryRun && Boolean(fixturePath);
  let cfg;
  try {
    cfg = loadConfig(allowMinimal);
    if (existsSync(configPath)) info(`配置已加载：${configPath}`);
  } catch (e) {
    error(e.message);
    process.exit(1);
  }

  // 设置日志文件
  if (cfg.logDir) {
    try {
      mkdirSync(cfg.logDir, { recursive: true });
      logFile = resolve(cfg.logDir, `svn-collector-${new Date().toISOString().slice(0, 10)}.log`);
      info(`日志文件：${logFile}`);
    } catch {
      warn(`无法创建日志目录：${cfg.logDir}`);
    }
  }

  // 2. 确定采集日期
  let reportDate;
  try {
    reportDate = validateReportDate(dateArg ?? getChinaToday());
  } catch (e) {
    error(e.message);
    process.exit(1);
  }
  info(`采集日期：${reportDate}`);

  // 3. 获取 SVN 日志 XML
  let xml;

  if (fixturePath) {
    // Fixture 模式：从文件读取
    const absFixture = resolve(fixturePath);
    if (!existsSync(absFixture)) {
      error(`Fixture 文件不存在：${absFixture}`);
      process.exit(1);
    }
    xml = readFileSync(absFixture, "utf8");
    info(`已读取 Fixture 文件，长度：${xml.length} 字符`);
  } else {
    // 真实模式
    if (!checkSvnAvailable()) {
      error("svn.exe 不可用。请先安装 Subversion 命令行工具：");
      error("  推荐方式：在 TortoiseSVN 安装时勾选「command line client tools」");
      error("  或安装 SlikSVN：https://www.sliksvn.com/en/download");
      error("  安装后重新打开终端，确认 svn --version 可以执行");
      process.exit(1);
    }
    info("svn.exe 可用");

    try {
      checkWorkingCopy(cfg.workingCopyPath);
      info(`工作副本验证通过：${cfg.workingCopyPath}`);
    } catch (e) {
      error(e.message);
      process.exit(1);
    }

    try {
      xml = fetchSvnLogXml(cfg.workingCopyPath, reportDate);
    } catch (e) {
      error(e.message);
      process.exit(1);
    }
  }

  // 4. 解析 SVN XML
  const commits = parseSvnLogXml(xml, cfg.authorMap ?? {});
  info(`解析到 ${commits.length} 条提交记录`);

  if (commits.length === 0) {
    info(`今日（${reportDate}）暂无 SVN 提交，仍会推送"无提交"日报`);
  } else {
    const byAuthor = {};
    for (const c of commits) {
      byAuthor[c.author] = (byAuthor[c.author] ?? 0) + 1;
    }
    for (const [author, count] of Object.entries(byAuthor)) {
      info(`  ${author}：${count} 次提交`);
    }
    const emptyCount = commits.filter((c) => !c.message.trim()).length;
    if (emptyCount > 0) {
      warn(`  ⚠️ ${emptyCount} 次提交未填写备注`);
    }
  }

  // 5. 推送或演练
  if (isDryRun) {
    info("【演练模式】以下是将要推送的 payload（前 3 条提交）：");
    const preview = {
      reportDate,
      collectorVersion: "1.0.0",
      commits: commits.slice(0, 3),
      totalCommits: commits.length,
    };
    console.log(JSON.stringify(preview, null, 2));
    info("【演练模式】完成，未实际推送");
    return;
  }

  try {
    const result = await pushToPlatform(cfg, reportDate, commits);
    info("推送成功！平台响应：", JSON.stringify(result));
  } catch (e) {
    error(`推送失败：${e.message}`);
    process.exit(1);
  }

  info("=== 采集器运行完成 ===");
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exit(1);
});
