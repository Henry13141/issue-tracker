"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createFinanceTaskAdHocInstance,
  createFinanceTaskTemplate,
  setFinanceTaskTemplateActive,
  updateFinanceTaskInstance,
  updateFinanceTaskTemplate,
} from "@/actions/finance-ops";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly, formatDateTime } from "@/lib/dates";
import {
  FINANCE_OPS_VIEW_LABELS,
  FINANCE_TASK_AREA_LABELS,
  FINANCE_TASK_CADENCE_LABELS,
  FINANCE_TASK_STATUS_LABELS,
  formatFinanceCadenceRule,
  getFinanceWeekInfo,
  parseDateOnly,
  type FinanceOpsView,
} from "@/lib/finance-ops";
import type { FinanceOpsBundle } from "@/lib/finance-ops-queries";
import { cn } from "@/lib/utils";
import type {
  FinanceTaskArea,
  FinanceTaskCadence,
  FinanceTaskInstanceStatus,
  FinanceTaskInstanceWithTemplate,
  FinanceTaskTemplateWithOwner,
  User,
} from "@/types";
import { Plus, Pencil, PlayCircle, CheckCircle2, Ban, RotateCcw, CalendarRange, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const NO_OWNER = "__none__";

const FINANCE_WEEKDAY_TRIGGER_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

const QUARTER_MONTH_TRIGGER_LABELS: Record<string, string> = {
  "1": "季度首月",
  "2": "季度次月",
  "3": "季度末月",
};

function memberNameById(members: User[], userId: string) {
  return members.find((m) => m.id === userId)?.name ?? "未知成员";
}

function FinanceTemplateDialog({
  members,
  template,
  trigger,
}: {
  members: User[];
  template?: FinanceTaskTemplateWithOwner;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [area, setArea] = useState<FinanceTaskArea>(template?.area ?? "finance");
  const [cadence, setCadence] = useState<FinanceTaskCadence>(template?.cadence ?? "monthly");
  const [dueWeekday, setDueWeekday] = useState(String(template?.due_weekday ?? 1));
  const [dueDay, setDueDay] = useState(String(template?.due_day ?? 15));
  const [dueMonthInQuarter, setDueMonthInQuarter] = useState(String(template?.due_month_in_quarter ?? 1));
  const [dueMonth, setDueMonth] = useState(String(template?.due_month ?? 1));
  const [ownerUserId, setOwnerUserId] = useState(template?.owner_user_id ?? NO_OWNER);

  function openDialog() {
    setTitle(template?.title ?? "");
    setDescription(template?.description ?? "");
    setArea(template?.area ?? "finance");
    setCadence(template?.cadence ?? "monthly");
    setDueWeekday(String(template?.due_weekday ?? 1));
    setDueDay(String(template?.due_day ?? 15));
    setDueMonthInQuarter(String(template?.due_month_in_quarter ?? 1));
    setDueMonth(String(template?.due_month ?? 1));
    setOwnerUserId(template?.owner_user_id ?? NO_OWNER);
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          title,
          description,
          area,
          cadence,
          due_weekday: cadence === "weekly" ? Number(dueWeekday) : null,
          due_day: Number(dueDay),
          due_month_in_quarter: cadence === "quarterly" ? Number(dueMonthInQuarter) : null,
          due_month: cadence === "yearly" ? Number(dueMonth) : null,
          owner_user_id: ownerUserId === NO_OWNER ? null : ownerUserId,
          is_active: template?.is_active ?? true,
        };

        if (template) {
          await updateFinanceTaskTemplate(template.id, payload);
          toast.success("周期事项模板已更新");
        } else {
          await createFinanceTaskTemplate(payload);
          toast.success("已新增周期事项模板");
        }
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败，请稍后再试");
      }
    });
  }

  return (
    <>
      {trigger ? (
        <div onClick={openDialog}>{trigger}</div>
      ) : (
        <Button type="button" onClick={openDialog}>
          <Plus className="mr-1 h-4 w-4" />
          新增周期事项
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{template ? "编辑周期事项模板" : "新增周期事项模板"}</DialogTitle>
            <DialogDescription>
              定义这类事项多久出现一次、由谁负责、以及本周期的到期规则。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="finance-template-title">事项名称</Label>
              <Input
                id="finance-template-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：每周报销复核 / 月度税票整理 / 季度对账"
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="finance-template-desc">说明</Label>
              <Textarea
                id="finance-template-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="补充执行说明、注意事项或交付要求"
                disabled={pending}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>归类</Label>
                <Select value={area} onValueChange={(value) => setArea((value ?? "finance") as FinanceTaskArea)}>
                  <SelectTrigger>
                    <SelectValue>{FINANCE_TASK_AREA_LABELS[area]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finance">财务</SelectItem>
                    <SelectItem value="cashier">出纳</SelectItem>
                    <SelectItem value="admin_hr">行政人事</SelectItem>
                    <SelectItem value="other">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>周期</Label>
                <Select value={cadence} onValueChange={(value) => setCadence((value ?? "monthly") as FinanceTaskCadence)}>
                  <SelectTrigger>
                    <SelectValue>{FINANCE_TASK_CADENCE_LABELS[cadence]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">每周</SelectItem>
                    <SelectItem value="monthly">每月</SelectItem>
                    <SelectItem value="quarterly">每季度</SelectItem>
                    <SelectItem value="yearly">每年</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="finance-template-owner">负责人</Label>
                <Select value={ownerUserId} onValueChange={(value) => setOwnerUserId(value ?? NO_OWNER)}>
                  <SelectTrigger id="finance-template-owner">
                    <SelectValue placeholder="暂不指定">
                      {ownerUserId === NO_OWNER ? null : memberNameById(members, ownerUserId)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_OWNER}>暂不指定</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {cadence === "weekly" ? (
                <div className="space-y-2 md:col-span-3">
                  <Label>星期</Label>
                  <Select value={dueWeekday} onValueChange={(value) => setDueWeekday(value ?? "1")}>
                    <SelectTrigger>
                      <SelectValue>
                        {FINANCE_WEEKDAY_TRIGGER_LABELS[Number(dueWeekday) - 1] ?? dueWeekday}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">周一</SelectItem>
                      <SelectItem value="2">周二</SelectItem>
                      <SelectItem value="3">周三</SelectItem>
                      <SelectItem value="4">周四</SelectItem>
                      <SelectItem value="5">周五</SelectItem>
                      <SelectItem value="6">周六</SelectItem>
                      <SelectItem value="7">周日</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="finance-template-day">日期</Label>
                  <Input
                    id="finance-template-day"
                    type="number"
                    min={1}
                    max={31}
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    disabled={pending}
                  />
                </div>
              )}

              {cadence === "quarterly" ? (
                <div className="space-y-2 md:col-span-2">
                  <Label>季度内月份</Label>
                  <Select value={dueMonthInQuarter} onValueChange={(value) => setDueMonthInQuarter(value ?? "1")}>
                    <SelectTrigger>
                      <SelectValue>{QUARTER_MONTH_TRIGGER_LABELS[dueMonthInQuarter] ?? dueMonthInQuarter}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">季度首月</SelectItem>
                      <SelectItem value="2">季度次月</SelectItem>
                      <SelectItem value="3">季度末月</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {cadence === "yearly" ? (
                <div className="space-y-2 md:col-span-2">
                  <Label>年度月份</Label>
                  <Select value={dueMonth} onValueChange={(value) => setDueMonth(value ?? "1")}>
                    <SelectTrigger>
                      <SelectValue>{`${dueMonth} 月`}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }).map((_, index) => (
                        <SelectItem key={index + 1} value={String(index + 1)}>
                          {index + 1} 月
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <DialogFooter className="px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中…" : template ? "保存修改" : "创建模板"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FinanceAdHocDialog({ members }: { members: User[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState<FinanceTaskArea>("admin_hr");
  const [dueDate, setDueDate] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(NO_OWNER);
  const [notes, setNotes] = useState("");

  function openDialog() {
    setTitle("");
    setDescription("");
    setArea("admin_hr");
    setDueDate("");
    setOwnerUserId(NO_OWNER);
    setNotes("");
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createFinanceTaskAdHocInstance({
          title,
          description,
          area,
          due_date: dueDate,
          owner_user_id: ownerUserId === NO_OWNER ? null : ownerUserId,
          notes,
        });
        toast.success("已新增临时待办");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "新增失败，请稍后再试");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={openDialog}>
        <Plus className="mr-1 h-4 w-4" />
        新增临时待办
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>新增临时待办</DialogTitle>
            <DialogDescription>
              用于随时补充行政人事、出纳或财务类的临时事项，不会生成后续周期。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="finance-ad-hoc-title">待办名称</Label>
              <Input
                id="finance-ad-hoc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例如：补充社保资料 / 安排入职手续 / 处理临时报销"
                disabled={pending}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>归类</Label>
                <Select value={area} onValueChange={(value) => setArea((value ?? "admin_hr") as FinanceTaskArea)}>
                  <SelectTrigger>
                    <SelectValue>{FINANCE_TASK_AREA_LABELS[area]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="finance">财务</SelectItem>
                    <SelectItem value="cashier">出纳</SelectItem>
                    <SelectItem value="admin_hr">行政人事</SelectItem>
                    <SelectItem value="other">其他</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="finance-ad-hoc-date">截止日期</Label>
                <Input
                  id="finance-ad-hoc-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={pending}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="finance-ad-hoc-owner">负责人</Label>
              <Select value={ownerUserId} onValueChange={(value) => setOwnerUserId(value ?? NO_OWNER)}>
                <SelectTrigger id="finance-ad-hoc-owner">
                  <SelectValue placeholder="暂不指定">
                    {ownerUserId === NO_OWNER ? null : memberNameById(members, ownerUserId)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_OWNER}>暂不指定</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="finance-ad-hoc-desc">说明</Label>
              <Textarea
                id="finance-ad-hoc-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="补充背景、交付要求或注意事项"
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="finance-ad-hoc-notes">初始备注</Label>
              <Textarea
                id="finance-ad-hoc-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="如果当前已有已知进展或补充信息，可以直接写在这里"
                disabled={pending}
              />
            </div>

            <DialogFooter className="px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "创建中…" : "创建待办"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FinanceInstanceDialog({ instance }: { instance: FinanceTaskInstanceWithTemplate }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<FinanceTaskInstanceStatus>(instance.status);
  const [notes, setNotes] = useState(instance.notes ?? "");

  function openDialog() {
    setStatus(instance.status);
    setNotes(instance.notes ?? "");
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await updateFinanceTaskInstance(instance.id, { status, notes });
        toast.success("执行情况已更新");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "更新失败，请稍后再试");
      }
    });
  }

  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={openDialog}>
        更新执行
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{instance.template?.title ?? "更新执行情况"}</DialogTitle>
            <DialogDescription>
              本期节点：{instance.period_label}，截止 {formatDateOnly(instance.due_date)}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={status} onValueChange={(value) => setStatus((value ?? "pending") as FinanceTaskInstanceStatus)}>
                <SelectTrigger>
                  <SelectValue>{FINANCE_TASK_STATUS_LABELS[status]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">待处理</SelectItem>
                  <SelectItem value="in_progress">进行中</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                  <SelectItem value="skipped">已跳过</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`finance-instance-notes-${instance.id}`}>执行备注</Label>
              <Textarea
                id={`finance-instance-notes-${instance.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="记录本期进展、特殊情况或交接备注"
                disabled={pending}
              />
            </div>

            <DialogFooter className="px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "提交中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FinanceTaskRow({ instance }: { instance: FinanceTaskInstanceWithTemplate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const weekStart = getFinanceWeekInfo(parseDateOnly(instance.due_date)).weekStart;

  function jumpToWeekPlan() {
    router.push(`/finance-ops?mode=weekly-plan&week=${weekStart}`);
  }

  function quickUpdate(status: FinanceTaskInstanceStatus) {
    startTransition(async () => {
      try {
        await updateFinanceTaskInstance(instance.id, {
          status,
          notes: instance.notes,
        });
        toast.success("状态已更新");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "更新失败，请稍后再试");
      }
    });
  }

  const displayStatus = instance.display_status ?? instance.status;
  const statusClassName =
    displayStatus === "overdue"
      ? "border-red-200 bg-red-50 text-red-700"
      : displayStatus === "completed"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : displayStatus === "in_progress"
          ? "border-blue-200 bg-blue-50 text-blue-700"
          : displayStatus === "skipped"
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-amber-200 bg-amber-50 text-amber-700";

  return (
    <Card
      className={cn(
        "border",
        displayStatus === "overdue" ? "border-red-200 bg-red-50/50" : "bg-card"
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{instance.title ?? instance.template?.title ?? "未命名事项"}</CardTitle>
              <Badge variant="outline">{FINANCE_TASK_AREA_LABELS[instance.area]}</Badge>
              <Badge variant="outline">
                {instance.source === "manual" ? "临时待办" : FINANCE_TASK_CADENCE_LABELS[instance.template?.cadence ?? "monthly"]}
              </Badge>
              <Badge className={statusClassName}>{FINANCE_TASK_STATUS_LABELS[displayStatus]}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{instance.period_label}</span>
              <span>截止：{formatDateOnly(instance.due_date)}</span>
              <span>负责人：{instance.owner?.name ?? "未指定"}</span>
              {instance.completed_at ? <span>完成于：{formatDateTime(instance.completed_at)}</span> : null}
            </div>
            {(instance.description ?? instance.template?.description) ? (
              <p className="text-sm text-muted-foreground">{instance.description ?? instance.template?.description}</p>
            ) : null}
            {instance.notes ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">执行备注</p>
                <p className="mt-1 whitespace-pre-wrap">{instance.notes}</p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {instance.status !== "in_progress" && instance.status !== "completed" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => quickUpdate("in_progress")}
              >
                <PlayCircle className="mr-1 h-4 w-4" />
                开始处理
              </Button>
            ) : null}
            {instance.status !== "completed" ? (
              <Button type="button" size="sm" disabled={pending} onClick={() => quickUpdate("completed")}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                标记完成
              </Button>
            ) : null}
            {instance.status !== "skipped" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => quickUpdate("skipped")}
              >
                <Ban className="mr-1 h-4 w-4" />
                跳过本期
              </Button>
            ) : null}
            {(instance.status === "completed" || instance.status === "skipped") ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => quickUpdate("pending")}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                恢复待处理
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" onClick={jumpToWeekPlan}>
              <CalendarRange className="mr-1 h-4 w-4" />
              安排本周过程
            </Button>
            <FinanceInstanceDialog instance={instance} />
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

function FinanceTemplateRow({
  template,
  members,
}: {
  template: FinanceTaskTemplateWithOwner;
  members: User[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function toggleActive() {
    startTransition(async () => {
      try {
        await setFinanceTaskTemplateActive(template.id, !template.is_active);
        toast.success(template.is_active ? "模板已停用" : "模板已启用");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作失败，请稍后再试");
      }
    });
  }

  return (
    <Card className={cn(!template.is_active ? "border-dashed opacity-80" : "")}>
      <CardContent className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{template.title}</p>
            <Badge variant="outline">{FINANCE_TASK_AREA_LABELS[template.area]}</Badge>
            <Badge variant="outline">{FINANCE_TASK_CADENCE_LABELS[template.cadence]}</Badge>
            <Badge variant={template.is_active ? "secondary" : "outline"}>
              {template.is_active ? "启用中" : "已停用"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{formatFinanceCadenceRule(template)}</span>
            <span>负责人：{template.owner?.name ?? "未指定"}</span>
          </div>
          {template.description ? <p className="text-sm text-muted-foreground">{template.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <FinanceTemplateDialog
            members={members}
            template={template}
            trigger={
              <Button type="button" size="sm" variant="outline">
                <Pencil className="mr-1 h-4 w-4" />
                编辑
              </Button>
            }
          />
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={toggleActive}>
            {template.is_active ? "停用" : "启用"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function FinanceOpsClient({
  bundle,
  members,
  currentView,
}: {
  bundle: FinanceOpsBundle;
  members: User[];
  currentView: FinanceOpsView;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { templates, openInstances, completedInstances, summary } = bundle;
  const unreadyTemplates = useMemo(() => templates.filter((template) => !template.is_active), [templates]);
  const [templateSectionOpen, setTemplateSectionOpen] = useState(false);
  const [completedSectionOpen, setCompletedSectionOpen] = useState(false);

  function switchView(nextView: FinanceOpsView) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextView === "month") params.delete("view");
    else params.set("view", nextView);
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">当前节奏</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <FinanceAdHocDialog members={members} />
            <FinanceTemplateDialog members={members} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard title="本月待完成" value={summary.dueThisMonth} description="当月到期且尚未完成/跳过" />
          <StatCard title="本季度待完成" value={summary.dueThisQuarter} description="本季度内需要处理的关键节点" />
          <StatCard
            title="已逾期"
            value={summary.overdue}
            description="超过截止日仍未完成"
            className={summary.overdue > 0 ? "border-red-200 bg-red-50/60" : undefined}
          />
          <StatCard title="本年已完成" value={summary.completedThisYear} description="已完成的年度内节点数" />
          <StatCard title="启用模板" value={summary.activeTemplates} description="当前正在生效的周期模板" />
        </div>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">执行中的事项</h2>
            <p className="text-sm text-muted-foreground">按当前视图筛选本期节点，既能看周期事项，也能看随时补充的行政人事/财务临时待办。</p>
          </div>
          <Tabs value={currentView} onValueChange={(value) => switchView(value as FinanceOpsView)} className="w-auto">
            <TabsList>
              {Object.entries(FINANCE_OPS_VIEW_LABELS).map(([value, label]) => (
                <TabsTrigger key={value} value={value}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {openInstances.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              当前视图下没有待处理事项，可以切换筛选，新增临时待办，或先去模板区补充新的周期节点。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {openInstances.map((instance) => (
              <FinanceTaskRow key={instance.id} instance={instance} />
            ))}
          </div>
        )}
      </section>

      <section>
        <button
          type="button"
          className="mb-4 flex w-full items-center gap-2 text-left"
          onClick={() => setCompletedSectionOpen((v) => !v)}
        >
          {completedSectionOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">
              已完成 / 已跳过
              {completedInstances.length > 0 && (
                <span className="ml-2 text-sm font-normal">（{completedInstances.length} 条）</span>
              )}
            </h2>
            {!completedSectionOpen && (
              <p className="text-sm text-muted-foreground">点击展开查看本期已处理记录</p>
            )}
          </div>
        </button>
        {completedSectionOpen && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">保留本期执行记录，便于回看某个节点是否已经处理过。</p>
            {completedInstances.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">当前视图下还没有已完成或已跳过的事项。</CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {completedInstances.map((instance) => (
                  <FinanceTaskRow key={instance.id} instance={instance} />
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section>
        <button
          type="button"
          className="mb-4 flex w-full items-center gap-2 text-left"
          onClick={() => setTemplateSectionOpen((v) => !v)}
        >
          {templateSectionOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">
              模板管理
              {templates.length > 0 && (
                <span className="ml-2 text-sm font-normal">（{templates.length} 条）</span>
              )}
            </h2>
            {!templateSectionOpen && (
              <p className="text-sm text-muted-foreground">点击展开查看周期模板配置</p>
            )}
          </div>
        </button>
        {templateSectionOpen && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              每条模板代表一类固定节奏事项，系统会按周期自动生成当前实例。
            </p>
            {templates.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-sm text-muted-foreground">
                  还没有任何周期模板。先新增一条每月、每季度或每年的固定事项，系统就会开始生成当前周期任务。
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => (
                  <FinanceTemplateRow key={template.id} template={template} members={members} />
                ))}
              </div>
            )}
            {unreadyTemplates.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                当前有 {unreadyTemplates.length} 条模板处于停用状态，停用后不会生成新的周期实例，但历史记录仍会保留。
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
