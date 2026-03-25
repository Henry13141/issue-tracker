import type { SupabaseClient } from "@supabase/supabase-js";
import type { IssueEventType } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

/**
 * 写入一条事件日志（非致命：失败只记录日志，不抛出异常）
 */
export async function writeIssueEvent(
  supabase: AnySupabase,
  params: {
    issueId: string;
    actorId?: string | null;
    eventType: IssueEventType;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("issue_events").insert({
    issue_id:      params.issueId,
    actor_id:      params.actorId ?? null,
    event_type:    params.eventType,
    event_payload: params.payload ?? {},
  });
  if (error) {
    console.error("[issue-events] write failed:", error.message, params);
  }
}

/**
 * 批量写入多个事件（顺序执行，单个失败不中断）
 */
export async function writeIssueEvents(
  supabase: AnySupabase,
  events: Parameters<typeof writeIssueEvent>[1][]
): Promise<void> {
  for (const ev of events) {
    await writeIssueEvent(supabase, ev);
  }
}
