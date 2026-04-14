"use client";

import { useState, useTransition } from "react";
import {
  resetFinanceTaskWeekSchedule,
  upsertFinanceTaskWeekSchedule,
} from "@/actions/finance-ops";
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
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { FinanceWeekViewRow } from "@/types";
import { CalendarRange, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function FinanceTaskWeekScheduleDialog({
  row,
  weekStart,
  weekEnd,
  trigger,
}: {
  row: FinanceWeekViewRow;
  weekStart: string;
  weekEnd: string;
  trigger?: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(row.start_date);
  const [endDate, setEndDate] = useState(row.end_date);
  const [notes, setNotes] = useState(row.notes ?? "");
  const [isHidden, setIsHidden] = useState(row.is_hidden);

  function resetState() {
    setStartDate(row.start_date);
    setEndDate(row.end_date);
    setNotes(row.notes ?? "");
    setIsHidden(row.is_hidden);
  }

  function onOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetState();
    }
    setOpen(nextOpen);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const taskInstanceId = row.task_instance_id;
    if (!taskInstanceId) return;
    startTransition(async () => {
      try {
        await upsertFinanceTaskWeekSchedule(taskInstanceId, {
          week_start: weekStart,
          start_date: startDate,
          end_date: endDate,
          arrangement_notes: notes,
          is_hidden: isHidden,
        });
        toast.success("本周过程安排已更新");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "保存失败，请稍后再试");
      }
    });
  }

  function onResetSchedule() {
    const taskInstanceId = row.task_instance_id;
    if (!taskInstanceId) return;
    startTransition(async () => {
      try {
        await resetFinanceTaskWeekSchedule(taskInstanceId);
        toast.success("已恢复为默认周展示");
        setOpen(false);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "恢复失败，请稍后再试");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        nativeButton={false}
        render={
          trigger ?? (
            <span className={cn(buttonVariants({ variant: "outline" }))}>
              <CalendarRange className="mr-1 h-4 w-4" />
              安排本周过程
            </span>
          )
        }
      />
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>安排本周过程</DialogTitle>
          <DialogDescription>
            待办管理只记录状态；这里负责补充本周的开始/结束、安排说明，以及是否跨周延续。
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <p className="font-medium">{row.title}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>当前周：{formatDateOnly(weekStart)} - {formatDateOnly(weekEnd)}</span>
              {row.due_date ? <span>截止：{formatDateOnly(row.due_date)}</span> : null}
              <span>负责人：{row.owner?.name ?? "未指定"}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`finance-task-week-start-${row.id}`}>开始日期</Label>
              <Input
                id={`finance-task-week-start-${row.id}`}
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`finance-task-week-end-${row.id}`}>结束日期</Label>
              <Input
                id={`finance-task-week-end-${row.id}`}
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`finance-task-week-notes-${row.id}`}>本周安排说明</Label>
            <Textarea
              id={`finance-task-week-notes-${row.id}`}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              placeholder="记录本周计划、协同依赖、延续原因，或今天到每天的大致安排"
              disabled={pending}
            />
          </div>

          <label className="flex items-center gap-2 rounded-lg border px-3 py-3 text-sm">
            <Checkbox checked={isHidden} onCheckedChange={(checked) => setIsHidden(Boolean(checked))} />
            <span>本周视图先隐藏这条待办</span>
          </label>

          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" onClick={onResetSchedule} disabled={pending} className="sm:mr-auto">
              <RotateCcw className="mr-1 h-4 w-4" />
              恢复默认展示
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "保存中…" : "保存过程安排"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
