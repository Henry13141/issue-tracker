"use client";

import { useMemo, useTransition, useState } from "react";
import Link from "next/link";
import { updateUserWecomUserId, updateUserName, removeMember, updateUserRole } from "@/actions/members";
import type { MemberWorkloadRow, NotificationCoverage } from "@/lib/dashboard-queries";
import type { User, UserRole } from "@/types";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDateTime } from "@/lib/dates";
import { getUserRoleLabel } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Pencil, Trash2, Check, X } from "lucide-react";

// ─── 企业微信配置行 ────────────────────────────────────────────────────────

function MemberRow({ member, currentUserId }: { member: User; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(member.name ?? "");
  const [roleValue, setRoleValue] = useState<UserRole>(member.role);

  function saveWecomId(formData: FormData) {
    const value = (formData.get("wecom_userid") as string) ?? "";
    startTransition(async () => {
      const r = await updateUserWecomUserId(member.id, value);
      if (r.ok) toast.success(`${member.name} 的企业微信 userid 已配置，后续通知可以送达了`);
      else toast.error(r.error ?? "保存没成功，可以再试一次");
    });
  }

  function saveName() {
    startTransition(async () => {
      const r = await updateUserName(member.id, nameValue);
      if (r.ok) {
        toast.success("名称已更新，同事们会看到新的显示名");
        setEditingName(false);
      } else {
        toast.error(r.error ?? "保存没成功，可以再试一次");
      }
    });
  }

  function cancelEditName() {
    setNameValue(member.name ?? "");
    setEditingName(false);
  }

  function handleRemove() {
    startTransition(async () => {
      const r = await removeMember(member.id);
      if (r.ok) toast.success(`成员 ${member.name} 已移除`);
      else toast.error(r.error ?? "移除没成功，可以稍后再试");
    });
  }

  function saveRole() {
    startTransition(async () => {
      const r = await updateUserRole(member.id, roleValue);
      if (r.ok) {
        toast.success(
          roleValue === "finance"
            ? `${member.name} 已设为财务人员`
            : roleValue === "admin"
              ? `${member.name} 已设为管理员`
              : `${member.name} 已设为普通成员`
        );
      } else {
        toast.error(r.error ?? "角色更新没成功，可以稍后再试");
      }
    });
  }

  const isSelf = member.id === currentUserId;

  return (
    <TableRow>
      {/* 姓名列：内联编辑 */}
      <TableCell className="font-medium">
        {editingName ? (
          <div className="flex items-center gap-1">
            <Input
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="h-7 w-28 text-sm px-2"
              disabled={pending}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") cancelEditName();
              }}
              autoFocus
            />
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveName} disabled={pending}>
              <Check className="h-3.5 w-3.5 text-green-600" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={cancelEditName} disabled={pending}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1 group">
            <span>{member.name}</span>
            {!member.wecom_userid?.trim() && (
              <span className="ml-1 text-[10px] text-orange-500 font-normal">无 userid</span>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditingName(true)}
              title="修改名称"
            >
              <Pencil className="h-3 w-3 text-muted-foreground" />
            </Button>
          </div>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">{member.email}</TableCell>
      <TableCell className="text-muted-foreground text-sm">
        <div className="flex items-center gap-2">
          <select
            value={roleValue}
            onChange={(e) => setRoleValue(e.target.value as UserRole)}
            disabled={pending || isSelf}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="member">成员</option>
            <option value="finance">财务人员</option>
            <option value="admin">管理员</option>
          </select>
          {!isSelf && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || roleValue === member.role}
              onClick={saveRole}
            >
              保存
            </Button>
          )}
          {isSelf && <span className="text-xs text-muted-foreground">{getUserRoleLabel(member.role)}</span>}
        </div>
      </TableCell>
      {/* 企业微信 userid */}
      <TableCell>
        <form action={saveWecomId} className="flex flex-wrap items-center gap-2">
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
      <TableCell className="text-sm text-muted-foreground">
        {member.role === "finance" ? "可见财务行政待办" : "—"}
      </TableCell>
      {/* 移除按钮 */}
      <TableCell>
        {!isSelf && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-red-600" title="移除成员" disabled={pending}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>移除成员</AlertDialogTitle>
                <AlertDialogDescription>
                  确定要移除「{member.name}」吗？该成员的账号将被删除，名下工单不受影响。此操作不可撤销。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700"
                  onClick={handleRemove}
                >
                  确认移除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
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
              toast.error(data.error ?? "发送没成功，可以稍后再试");
              return;
            }
            toast.success("登录邀请已发到工作群，同事们可以扫码加入了");
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
  currentUserId,
}: {
  members: User[];
  workload: MemberWorkloadRow[];
  coverage: NotificationCoverage;
  groupWebhookConfigured: boolean;
  currentUserId: string;
}) {
  const [memberFilter, setMemberFilter] = useState<"all" | "finance">("all");
  const financeMembers = useMemo(
    () => members.filter((member) => member.role === "finance"),
    [members]
  );
  const visibleMembers = memberFilter === "finance" ? financeMembers : members;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">成员与企业微信</h1>
        <p className="text-muted-foreground text-sm">
          管理成员企业微信 userid 配置，查看工作负载与通知覆盖率
        </p>
      </div>

      {/* ── 通知覆盖率 ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
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
        <div className={cn("rounded-lg border p-4 text-center", financeMembers.length > 0 ? "bg-blue-50" : "bg-card")}>
          <div className={cn("text-2xl font-bold", financeMembers.length > 0 ? "text-blue-700" : "")}>
            {financeMembers.length}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">财务人员</div>
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">
                  {memberFilter === "finance"
                    ? `当前仅显示财务人员，共 ${financeMembers.length} 人，可直接维护财务行政待办访问名单。`
                    : `当前显示全部成员，共 ${members.length} 人。`}
                </div>
                <Tabs value={memberFilter} onValueChange={(value) => setMemberFilter(value as "all" | "finance")} className="w-auto">
                  <TabsList>
                    <TabsTrigger value="all">全部成员</TabsTrigger>
                    <TabsTrigger value="finance">财务人员</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>邮箱</TableHead>
                    <TableHead>角色</TableHead>
                    <TableHead>企业微信 userid</TableHead>
                    <TableHead>财务行政待办可见性</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleMembers.map((m) => <MemberRow key={m.id} member={m} currentUserId={currentUserId} />)}
                </TableBody>
              </Table>
              {memberFilter === "finance" && financeMembers.length === 0 ? (
                <p className="text-sm text-muted-foreground">当前还没有任何财务人员。</p>
              ) : null}
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
