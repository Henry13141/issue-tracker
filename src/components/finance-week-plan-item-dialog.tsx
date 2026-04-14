"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createFinanceWeekPlanItem,
  deleteFinanceWeekPlanItem,
  updateFinanceWeekPlanItem,
} from "@/actions/finance-ops";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import {
  FINANCE_TASK_AREA_LABELS,
  FINANCE_WEEK_PLAN_STATUS_LABELS,
  getDateDiffInDays,
  shiftDateOnly,
} from "@/lib/finance-ops";
import { formatDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { FinanceTaskArea, FinanceWeekPlanItemWithOwner, User } from "@/types";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const NO_OWNER = "__none__";

function memberNameById(members: User[], userId: string) {
  return members.find((member) => member.id === userId)?.name ?? "未知成员";
}

export function FinanceWeekPlanItemDialog({
  members,
  weekStart,
  weekEnd,
  item,
  trigger,
}: {
  members: User[];
  weekStart: string;
  weekEnd: string;
  item?: FinanceWeekPlanItemWithOwner;
  trigger?: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [area, setArea] = useState<FinanceTaskArea>(item?.area ?? "finance");
  const [startDate, setStartDate] = useState(item?.start_date ?? weekStart);
  const [durationDays, setDurationDays] = useState(item ? getDateDiffInDays(item.start_date, item.end_date) + 1 : 1);
  const [ownerUserId, setOwnerUserId] = useState(item?.owner_user_id ?? NO_OWNER);
  const [status, setStatus] = useState(item?.status ?? "pending");
  const [isAdHoc, setIsAdHoc] = useState(item?.source === "ad_hoc");
  const [notes, setNotes] = useState(item?.notes ?? "");

  const maxDuration = useMemo(() => getDateDiffInDays(startDate, weekEnd) + 1, [startDate, weekEnd]);
  const safeDuration = Math.min(Math.max(durationDays, 1), Math.max(maxDuration, 1));
  const endDatePreview = shiftDateOnly(startDate, safeDuration - 1);

  function resetState() {
    setTitle(item?.title ?? "");
    setDescription(item?.description ?? "");
    setArea(item?.area ?? "finance");
    setStartDate(item?.start_date ?? weekStart);
    setDurationDays(item ? getDateDiffInDays(item.start_date, item.end_date) + 1 : 1);
    setOwnerUserId(item?.owner_user_id ?? NO_OWNER);
    setStatus(item?.status ?? "pending");
    setIsAdHoc(item?.source === "ad_hoc");
    setNotes(item?.notes ?? "");
  }

  function onOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetState();
    }
    setOpen(nextOpen);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          title,
          description,
          area,
          source: isAdHoc ? "ad_hoc" : "weekly_plan",
          start_date: startDate,
          duration_days: safeDuration,
          owner_user_id: ownerUserId === NO_OWNER ? null : ownerUserId,
          status,
          notes,
        } as const;

        if (item) {
          await updateFinanceWeekPlanItem(item.id, payload);
          toast.success("周事项已更新");
        } else {
          await createFinanceWeekPlanItem(payload);
          toast.success("已新增周事项");
        }
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败，请稍后再试");
      }
    });
  }

  function onDelete() {
    if (!item) return;
    startTransition(async () => {
      try {
        await deleteFinanceWeekPlanItem(item.id);
        toast.success("周事项已删除");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "删除失败，请稍后再试");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        nativeButton={false}
        render={
          trigger ?? (
            <span className={cn(buttonVariants())}>
              <Plus className="mr-1 h-4 w-4" />
              新增周事项
            </span>
          )
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? "编辑周事项" : "新增周事项"}</DialogTitle>
          <DialogDescription>
            为本周安排一条具体工作，可按开始日与持续天数展示为跨天条带。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="finance-week-plan-title">事项名称</Label>
            <Input
              id="finance-week-plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：核对本周报销单据 / 跟进入职资料 / 临时付款处理"
              disabled={pending}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-week-plan-description">说明</Label>
            <Textarea
              id="finance-week-plan-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="补充本周安排背景、协同人或交付说明"
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
              <Label>负责人</Label>
              <Select value={ownerUserId} onValueChange={(value) => setOwnerUserId(value ?? NO_OWNER)}>
                <SelectTrigger>
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
            <div className="space-y-2">
              <Label htmlFor="finance-week-plan-start">开始日期</Label>
              <Input
                id="finance-week-plan-start"
                type="date"
                min={weekStart}
                max={weekEnd}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="finance-week-plan-duration">持续天数</Label>
              <Input
                id="finance-week-plan-duration"
                type="number"
                min={1}
                max={Math.max(maxDuration, 1)}
                value={safeDuration}
                onChange={(e) => setDurationDays(Number(e.target.value) || 1)}
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label>结束日期</Label>
              <div className="flex min-h-10 items-center rounded-md border px-3 text-sm text-muted-foreground">
                {formatDateOnly(endDatePreview)}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={status} onValueChange={(value) => setStatus((value ?? "pending") as typeof status)}>
                <SelectTrigger>
                  <SelectValue>{FINANCE_WEEK_PLAN_STATUS_LABELS[status]}</SelectValue>
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
              <Label>事项属性</Label>
              <label className="flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm">
                <Checkbox checked={isAdHoc} onCheckedChange={(checked) => setIsAdHoc(Boolean(checked))} />
                <span>标记为临时事项</span>
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="finance-week-plan-notes">备注</Label>
            <Textarea
              id="finance-week-plan-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="记录关键依赖、跟进结果或需要提醒的事项"
              disabled={pending}
            />
          </div>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-between">
            {item ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline" className="sm:mr-auto" disabled={pending}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    删除事项
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认删除这条周事项？</AlertDialogTitle>
                    <AlertDialogDescription>
                      删除后将无法恢复，当前周视图与明细列表都会同步移除。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>取消</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>确认删除</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <div />
            )}

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中…" : item ? "保存修改" : "创建事项"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
