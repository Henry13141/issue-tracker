"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FINANCE_TASK_AREA_LABELS } from "@/lib/finance-ops";
import type { FinanceTaskArea } from "@/types";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type FinanceWeekPlanFilters = {
  area: FinanceTaskArea | "all";
  showAdHocOnly: boolean;
  showOpenOnly: boolean;
};

export function FinanceWeekPlanToolbar({
  weekTitle,
  filters,
  onChangeFilters,
  onPrevWeek,
  onToday,
  onNextWeek,
  action,
}: {
  weekTitle: string;
  filters: FinanceWeekPlanFilters;
  onChangeFilters: (next: FinanceWeekPlanFilters) => void;
  onPrevWeek: () => void;
  onToday: () => void;
  onNextWeek: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">本周范围</p>
          <h2 className="text-xl font-semibold tracking-tight">{weekTitle}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={onPrevWeek}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            上一周
          </Button>
          <Button type="button" variant="outline" onClick={onToday}>
            本周
          </Button>
          <Button type="button" variant="outline" onClick={onNextWeek}>
            下一周
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
          {action}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(180px,220px)_auto_auto] lg:items-center">
        <div className="space-y-2">
          <Label>归类</Label>
          <Select
            value={filters.area}
            onValueChange={(value) =>
              onChangeFilters({
                ...filters,
                area: (!value ? "all" : value) as FinanceTaskArea | "all",
              })
            }
          >
            <SelectTrigger>
              <SelectValue>{filters.area === "all" ? "全部归类" : FINANCE_TASK_AREA_LABELS[filters.area]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部归类</SelectItem>
              <SelectItem value="finance">财务</SelectItem>
              <SelectItem value="cashier">出纳</SelectItem>
              <SelectItem value="admin_hr">行政人事</SelectItem>
              <SelectItem value="other">其他</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <Checkbox
            checked={filters.showAdHocOnly}
            onCheckedChange={(checked) =>
              onChangeFilters({
                ...filters,
                showAdHocOnly: Boolean(checked),
              })
            }
          />
          <span>仅看临时事项</span>
        </label>

        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <Checkbox
            checked={filters.showOpenOnly}
            onCheckedChange={(checked) =>
              onChangeFilters({
                ...filters,
                showOpenOnly: Boolean(checked),
              })
            }
          />
          <span>仅看未完成</span>
        </label>
      </div>
    </div>
  );
}
