import type {
  PettyCashEntry,
  PettyCashEntryWithRelations,
  PettyCashExpenseProject,
  PettyCashInvoiceAvailability,
  PettyCashInvoiceCollectedStatus,
  PettyCashInvoiceReplacementStatus,
  PettyCashPaymentMethod,
  PettyCashReimbursementStatus,
} from "@/types";

export const PETTY_CASH_EXPENSE_PROJECT_LABELS: Record<PettyCashExpenseProject, string> = {
  admin_procurement_invoice: "行政采购（有票）",
  office_supplies_invoice: "办公用品（有票）",
  employee_benefits_invoice: "员工福利（有票）",
  hospitality_replacement: "招待 / 水果 / 茶歇（替票）",
  logistics_invoice: "快递 / 物流（有票）",
  travel_mixed: "差旅交通（混合）",
  maintenance_mixed: "维修 / 杂项（混合）",
  other: "其他",
};

export const PETTY_CASH_PAYMENT_METHOD_LABELS: Record<PettyCashPaymentMethod, string> = {
  wechat: "微信",
  alipay: "支付宝",
  bank_transfer: "银行卡",
  cash: "现金",
  other: "其他",
};

export const PETTY_CASH_INVOICE_AVAILABILITY_LABELS: Record<PettyCashInvoiceAvailability, string> = {
  with_invoice: "有票",
  without_invoice: "无票",
};

export const PETTY_CASH_INVOICE_REPLACEMENT_LABELS: Record<PettyCashInvoiceReplacementStatus, string> = {
  not_needed: "无需替票",
  pending: "待替票",
};

/** 兼容历史数据中的替票状态（库升级前可能存在 in_progress / completed） */
export function normalizePettyCashReplacementStatus(raw: string): PettyCashInvoiceReplacementStatus {
  if (raw === "pending" || raw === "not_needed") return raw;
  if (raw === "in_progress") return "pending";
  if (raw === "completed") return "not_needed";
  return "not_needed";
}

export const PETTY_CASH_INVOICE_COLLECTED_LABELS: Record<PettyCashInvoiceCollectedStatus, string> = {
  not_received: "未收回",
  received: "已收回",
};

export const PETTY_CASH_REIMBURSEMENT_STATUS_LABELS: Record<PettyCashReimbursementStatus, string> = {
  pending: "待报销",
  in_progress: "报销中",
  reimbursed: "已报销",
  voided: "已作废",
};

export const PETTY_CASH_PROJECT_OPTIONS = Object.keys(
  PETTY_CASH_EXPENSE_PROJECT_LABELS
) as PettyCashExpenseProject[];

export const PETTY_CASH_PAYMENT_OPTIONS = Object.keys(
  PETTY_CASH_PAYMENT_METHOD_LABELS
) as PettyCashPaymentMethod[];

export const PETTY_CASH_INVOICE_AVAILABILITY_OPTIONS = Object.keys(
  PETTY_CASH_INVOICE_AVAILABILITY_LABELS
) as PettyCashInvoiceAvailability[];

export const PETTY_CASH_INVOICE_REPLACEMENT_OPTIONS = Object.keys(
  PETTY_CASH_INVOICE_REPLACEMENT_LABELS
) as PettyCashInvoiceReplacementStatus[];

export const PETTY_CASH_INVOICE_COLLECTED_OPTIONS = Object.keys(
  PETTY_CASH_INVOICE_COLLECTED_LABELS
) as PettyCashInvoiceCollectedStatus[];

export const PETTY_CASH_REIMBURSEMENT_STATUS_OPTIONS = Object.keys(
  PETTY_CASH_REIMBURSEMENT_STATUS_LABELS
) as PettyCashReimbursementStatus[];

const cnyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatPettyCashAmount(amountMinor: number) {
  return cnyFormatter.format(amountMinor / 100);
}

export function isOutstandingReimbursement(status: PettyCashReimbursementStatus) {
  return status === "pending" || status === "in_progress";
}

export function expectsInvoiceCollection(
  entry:
    | Pick<
        PettyCashEntry,
        "invoice_availability" | "invoice_replacement_status"
      >
    | Pick<
        PettyCashEntryWithRelations,
        "invoice_availability" | "invoice_replacement_status"
      >
) {
  return (
    entry.invoice_availability === "with_invoice" ||
    entry.invoice_replacement_status !== "not_needed"
  );
}

export function sortPettyCashEntries(entries: PettyCashEntryWithRelations[]) {
  return [...entries].sort((left, right) => {
    if (left.occurred_on !== right.occurred_on) {
      return right.occurred_on.localeCompare(left.occurred_on);
    }
    return right.created_at.localeCompare(left.created_at);
  });
}

export function toMinorAmount(input: string) {
  const normalized = input.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error("请填写有效的金额，最多保留两位小数");
  }

  const [wholePart, decimalPart = ""] = normalized.split(".");
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) {
    throw new Error("金额必须大于 0");
  }
  return cents;
}

export function toDisplayAmount(amountMinor: number) {
  return (amountMinor / 100).toFixed(2);
}
