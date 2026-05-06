"use server";

import { createClient } from "@/lib/supabase/server";

export type SvnDailyReport = {
  id: string;
  report_date: string;
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
  generated_by: "ai" | "rule";
  created_at: string;
  updated_at: string;
};

export type SvnReportsListResult = {
  reports: SvnDailyReport[];
  setupMissing: boolean;
  errorMessage?: string;
};

function isMissingTableError(error: { code?: string; message?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.message?.includes("svn_daily_reports") === true;
}

export async function getSvnReports(limit = 30): Promise<SvnReportsListResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("svn_daily_reports")
    .select("*")
    .order("report_date", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[svn-reports] getSvnReports failed:", error);
    const setupMissing = isMissingTableError(error);
    return {
      reports: [],
      setupMissing,
      errorMessage: setupMissing ? "研发日报数据表尚未初始化" : "研发日报读取失败，请稍后重试",
    };
  }
  return { reports: (data ?? []) as SvnDailyReport[], setupMissing: false };
}

export async function getSvnReport(id: string): Promise<SvnDailyReport | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("svn_daily_reports")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return data as SvnDailyReport;
}
