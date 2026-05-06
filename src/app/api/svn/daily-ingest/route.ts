/**
 * POST /api/svn/daily-ingest
 *
 * 接收本地 SVN 采集器上报的当天提交数据，生成并保存研发日报。
 * 鉴权：请求头 x-svn-ingest-secret 对比环境变量 SVN_INGEST_SECRET。
 * 同一天重复上报时更新日报，不重复创建（upsert on report_date）。
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSvnReport, type SvnCommit, type SvnIngestPayload } from "@/lib/svn-report";

const MAX_COMMITS = 500;
const MAX_PATHS_PER_COMMIT = 120;
const MAX_TOTAL_PATHS = 5000;
const MAX_AUTHOR_LENGTH = 80;
const MAX_DATE_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_PATH_LENGTH = 500;

function constantTimeEqual(a: string, b: string) {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }

  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown, maxLength: number) {
  if (typeof value === "number") return String(value).slice(0, maxLength);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function normalizePayload(body: unknown): { payload: SvnIngestPayload } | { error: string } {
  if (!isRecord(body)) return { error: "Payload must be an object" };

  const reportDate = typeof body.reportDate === "string" ? body.reportDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    return { error: "reportDate must be YYYY-MM-DD" };
  }

  if (!Array.isArray(body.commits)) {
    return { error: "commits must be an array" };
  }

  if (body.commits.length > MAX_COMMITS) {
    return { error: `commits exceeds limit ${MAX_COMMITS}` };
  }

  const commits: SvnCommit[] = [];
  let totalPaths = 0;

  for (let i = 0; i < body.commits.length; i += 1) {
    const raw = body.commits[i];
    if (!isRecord(raw)) return { error: `commit[${i}] must be an object` };

    const revision = normalizeString(raw.revision, 32);
    if (!/^\d+$/.test(revision)) {
      return { error: `commit[${i}].revision must be a numeric string` };
    }

    const rawPaths = Array.isArray(raw.paths) ? raw.paths : [];
    if (rawPaths.length > MAX_PATHS_PER_COMMIT) {
      return { error: `commit[${i}].paths exceeds limit ${MAX_PATHS_PER_COMMIT}` };
    }

    const paths = rawPaths
      .map((path) => normalizeString(path, MAX_PATH_LENGTH))
      .filter(Boolean);

    totalPaths += paths.length;
    if (totalPaths > MAX_TOTAL_PATHS) {
      return { error: `paths exceeds total limit ${MAX_TOTAL_PATHS}` };
    }

    commits.push({
      revision,
      author: normalizeString(raw.author, MAX_AUTHOR_LENGTH) || "unknown",
      date: normalizeString(raw.date, MAX_DATE_LENGTH),
      message: normalizeString(raw.message, MAX_MESSAGE_LENGTH),
      paths,
    });
  }

  return {
    payload: {
      reportDate,
      collectorVersion: normalizeString(body.collectorVersion, 40) || "unknown",
      commits,
    },
  };
}

export async function POST(req: NextRequest) {
  // 鉴权
  const secret = process.env.SVN_INGEST_SECRET;
  if (!secret) {
    console.error("[svn/daily-ingest] SVN_INGEST_SECRET is not configured");
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }
  const incoming = req.headers.get("x-svn-ingest-secret");
  if (!incoming || !constantTimeEqual(incoming, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 解析 payload
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const normalized = normalizePayload(body);
  if ("error" in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }
  const { payload: ingestPayload } = normalized;

  // 生成日报
  let report;
  try {
    report = await generateSvnReport(ingestPayload);
  } catch (e) {
    console.error("[svn/daily-ingest] generateSvnReport failed:", e);
    return NextResponse.json({ error: "Failed to generate report" }, { status: 500 });
  }

  // 写入数据库（upsert）
  const supabase = createAdminClient();
  const { error } = await supabase.from("svn_daily_reports").upsert(
    {
      report_date: ingestPayload.reportDate,
      title: report.title,
      summary: report.summary,
      stats: report.stats,
      authors: report.authors,
      generated_by: report.generatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "report_date" },
  );

  if (error) {
    console.error("[svn/daily-ingest] DB upsert failed:", error);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  revalidatePath("/svn-reports");

  return NextResponse.json({
    ok: true,
    reportDate: ingestPayload.reportDate,
    generatedBy: report.generatedBy,
    commitCount: ingestPayload.commits.length,
    authorCount: report.authors.length,
  });
}
