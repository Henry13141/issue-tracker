import { getIssueEvents } from "@/actions/issues";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, GitBranch } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import type { IssueEventWithActor } from "@/types";

const EVENT_TYPE_LABELS: Record<string, string> = {
  issue_created:                 "创建了问题",
  issue_updated:                 "更新了问题信息",
  assignee_changed:              "变更了负责人",
  reviewer_changed:              "变更了审核人",
  status_changed:                "变更了状态",
  priority_changed:              "变更了优先级",
  due_date_changed:              "变更了截止日期",
  reminder_created:              "系统生成了提醒",
  reminder_sent:                 "系统发送了提醒",
  notification_delivery_success: "通知发送成功",
  notification_delivery_failed:  "通知发送失败",
  issue_reopened:                "重新打开了问题",
  issue_closed:                  "关闭了问题",
  handover:                      "交接了任务",
  handover_return:               "退回了任务（返工）",
};

function EventPayloadSummary({
  eventType,
  payload,
}: {
  eventType: string;
  payload: Record<string, unknown>;
}) {
  if (eventType === "status_changed" || eventType === "issue_reopened" || eventType === "issue_closed") {
    const from = payload.from as string | undefined;
    const to   = payload.to   as string | undefined;
    if (from && to) {
      return (
        <span className="text-xs text-muted-foreground">
          {from} → {to}
        </span>
      );
    }
  }
  if (eventType === "priority_changed") {
    return (
      <span className="text-xs text-muted-foreground">
        {payload.from as string} → {payload.to as string}
      </span>
    );
  }
  if (eventType === "due_date_changed") {
    const from = payload.from as string | null;
    const to   = payload.to   as string | null;
    return (
      <span className="text-xs text-muted-foreground">
        {from ?? "—"} → {to ?? "—"}
      </span>
    );
  }
  if (eventType === "handover" || eventType === "handover_return") {
    const note = payload.note as string | null;
    return note ? (
      <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={note}>
        {note}
      </span>
    ) : null;
  }
  return null;
}

export async function IssueEventsSection({ issueId }: { issueId: string }) {
  const events = await getIssueEvents(issueId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">事件审计轨迹</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无事件记录</p>
        ) : (
          <div className="relative space-y-0">
            {events.map((ev: IssueEventWithActor, i: number) => (
              <div key={ev.id} className="flex gap-3 pb-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  {i < events.length - 1 && (
                    <div className="w-px flex-1 bg-border" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1 pt-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium">
                      {ev.actor?.name ?? "系统"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                    </span>
                    <EventPayloadSummary eventType={ev.event_type} payload={ev.event_payload} />
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTime(ev.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
