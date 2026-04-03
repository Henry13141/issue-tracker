"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { NotificationDeliveryWithRelations } from "@/types";
import type { NotificationListResult, NotificationFilters } from "@/actions/notifications";
import type { User } from "@/types";

// ─── 配置 ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: "发送中",
  success: "成功",
  failed:  "失败",
};
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  success: "bg-green-100  text-green-800  border-green-200",
  failed:  "bg-red-100   text-red-800   border-red-200",
};

const CHANNEL_LABELS: Record<string, string> = {
  wecom_app: "应用消息",
  wecom_bot: "群机器人",
};

const TRIGGER_LABELS: Record<string, string> = {
  cron_morning:            "早间摘要",
  cron_admin:              "推进跟踪",
  cron_daily:              "待推进提醒",
  issue_event:             "协作事件（旧）",
  "issue_event.status":    "事件·状态变更",
  "issue_event.priority":  "事件·优先级紧急",
  "issue_event.due_date":  "事件·截止提前",
  "issue_event.assignment":"事件·负责人/评审",
  "issue_event.handover":  "事件·任务交接",
  "issue_event.created":   "事件·任务创建",
  manual_test:             "手动测试",
};

// ─── Props ─────────────────────────────────────────────────────────────────

interface Props {
  initialResult: NotificationListResult;
  members: User[];
  filters: NotificationFilters & { page?: number };
}

// ─── 组件 ──────────────────────────────────────────────────────────────────

