"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPettyCashEntry, updatePettyCashEntry } from "@/actions/petty-cash";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateOnly } from "@/lib/dates";
import {
  expectsInvoiceCollection,
  formatPettyCashAmount,
  PETTY_CASH_EXPENSE_PROJECT_LABELS,
  PETTY_CASH_INVOICE_AVAILABILITY_LABELS,
  PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS,
  PETTY_CASH_INVOICE_COLLECTED_LABELS,
  PETTY_CASH_INVOICE_COLLECTED_OPTIONS,
  PETTY_CASH_INVOICE_REPLACEMENT_LABELS,
  PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS,
  PETTY_CASH_PAYMENT_METHOD_LABELS,
  PETTY_CASH_PAYMENT_OPTIONS,
  PETTY_CASH_PROJECT_OPTIONS,
  PETTY_CASH_REIMBURSEMENT_STATUS_LABELS,
  PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS,
  toDisplayAmount,
} from "@/lib/petty-cash";
import type { PettyCashBundle } from "@/lib/petty-cash-queries";
import type {
  PettyCashEntryWithRelations,
  PettyCashExpenseProject,
  PettyCashInvoiceAvailability,
  PettyCashInvoiceCollectedStatus,
  PettyCashInvoiceReplacementStatus,
  PettyCashPaymentMethod,
  PettyCashReimbursementStatus,
  User,
} from "@/types";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";

const ALL = "__all__";

function memberNameById(members: User[], userId: string) {
  return members.find((m) => m.id === userId)?.name ?? "未知成员";
}

