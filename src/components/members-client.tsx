"use client";

import { useTransition } from "react";
import Link from "next/link";
import { updateUserWecomUserId } from "@/actions/members";
import type { MemberWorkloadRow, NotificationCoverage } from "@/lib/dashboard-queries";
import type { User } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── 企业微信配置行 ────────────────────────────────────────────────────────

function MemberRow({ member }: { member: User }) {
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    const value = (formData.get("wecom_userid") as string) ?? "";
    startTransition(async () => {
      const r = await updateUserWecomUserId(member.id, value);
      if (r.ok) toast.success(`${member.name} 的企业微信 userid 已保存`);
      else toast.error(r.error ?? "保存失败");
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {member.name}
        {!member.wecom_userid?.trim() && (
          <span className="ml-2 text-[10px] text-orange-500 font-normal">无 userid</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{member.email}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {member.role === "admin" ? "管理员" : "成员"}
      </TableCell>
      <TableCell>
        <form action={save} className="flex flex-wrap items-center gap-2">
          <Input
            name="wecom_userid"
            defaultValue={member.wecom_userid ?? ""}
            placeholder="企业微信通讯录 userid"
            className="max-w-xs"
            disabled={pending}
          />
          <Button type="submit" size="sm" disabled={pending}>保存</Button>
        </form>
      </TableCell>
    </TableRow>
  );
}

function SendGroupInviteButton({ webhookConfigured }: { webhookConfigured: boolean }) {
  const [pending, startTransition] = useTransition();

  if (!webhookConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        未配置环境变量 WECOM_WEBHOOK_URL 时，无法从本页向工作群推送消息。可在企业微信群里手动粘贴邀请说明。
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        通过已绑定的群机器人向工作群发送纯文字登录引导（链接来自 NEXT_PUBLIC_APP_URL）。
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        className="shrink-0"
        onClick={() =>
          startTransition(async () => {
            const res = await fetch("/api/admin/wecom/group-text", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ preset: "onboarding" }),
            });
            const data = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              toast.error(data.error ?? "发送失败");
              return;
            }
            toast.success("已发送到工作群");
          })
        }
      >
        向工作群发送登录邀请
      </Button>
    </div>
  );
}

// ─── 成员负载行 ────────────────────────────────────────────────────────────

function WorkloadRow({ row }: { row: MemberWorkloadRow }) {
  return (
    <TableRow className="hover:bg-muted/20">
      <TableCell>
        <div className="font-medium">{row.name}</div>
        {!row.wecomUserId && (
          <div className="text-[10px] text-orange-500">无企业微信 userid（无法通知）</div>
        )}
      </TableCell>
      <TableCell className="text-center">{row.total}</TableCell>
      <TableCell className="text-center">
        {row.overdue > 0 ? <span className="font-semibold text-orange-600">{row.overdue}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-center">
        {row.stale > 0 ? <span className="font-semibold text-yellow-600">{row.stale}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-center">
        {row.blocked > 0 ? <span className="font-semibold text-purple-600">{row.blocked}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-center">
        {row.urgent > 0 ? <span className="font-bold text-red-600">{row.urgent}</span> : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-center">{row.updates7Days || <span className="text-muted-foreground">0</span>}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.lastActivityAt ? formatDateTime(row.lastActivityAt) : "—"}</TableCell>
      <TableCell>
        <Link href={`/issues?assignee=${row.userId}`} className="text-xs text-blue-600 hover:underline whitespace-nowrap">
          查看工单 →
        </Link>
      </TableCell>
    </TableRow>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────

export function MembersClient({
  members,
  workload,
  coverage,
  groupWebhookConfigured,
}: {
  members: User[];
  workload: MemberWorkloadRow[];
  coverage: NotificationCoverage;
  groupWebhookConfigured: boolean;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">成员与企业微信</h1>
        <p className="text-muted-foreground text-sm">
          管理成员企业微信 userid 配置，查看工作负载与通知覆盖率
        </p>
      </div>

      {/* ── 通知覆盖率 ── */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4 text-center">
          <div className="text-2xl font-bold">{coverage.total}</div>
          <div className="mt-1 text-xs text-muted-foreground">成员总数</div>
        </div>
        <div className="rounded-lg border bg-green-50 p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{coverage.withWecom}</div>
          <div className="mt-1 text-xs text-muted-foreground">已配置 userid</div>
        </div>
        <div className={cn("rounded-lg border p-4 text-center", coverage.withoutWecom > 0 ? "bg-orange-50" : "bg-card")}>
          <div className={cn("text-2xl font-bold", coverage.withoutWecom > 0 ? "text-orange-600" : "")}>
            {coverage.withoutWecom}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">未配置（无法通知）</div>
        </div>
        <div className="rounded-lg border bg-card p-4 text-center">
          <div className="text-2xl font-bold">{coverage.coverageRate}%</div>
          <div className="mt-1 text-xs text-muted-foreground">通知覆盖率</div>
        </div>
      </div>

      {coverage.withoutWecom > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          ⚠ 有 {coverage.withoutWecom} 位成员未配置企业微信 userid，每日催办无法通知到人，会影响催办闭环。请在下方「企业微信配置」中补充。
        </div>
      )}

      <Tabs defaultValue="wecom">
        <TabsList>
          <TabsTrigger value="wecom">企业微信配置</TabsTrigger>
          <TabsTrigger value="workload">成员负载（{workload.length}人有在办工单）</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: 企业微信配置 ── */}
        <TabsContent value="wecom" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>企业微信 userid</CardTitle>
              <CardDescription>
                获取方式：企业微信管理后台 → 通讯录 → 点击成员 → 查看 userid。需为应用开通「发送应用消息」权限。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <SendGroupInviteButton webhookConfigured={groupWebhookConfigured} />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>企业微信 userid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => <MemberRow key={m.id} member={m} />)}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Tab 2: 成员负载 ── */}
        <TabsContent value="workload" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>成员工作负载</CardTitle>
              <CardDescription>当前未关闭工单分布，逾期/阻塞/3天未更新/紧急高亮显示</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {workload.length === 0 ? (
                <p className="px-6 py-4 text-sm text-muted-foreground">暂无数据（无未关闭工单）</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 text-xs">
                      <TableHead>成员</TableHead>
                      <TableHead className="text-center">在办</TableHead>
                      <TableHead className="text-center">逾期</TableHead>
                      <TableHead className="text-center">3天未更新</TableHead>
                      <TableHead className="text-center">阻塞</TableHead>
                      <TableHead className="text-center">紧急</TableHead>
                      <TableHead className="text-center">7天更新次数</TableHead>
                      <TableHead>最近活动</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {workload.map((row) => <WorkloadRow key={row.userId} row={row} />)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