export function NotificationsClient({ initialResult, members, filters }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 本地 filter 状态（用于表单 input，Apply 后才触发 URL 更新）
  const [localFilters, setLocalFilters] = useState({
    status:        filters.status        ?? "",
    channel:       filters.channel       ?? "",
    triggerSource: filters.triggerSource ?? "",
    targetUserId:  filters.targetUserId  ?? "",
    dateFrom:      filters.dateFrom      ?? "",
    dateTo:        filters.dateTo        ?? "",
  });

  // 重试状态
  const [retryingId,  setRetryingId]  = useState<string | null>(null);
  const [retryResult, setRetryResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  function buildUrl(overrides: Partial<typeof localFilters> & { page?: number }) {
    const merged = { ...localFilters, ...overrides };
    const params = new URLSearchParams();
    if (merged.status)        params.set("status",  merged.status);
    if (merged.channel)       params.set("channel", merged.channel);
    if (merged.triggerSource) params.set("trigger", merged.triggerSource);
    if (merged.targetUserId)  params.set("user",    merged.targetUserId);
    if (merged.dateFrom)      params.set("from",    merged.dateFrom);
    if (merged.dateTo)        params.set("to",      merged.dateTo);
    const page = (overrides as { page?: number }).page;
    if (page && page > 1) params.set("page", String(page));
    return `/dashboard/notifications?${params.toString()}`;
  }

  function applyFilters() {
    startTransition(() => { router.push(buildUrl({ page: 1 })); });
  }

  function resetFilters() {
    setLocalFilters({ status: "", channel: "", triggerSource: "", targetUserId: "", dateFrom: "", dateTo: "" });
    startTransition(() => { router.push("/dashboard/notifications"); });
  }

  async function handleRetry(id: string) {
    setRetryingId(id);
    try {
      const res = await fetch(`/api/admin/notifications/${id}/retry`, { method: "POST" });
      const json = await res.json() as { ok?: boolean; error?: string; error_code?: string };
      if (json.ok) {
        setRetryResult((p) => ({ ...p, [id]: { ok: true, msg: "重试成功" } }));
        router.refresh();
      } else {
        setRetryResult((p) => ({ ...p, [id]: { ok: false, msg: json.error ?? json.error_code ?? "重试失败" } }));
      }
    } catch (e) {
      setRetryResult((p) => ({ ...p, [id]: { ok: false, msg: e instanceof Error ? e.message : "网络错误" } }));
    } finally {
      setRetryingId(null);
    }
  }

  const { data, total, page, totalPages, error } = initialResult;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          通知日志查询失败：{error}
        </div>
      )}

      {/* ── 筛选器 ── */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {/* Status */}
            <Select value={localFilters.status} onValueChange={(v) => setLocalFilters((p) => ({ ...p, status: (v ?? "") === "_all" ? "" : (v ?? "") }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">全部状态</SelectItem>
                <SelectItem value="success">成功</SelectItem>
                <SelectItem value="failed">失败</SelectItem>
                <SelectItem value="pending">发送中</SelectItem>
              </SelectContent>
            </Select>

            {/* Channel */}
            <Select value={localFilters.channel} onValueChange={(v) => setLocalFilters((p) => ({ ...p, channel: (v ?? "") === "_all" ? "" : (v ?? "") }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="渠道" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">全部渠道</SelectItem>
                <SelectItem value="wecom_app">应用消息</SelectItem>
                <SelectItem value="wecom_bot">群机器人</SelectItem>
              </SelectContent>
            </Select>

            {/* Trigger */}
            <Select value={localFilters.triggerSource} onValueChange={(v) => setLocalFilters((p) => ({ ...p, triggerSource: (v ?? "") === "_all" ? "" : (v ?? "") }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="触发来源" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">全部来源</SelectItem>
                <SelectItem value="cron_morning">早间摘要</SelectItem>
                <SelectItem value="cron_admin">推进跟踪</SelectItem>
                <SelectItem value="cron_daily">待推进提醒</SelectItem>
                <SelectItem value="issue_event">协作事件（旧）</SelectItem>
                <SelectItem value="issue_event.status">事件·状态变更</SelectItem>
                <SelectItem value="issue_event.assignment">事件·负责人/评审</SelectItem>
                <SelectItem value="issue_event.handover">事件·任务交接</SelectItem>
                <SelectItem value="issue_event.priority">事件·优先级紧急</SelectItem>
                <SelectItem value="issue_event.due_date">事件·截止提前</SelectItem>
                <SelectItem value="issue_event.created">事件·任务创建</SelectItem>
                <SelectItem value="manual_test">手动测试</SelectItem>
              </SelectContent>
            </Select>

            {/* Target user */}
            <Select value={localFilters.targetUserId} onValueChange={(v) => setLocalFilters((p) => ({ ...p, targetUserId: (v ?? "") === "_all" ? "" : (v ?? "") }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="接收人" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_all">全部成员</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date from */}
            <Input
              type="date"
              className="h-8 text-xs"
              value={localFilters.dateFrom}
              onChange={(e) => setLocalFilters((p) => ({ ...p, dateFrom: e.target.value }))}
              placeholder="开始日期"
            />

            {/* Date to */}
            <Input
              type="date"
              className="h-8 text-xs"
              value={localFilters.dateTo}
              onChange={(e) => setLocalFilters((p) => ({ ...p, dateTo: e.target.value }))}
              placeholder="结束日期"
            />
          </div>

          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={applyFilters} disabled={isPending}>
              {isPending ? "搜索中…" : "应用筛选"}
            </Button>
            <Button size="sm" variant="ghost" onClick={resetFilters} disabled={isPending}>
              重置
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── 统计 ── */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {total} 条记录，第 {page} / {Math.max(1, totalPages)} 页</span>
      </div>

      {/* ── 列表 ── */}
      {error ? (
        <div className="rounded-lg border border-dashed border-red-200 p-10 text-center text-sm text-red-600">
          通知日志暂时无法加载，请先检查数据库表和查询配置。
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          暂无匹配的投递记录
        </div>
      ) : (
        <div className="space-y-2">
          {data.map((item) => (
            <DeliveryRow
              key={item.id}
              item={item}
              retrying={retryingId === item.id}
              retryResult={retryResult[item.id]}
              onRetry={handleRetry}
            />
          ))}
        </div>
      )}

      {/* ── 分页 ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1 || isPending}
            onClick={() => startTransition(() => router.push(buildUrl({ page: page - 1 })))}
          >
            上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={page >= totalPages || isPending}
            onClick={() => startTransition(() => router.push(buildUrl({ page: page + 1 })))}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── 单条记录 ──────────────────────────────────────────────────────────────

function DeliveryRow({
  item,
  retrying,
  retryResult,
  onRetry,
}: {
  item: NotificationDeliveryWithRelations;
  retrying: boolean;
  retryResult?: { ok: boolean; msg: string };
  onRetry: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border bg-card text-card-foreground px-4 py-3 space-y-2">
      {/* 主行 */}
      <div className="flex flex-wrap items-start gap-2">
        {/* 状态 */}
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_COLORS[item.status] ?? "")}>
          {STATUS_LABELS[item.status] ?? item.status}
        </span>

        {/* 渠道 */}
        <Badge variant="outline" className="text-xs">
          {CHANNEL_LABELS[item.channel] ?? item.channel}
        </Badge>

        {/* 触发来源 */}
        <Badge variant="secondary" className="text-xs">
          {TRIGGER_LABELS[item.trigger_source] ?? item.trigger_source}
        </Badge>

        {/* 接收人 */}
        {(item.target_user?.name ?? item.target_wecom_userid) && (
          <span className="text-xs text-muted-foreground">
            → {item.target_user?.name ?? item.target_wecom_userid}
            {item.target_wecom_userid && (
              <span className="ml-1 font-mono opacity-60">({item.target_wecom_userid})</span>
            )}
          </span>
        )}

        {/* 尝试次数 */}
        {item.attempt_count > 1 && (
          <span className="text-xs text-muted-foreground">第 {item.attempt_count} 次尝试</span>
        )}

        {/* 时间 */}
        <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
          {formatDt(item.created_at)}
          {item.sent_at && (
            <span className="ml-1 text-green-600">→ {formatDt(item.sent_at)}</span>
          )}
        </span>
      </div>

      {/* 标题 / 关联 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {item.title && <span className="font-medium">{item.title}</span>}
        {item.issue && (
          <a href={`/issues/${item.issue.id}`} className="text-xs text-blue-600 hover:underline">
            工单：{item.issue.title}
          </a>
        )}
      </div>

      {/* 错误信息 */}
      {item.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-red-50 border border-red-200 px-2 py-0.5 text-xs font-mono text-red-700">
            {item.error_code}
          </span>
          {item.error_message && (
            <span className="text-xs text-red-600">{item.error_message}</span>
          )}
        </div>
      )}

      {/* 重试反馈 */}
      {retryResult && (
        <div className={cn("text-xs px-2 py-1 rounded", retryResult.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
          {retryResult.msg}
        </div>
      )}

      {/* 操作行 */}
      <div className="flex gap-2 items-center">
        {item.status === "failed" && (
          <Button
            size="sm" variant="outline" className="h-7 text-xs"
            disabled={retrying}
            onClick={() => onRetry(item.id)}
          >
            {retrying ? "重试中…" : "重试"}
          </Button>
        )}
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "收起详情" : "查看详情"}
        </button>
      </div>

      {/* 展开的详情 */}
      {expanded && (
        <div className="rounded bg-muted/50 p-3 text-xs space-y-1 font-mono">
          <div><span className="text-muted-foreground">id:</span> {item.id}</div>
          <div><span className="text-muted-foreground">delivery_id:</span> {item.id}</div>
          {item.target_wecom_userid && (
            <div><span className="text-muted-foreground">wecom_userid:</span> {item.target_wecom_userid}</div>
          )}
          {item.reminder_id && (
            <div><span className="text-muted-foreground">reminder_id:</span> {item.reminder_id}</div>
          )}
          <div className="mt-1">
            <div className="text-muted-foreground mb-0.5">provider_response:</div>
            <pre className="whitespace-pre-wrap break-all text-xs bg-background rounded p-2">
              {JSON.stringify(item.provider_response, null, 2)}
            </pre>
          </div>
          <div className="mt-1">
            <div className="text-muted-foreground mb-0.5">content (截断到 300 字符):</div>
            <pre className="whitespace-pre-wrap break-all text-xs bg-background rounded p-2">
              {item.content.slice(0, 300)}{item.content.length > 300 ? "…" : ""}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function formatDt(iso: string) {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch {
    return iso;
  }
}