function statusBadgeClass(status: PettyCashReimbursementStatus) {
  if (status === "reimbursed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "in_progress") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "voided") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function PettyCashEntryDialog({
  members,
  entry,
  trigger,
}: {
  members: User[];
  entry?: PettyCashEntryWithRelations;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [occurredOn, setOccurredOn] = useState(entry?.occurred_on ?? "");
  const [payerUserId, setPayerUserId] = useState(entry?.payer_user_id ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [expenseProject, setExpenseProject] = useState<PettyCashExpenseProject>(
    entry?.expense_project ?? "office_supplies_invoice"
  );
  const [amount, setAmount] = useState(entry ? toDisplayAmount(entry.amount_minor) : "");
  const [paymentMethod, setPaymentMethod] = useState<PettyCashPaymentMethod>(entry?.payment_method ?? "wechat");
  const [invoiceAvailability, setInvoiceAvailability] = useState<PettyCashInvoiceAvailability>(
    entry?.invoice_availability ?? "with_invoice"
  );
  const [invoiceReplacementStatus, setInvoiceReplacementStatus] =
    useState<PettyCashInvoiceReplacementStatus>(entry?.invoice_replacement_status ?? "not_needed");
  const [invoiceCollectedStatus, setInvoiceCollectedStatus] =
    useState<PettyCashInvoiceCollectedStatus>(entry?.invoice_collected_status ?? "not_received");
  const [reimbursementStatus, setReimbursementStatus] = useState<PettyCashReimbursementStatus>(
    entry?.reimbursement_status ?? "pending"
  );
  const [reimbursedOn, setReimbursedOn] = useState(entry?.reimbursed_on ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");

  function openDialog() {
    setOccurredOn(entry?.occurred_on ?? "");
    setPayerUserId(entry?.payer_user_id ?? "");
    setTitle(entry?.title ?? "");
    setExpenseProject(entry?.expense_project ?? "office_supplies_invoice");
    setAmount(entry ? toDisplayAmount(entry.amount_minor) : "");
    setPaymentMethod(entry?.payment_method ?? "wechat");
    setInvoiceAvailability(entry?.invoice_availability ?? "with_invoice");
    setInvoiceReplacementStatus(entry?.invoice_replacement_status ?? "not_needed");
    setInvoiceCollectedStatus(entry?.invoice_collected_status ?? "not_received");
    setReimbursementStatus(entry?.reimbursement_status ?? "pending");
    setReimbursedOn(entry?.reimbursed_on ?? "");
    setNotes(entry?.notes ?? "");
    setOpen(true);
  }

  function onInvoiceAvailabilityChange(value: string | null) {
    const nextValue = (value ?? "with_invoice") as PettyCashInvoiceAvailability;
    setInvoiceAvailability(nextValue);
    if (nextValue === "with_invoice") {
      setInvoiceReplacementStatus("not_needed");
    } else if (invoiceReplacementStatus === "not_needed") {
      setInvoiceReplacementStatus("pending");
    }
  }

  function onReimbursementStatusChange(value: string | null) {
    const nextValue = (value ?? "pending") as PettyCashReimbursementStatus;
    setReimbursementStatus(nextValue);
    if (nextValue !== "reimbursed") {
      setReimbursedOn("");
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const payload = {
          occurred_on: occurredOn,
          payer_user_id: payerUserId,
          title,
          expense_project: expenseProject,
          amount,
          payment_method: paymentMethod,
          invoice_availability: invoiceAvailability,
          invoice_replacement_status: invoiceReplacementStatus,
          invoice_collected_status: invoiceCollectedStatus,
          reimbursement_status: reimbursementStatus,
          reimbursed_on: reimbursedOn || null,
          notes,
        };

        if (entry) {
          await updatePettyCashEntry(entry.id, payload);
          toast.success("备用金登记已更新");
        } else {
          await createPettyCashEntry(payload);
          toast.success("已新增备用金登记");
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
          新增登记
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{entry ? "编辑备用金登记" : "新增备用金登记"}</DialogTitle>
            <DialogDescription>
              记录垫付金额、支出项目、发票状态与报销进度，便于后续统一跟踪。
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="petty-cash-occurred-on">发生日期</Label>
                <Input
                  id="petty-cash-occurred-on"
                  type="date"
                  value={occurredOn}
                  onChange={(e) => setOccurredOn(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label>垫付人</Label>
                <Select value={payerUserId} onValueChange={(value) => setPayerUserId(value ?? "")}>
                  <SelectTrigger>
                    <SelectValue placeholder="请选择垫付人">
                      {payerUserId ? memberNameById(members, payerUserId) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="petty-cash-title">事项名称</Label>
                <Input
                  id="petty-cash-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="例如：采购打印纸 / 垫付快递费 / 水果茶歇"
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label>支出项目</Label>
                <Select
                  value={expenseProject}
                  onValueChange={(value) => setExpenseProject((value ?? "office_supplies_invoice") as PettyCashExpenseProject)}
                >
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_EXPENSE_PROJECT_LABELS[expenseProject]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_PROJECT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PETTY_CASH_EXPENSE_PROJECT_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="petty-cash-amount">垫付金额</Label>
                <Input
                  id="petty-cash-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="例如 128.50"
                  disabled={pending}
                />
              </div>
              <div className="space-y-2">
                <Label>支付方式</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={(value) => setPaymentMethod((value ?? "wechat") as PettyCashPaymentMethod)}
                >
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_PAYMENT_METHOD_LABELS[paymentMethod]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_PAYMENT_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PETTY_CASH_PAYMENT_METHOD_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>有票无票</Label>
                <Select value={invoiceAvailability} onValueChange={onInvoiceAvailabilityChange}>
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_INVOICE_AVAILABILITY_LABELS[invoiceAvailability]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PETTY_CASH_INVOICE_AVAILABILITY_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>替票状态</Label>
                <Select
                  value={invoiceReplacementStatus}
                  onValueChange={(value) =>
                    setInvoiceReplacementStatus((value ?? "not_needed") as PettyCashInvoiceReplacementStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_INVOICE_REPLACEMENT_LABELS[invoiceReplacementStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS.map((option) => (
                      <SelectItem
                        key={option}
                        value={option}
                        disabled={invoiceAvailability === "with_invoice" && option !== "not_needed"}
                      >
                        {PETTY_CASH_INVOICE_REPLACEMENT_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>发票是否收回</Label>
                <Select
                  value={invoiceCollectedStatus}
                  onValueChange={(value) =>
                    setInvoiceCollectedStatus((value ?? "not_received") as PettyCashInvoiceCollectedStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_INVOICE_COLLECTED_LABELS[invoiceCollectedStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_INVOICE_COLLECTED_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PETTY_CASH_INVOICE_COLLECTED_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>报销状态</Label>
                <Select value={reimbursementStatus} onValueChange={onReimbursementStatusChange}>
                  <SelectTrigger>
                    <SelectValue>{PETTY_CASH_REIMBURSEMENT_STATUS_LABELS[reimbursementStatus]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {PETTY_CASH_REIMBURSEMENT_STATUS_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="petty-cash-reimbursed-on">报销日期</Label>
                <Input
                  id="petty-cash-reimbursed-on"
                  type="date"
                  value={reimbursedOn}
                  onChange={(e) => setReimbursedOn(e.target.value)}
                  disabled={pending || reimbursementStatus !== "reimbursed"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="petty-cash-notes">备注</Label>
              <Textarea
                id="petty-cash-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="例如：发票待补、走替票、跨月报销、票据还未收回"
                disabled={pending}
              />
            </div>

            <DialogFooter className="px-0 pb-0">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                取消
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "保存中…" : entry ? "保存修改" : "创建登记"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PettyCashClient({
  bundle,
  members,
}: {
  bundle: PettyCashBundle;
  members: User[];
}) {
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [payerFilter, setPayerFilter] = useState<string>(ALL);
  const [projectFilter, setProjectFilter] = useState<string>(ALL);
  const [invoiceFilter, setInvoiceFilter] = useState<string>(ALL);
  const [replacementFilter, setReplacementFilter] = useState<string>(ALL);
  const [collectedFilter, setCollectedFilter] = useState<string>(ALL);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [keyword, setKeyword] = useState("");

  const filteredEntries = useMemo(() => {
    const loweredKeyword = keyword.trim().toLowerCase();
    return bundle.entries.filter((entry) => {
      if (statusFilter !== ALL && entry.reimbursement_status !== statusFilter) return false;
      if (payerFilter !== ALL && entry.payer_user_id !== payerFilter) return false;
      if (projectFilter !== ALL && entry.expense_project !== projectFilter) return false;
      if (invoiceFilter !== ALL && entry.invoice_availability !== invoiceFilter) return false;
      if (replacementFilter !== ALL && entry.invoice_replacement_status !== replacementFilter) return false;
      if (collectedFilter !== ALL && entry.invoice_collected_status !== collectedFilter) return false;
      if (dateFrom && entry.occurred_on < dateFrom) return false;
      if (dateTo && entry.occurred_on > dateTo) return false;
      if (!loweredKeyword) return true;

      return [entry.title, entry.notes ?? "", entry.payer?.name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(loweredKeyword);
    });
  }, [
    bundle.entries,
    statusFilter,
    payerFilter,
    projectFilter,
    invoiceFilter,
    replacementFilter,
    collectedFilter,
    dateFrom,
    dateTo,
    keyword,
  ]);

  function resetFilters() {
    setStatusFilter(ALL);
    setPayerFilter(ALL);
    setProjectFilter(ALL);
    setInvoiceFilter(ALL);
    setReplacementFilter(ALL);
    setCollectedFilter(ALL);
    setDateFrom("");
    setDateTo("");
    setKeyword("");
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">台账概览</h2>
            <p className="text-sm text-muted-foreground">
              聚焦个人垫付、发票状态和报销进度，先把金额和票据台账记清楚。
            </p>
          </div>
          <PettyCashEntryDialog members={members} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard title="当前未报销笔数" value={bundle.summary.unreimbursedCount} description="待报销与报销中的合计" />
          <StatCard
            title="当前未报销金额"
            value={formatPettyCashAmount(bundle.summary.unreimbursedAmountMinor)}
            description="尚未完成报销的累计金额"
          />
          <StatCard
            title="本月已报销金额"
            value={formatPettyCashAmount(bundle.summary.reimbursedThisMonthAmountMinor)}
            description="按报销日期统计"
          />
          <StatCard
            title="本月新增垫付金额"
            value={formatPettyCashAmount(bundle.summary.addedThisMonthAmountMinor)}
            description="按发生日期统计"
          />
          <StatCard title="待替票笔数" value={bundle.summary.pendingReplacementCount} description="仍为待替票状态的记录" />
          <StatCard title="发票未收回笔数" value={bundle.summary.invoiceNotReceivedCount} description="已应收票但财务尚未拿到" />
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-base font-semibold tracking-wide text-muted-foreground">筛选区</h2>
          <p className="text-sm text-muted-foreground">支持按状态、垫付人、支出项目和票据进度快速筛查。</p>
        </div>
        <Card>
          <CardContent className="grid gap-3 py-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label>报销状态</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {statusFilter === ALL
                      ? "全部状态"
                      : PETTY_CASH_REIMBURSEMENT_STATUS_LABELS[statusFilter as PettyCashReimbursementStatus]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部状态</SelectItem>
                  {PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PETTY_CASH_REIMBURSEMENT_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>垫付人</Label>
              <Select value={payerFilter} onValueChange={(value) => setPayerFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {payerFilter === ALL ? "全部人员" : memberNameById(members, payerFilter)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部人员</SelectItem>
                  {members.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>发生日期起</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>发生日期止</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>支出项目</Label>
              <Select value={projectFilter} onValueChange={(value) => setProjectFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {projectFilter === ALL
                      ? "全部项目"
                      : PETTY_CASH_EXPENSE_PROJECT_LABELS[projectFilter as PettyCashExpenseProject]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部项目</SelectItem>
                  {PETTY_CASH_PROJECT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PETTY_CASH_EXPENSE_PROJECT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>有票无票</Label>
              <Select value={invoiceFilter} onValueChange={(value) => setInvoiceFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {invoiceFilter === ALL
                      ? "全部"
                      : PETTY_CASH_INVOICE_AVAILABILITY_LABELS[invoiceFilter as PettyCashInvoiceAvailability]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部</SelectItem>
                  {PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PETTY_CASH_INVOICE_AVAILABILITY_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>替票状态</Label>
              <Select value={replacementFilter} onValueChange={(value) => setReplacementFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {replacementFilter === ALL
                      ? "全部"
                      : PETTY_CASH_INVOICE_REPLACEMENT_LABELS[replacementFilter as PettyCashInvoiceReplacementStatus]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部</SelectItem>
                  {PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PETTY_CASH_INVOICE_REPLACEMENT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>收票状态</Label>
              <Select value={collectedFilter} onValueChange={(value) => setCollectedFilter(value ?? ALL)}>
                <SelectTrigger>
                  <SelectValue>
                    {collectedFilter === ALL
                      ? "全部"
                      : PETTY_CASH_INVOICE_COLLECTED_LABELS[collectedFilter as PettyCashInvoiceCollectedStatus]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>全部</SelectItem>
                  {PETTY_CASH_INVOICE_COLLECTED_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {PETTY_CASH_INVOICE_COLLECTED_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 xl:col-span-3">
              <Label htmlFor="petty-cash-keyword">关键字搜索</Label>
              <Input
                id="petty-cash-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索事项名称、垫付人或备注"
              />
            </div>

            <div className="flex items-end">
              <Button type="button" variant="outline" className="w-full" onClick={resetFilters}>
                重置筛选
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-wide text-muted-foreground">登记明细</h2>
            <p className="text-sm text-muted-foreground">
              共 {bundle.entries.length} 条记录，当前筛选后 {filteredEntries.length} 条。
            </p>
          </div>
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">备用金登记表</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredEntries.length === 0 ? (
              <div className="py-8 text-sm text-muted-foreground">当前筛选下没有匹配记录，可以先新增一笔备用金登记。</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>发生日期</TableHead>
                    <TableHead>垫付人</TableHead>
                    <TableHead>事项名称</TableHead>
                    <TableHead>支出项目</TableHead>
                    <TableHead>垫付金额</TableHead>
                    <TableHead>支付方式</TableHead>
                    <TableHead>有票无票</TableHead>
                    <TableHead>是否替票</TableHead>
                    <TableHead>发票是否收回</TableHead>
                    <TableHead>报销状态</TableHead>
                    <TableHead>报销日期</TableHead>
                    <TableHead className="min-w-56 whitespace-normal">备注</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDateOnly(entry.occurred_on)}</TableCell>
                      <TableCell>{entry.payer?.name ?? "未知成员"}</TableCell>
                      <TableCell className="max-w-64 whitespace-normal">{entry.title}</TableCell>
                      <TableCell>{PETTY_CASH_EXPENSE_PROJECT_LABELS[entry.expense_project]}</TableCell>
                      <TableCell>{formatPettyCashAmount(entry.amount_minor)}</TableCell>
                      <TableCell>{PETTY_CASH_PAYMENT_METHOD_LABELS[entry.payment_method]}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PETTY_CASH_INVOICE_AVAILABILITY_LABELS[entry.invoice_availability]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {PETTY_CASH_INVOICE_REPLACEMENT_LABELS[entry.invoice_replacement_status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {expectsInvoiceCollection(entry)
                            ? PETTY_CASH_INVOICE_COLLECTED_LABELS[entry.invoice_collected_status]
                            : "无需收票"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={statusBadgeClass(entry.reimbursement_status)}>
                          {PETTY_CASH_REIMBURSEMENT_STATUS_LABELS[entry.reimbursement_status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.reimbursed_on ? formatDateOnly(entry.reimbursed_on) : "—"}</TableCell>
                      <TableCell className="max-w-80 whitespace-normal text-sm text-muted-foreground">
                        {entry.notes || "—"}
                      </TableCell>
                      <TableCell>
                        <PettyCashEntryDialog
                          members={members}
                          entry={entry}
                          trigger={
                            <Button type="button" size="sm" variant="outline">
                              <Pencil className="mr-1 h-4 w-4" />
                              编辑
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
